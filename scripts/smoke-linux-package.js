'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_ASAR = [
  'package.json',
  'electron/main.js',
  'electron/preload.js',
  'electron/platform/linux-smartctl.js',
  'electron/platform/linux-smart-session.js',
  'electron/platform/linux-dependencies.js',
  'electron/devices/smart.js',
  'electron/ui/license-viewer.js',
  'locales/de-DE.json',
  'locales/en-US.json',
  'dist/index.html',
];

function checkLinuxPackage({
  root,
  output = path.join(root, 'release'),
  target = 'all',
  asarApi,
} = {}) {
  if (target !== 'all' && target !== 'dir') {
    throw new Error(`Unbekanntes Linux-Paketziel: ${target} (erlaubt: all, dir)`);
  }
  const issues = [];
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const resources = path.join(output, 'linux-unpacked', 'resources');
  const required = (file) => {
    if (!fs.existsSync(file)) issues.push(`Fehlt: ${file}`);
  };
  const asar = path.join(resources, 'app.asar');
  required(asar);
  for (const name of [
    'smartmontools/drivedb.h',
    'smartmontools/COPYING-smartmontools.txt',
    'usb-ids/index.json',
    'usb-ids/LICENSE-BSD-3-Clause.txt',
    'LICENSE.md',
    'DISCLAIMER.md',
    'DISCLAIMER.en.md',
    'LICENSE-THIRD-PARTY.md',
    'licenses/Electron-MIT.txt',
    'licenses/Lucide-ISC-and-Feather-MIT.txt',
    'icon.png',
    'linux-privileged/drivenx-smartctl-helper',
    'linux-privileged/io.drivenx.smartctl.policy',
  ])
    required(path.join(resources, name));
  for (const unexpected of [
    'smartmontools/win32',
    'smartmontools/darwin',
    'smartmontools/linux',
    'smartmontools/smartmontools-7.5-source.tar.gz',
    'usb-ids/usb.ids',
  ]) {
    if (fs.existsSync(path.join(resources, unexpected)))
      issues.push(`Plattformfremde oder überflüssige Ressource: ${unexpected}`);
  }
  required(path.join(output, 'linux-unpacked', 'LICENSES.chromium.html'));
  if (fs.existsSync(asar)) {
    if (!asarApi || typeof asarApi.listPackage !== 'function') {
      issues.push('app.asar kann mangels @electron/asar nicht geprüft werden.');
    } else {
      try {
        const contents = new Set(
          asarApi
            .listPackage(asar, { isPack: false })
            .map((p) => p.replace(/^[/\\]+/, '').replace(/\\/g, '/')),
        );
        // Renderer libraries are bundled into dist/ by Vite, not duplicated in ASAR.
        for (const name of ['react', 'react-dom', 'lucide-react', 'scheduler']) {
          const prefix = `node_modules/${name}/`;
          if (
            [...contents].some((entry) => entry === prefix.slice(0, -1) || entry.startsWith(prefix))
          )
            issues.push(`Unnötige doppelte Frontend-Abhängigkeit in app.asar: ${name}`);
        }
        for (const name of REQUIRED_ASAR)
          if (!contents.has(name)) issues.push(`In app.asar fehlt: ${name}`);
      } catch (error) {
        issues.push(`app.asar ungültig: ${error.message}`);
      }
    }
  }
  if (target === 'all') {
    // electron-builder's Linux artifact arch names differ by target (AppImage vs DEB).
    required(path.join(output, `DriveNX-${version}-linux-x86_64.AppImage`));
    required(path.join(output, `DriveNX-${version}-linux-amd64.deb`));
  }
  return issues;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--target=dir' && arg !== '--target=all')) {
    throw new Error('Unbekanntes Argument: erlaubt sind --target=dir und --target=all.');
  }
  if (args.length > 1) throw new Error('Bitte nur ein --target-Argument angeben.');
  const target = args[0]?.slice('--target='.length) || 'all';

  let asarApi;
  try {
    // @electron/asar 4 is ESM-only; the package checker stays synchronous and testable.
    asarApi = await import('@electron/asar');
  } catch {
    // The package check reports a missing API when app.asar is present.
  }

  const issues = checkLinuxPackage({ root, target, asarApi });
  for (const issue of issues) console.error('FEHLER: ' + issue);
  if (issues.length) process.exitCode = 1;
  else
    console.log('Linux-Paketprüfung bestanden: App, Lizenzen, Ressourcen und Plattformtrennung.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FEHLER: ${error.message}`);
    process.exitCode = 2;
  });
}

module.exports = { checkLinuxPackage, REQUIRED_ASAR };
