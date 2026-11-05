// @ts-check
'use strict';
const fs = require('node:fs/promises');
const { SMARTCTL_PATHS, PKEXEC_PATHS, findTrustedExecutable } = require('./linux-smartctl.js');
const { getCatalogSection } = require('../ui/translator.js');

/** Identify Linux families; never evaluate or execute the contents of os-release. */
function distributionFamily(osRelease = '') {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of osRelease.split('\n')) {
    const entry = line.match(/^(ID|ID_LIKE)=([A-Za-z0-9_ ."'-]+)$/);
    if (!entry) continue;
    fields[entry[1]] = entry[2].replace(/^['"]|['"]$/g, '').toLowerCase();
  }
  const ids = [fields.ID, ...(fields.ID_LIKE || '').split(/\s+/)].filter(Boolean);
  if (ids.some((id) => ['debian', 'ubuntu', 'linuxmint', 'pop'].includes(id))) return 'apt';
  if (ids.some((id) => ['fedora', 'rhel', 'centos'].includes(id))) return 'dnf';
  if (ids.some((id) => ['arch', 'manjaro', 'endeavouros'].includes(id))) return 'pacman';
  if (ids.some((id) => ['opensuse', 'opensuse-leap', 'opensuse-tumbleweed', 'suse'].includes(id)))
    return 'zypper';
  return null;
}

/** @param {string|null} family @param {string[]} missing */
function installCommand(family, missing) {
  if (!family || missing.length === 0) return null;
  const packages = missing.map((part) => {
    if (part === 'smartctl') return 'smartmontools';
    return family === 'apt' ? 'pkexec' : 'polkit';
  });
  /** @type {Record<string, string>} */
  const commands = {
    apt: `sudo apt install ${packages.join(' ')}`,
    dnf: `sudo dnf install ${packages.join(' ')}`,
    pacman: `sudo pacman -S ${packages.join(' ')}`,
    zypper: `sudo zypper install ${packages.join(' ')}`,
  };
  return commands[family] || null;
}

/**
 * Read-only check. Never runs smartctl, pkexec or an install command.
 * Finding pkexec does not establish that a graphical polkit agent is running.
 * @param {{platform?:string, getuid?:()=>number, findExecutable?:typeof findTrustedExecutable, readOsRelease?:()=>Promise<string>}} [options]
 */
async function checkLinuxDependencies(options = {}) {
  if ((options.platform || process.platform) !== 'linux') return { missing: [], command: null };
  const findExecutable = options.findExecutable || findTrustedExecutable;
  const getuid = options.getuid || process.getuid;
  const root = typeof getuid === 'function' && getuid() === 0;
  const [smartctl, pkexec] = await Promise.all([
    findExecutable(SMARTCTL_PATHS),
    root ? Promise.resolve(null) : findExecutable(PKEXEC_PATHS),
  ]);
  const missing = [];
  if (!smartctl) missing.push('smartctl');
  if (!root && !pkexec) missing.push('pkexec');
  if (missing.length === 0) return { missing, command: null };
  const readOsRelease = options.readOsRelease || (() => fs.readFile('/etc/os-release', 'utf8'));
  const osRelease = await readOsRelease().catch(() => '');
  return { missing, command: installCommand(distributionFamily(osRelease), missing) };
}

/**
 * Native dialog in Main, with explicit user-controlled clipboard action.
 * @param {{missing:string[],command:string|null}} state
 * @param {{locale:string,dialog:import('electron').Dialog,clipboard:import('electron').Clipboard,owner:import('electron').BrowserWindow|null|undefined}} options
 */
async function showLinuxDependencyNotice(state, { locale, dialog, clipboard, owner }) {
  if (!state.missing.length) return false;
  const t = getCatalogSection(locale, 'linuxDependencies');
  const message =
    state.missing.length === 2
      ? t.bothMissing
      : state.missing.includes('smartctl')
        ? t.smartctlMissing
        : t.pkexecMissing;
  const detail = [
    t.explanation,
    state.command ? `${t.installCommand}\n${state.command}` : t.installManual,
    t.agentNote,
  ].join('\n\n');
  const buttons = state.command ? [t.copy, t.close] : [t.close];
  /** @type {import('electron').MessageBoxOptions} */
  const dialogOptions = {
    type: 'warning',
    title: t.title,
    message,
    detail,
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    noLink: true,
  };
  const { response } = owner
    ? await dialog.showMessageBox(owner, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);
  if (state.command && response === 0) clipboard.writeText(state.command);
  return true;
}

module.exports = {
  distributionFamily,
  installCommand,
  checkLinuxDependencies,
  showLinuxDependencyNotice,
};
