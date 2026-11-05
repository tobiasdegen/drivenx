// @ts-check
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

// Linux packages ship the distribution-maintained smartmontools binary rather
// than a foreign ELF binary. Only root-owned, non-writable system locations
// are eligible for privileged execution via pkexec.
const SMARTCTL_PATHS = Object.freeze([
  '/usr/sbin/smartctl',
  '/usr/bin/smartctl',
  '/sbin/smartctl',
  '/bin/smartctl',
]);
const PKEXEC_PATHS = Object.freeze(['/usr/bin/pkexec', '/bin/pkexec']);

/**
 * @param {string} filename
 * @param {{stat?: typeof fs.stat; realpath?: typeof fs.realpath}} [io]
 */
async function trustedSystemExecutable(filename, io = {}) {
  const stat = io.stat || fs.stat;
  const realpath = io.realpath || fs.realpath;
  try {
    const resolved = await realpath(filename);
    if (!path.posix.isAbsolute(resolved) || !resolved.startsWith('/usr/')) return false;
    // /bin and /sbin are often symlinks to /usr/{bin,sbin}; neither the
    // resolved executable nor any directory leading to it may be user writable.
    for (let current = resolved; ; current = path.posix.dirname(current)) {
      const info = await stat(current);
      if (info.uid !== 0 || info.mode & 0o022) return false;
      if (current === resolved ? !info.isFile() || !(info.mode & 0o111) : !info.isDirectory())
        return false;
      if (current === '/') break;
    }
    return true;
  } catch {
    return false;
  }
}

/** @param {readonly string[]} candidates @param {{stat?: typeof fs.stat; realpath?: typeof fs.realpath}} [io] */
async function findTrustedExecutable(candidates, io = {}) {
  for (const filename of candidates) {
    if (await trustedSystemExecutable(filename, io)) return filename;
  }
  return null;
}

/** @param {string[]} args */
function needsRootAccess(args) {
  // The plain inventory and version read do not open devices. Everything
  // else (including --scan-open) can touch hardware and needs authorization.
  return !args.includes('--version') && !args.includes('--scan');
}

/**
 * Return an explicit executable and argv. Never run the Electron GUI as root,
 * never invoke a shell, and never use a renderer-supplied executable.
 * @param {string} smartctl
 * @param {string[]} args
 * @param {{getuid?: () => number; findPkexec?: () => Promise<string|null>}} [options]
 */
async function linuxSmartInvocation(smartctl, args, options = {}) {
  const getuid = options.getuid || process.getuid;
  if (!needsRootAccess(args) || typeof getuid !== 'function' || getuid() === 0)
    return { executable: smartctl, args };
  const pkexec = options.findPkexec
    ? await options.findPkexec()
    : await findTrustedExecutable(PKEXEC_PATHS);
  if (!pkexec) return { executable: smartctl, args };
  return {
    executable: pkexec,
    args: ['--disable-internal-agent', smartctl, ...args],
  };
}

module.exports = {
  SMARTCTL_PATHS,
  PKEXEC_PATHS,
  trustedSystemExecutable,
  findTrustedExecutable,
  needsRootAccess,
  linuxSmartInvocation,
};
