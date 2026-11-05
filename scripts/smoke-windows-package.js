'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_ASAR = [
  'package.json',
  'electron/main.js',
  'electron/ui/license-viewer.js',
  'electron/ui/native-about.js',
  'electron/preload.js',
  'electron/reports/report.js',
  'electron/diagnostics/smart-test-translation.js',
  'shared/recommendation-rules.mjs',
  'shared/self-test-assessment.mjs',
  'locales/de-DE.json',
  'locales/en-US.json',
  'dist/index.html',
];

function checkWindowsPackage({ root, target = 'all', asarApi, output } = {}) {
  const problems = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const releaseDir = output || path.join(root, 'release');
  const resources = path.join(releaseDir, 'win-unpacked', 'resources');
  const appAsar = path.join(resources, 'app.asar');
  const mustExist = (filepath, label) => {
    if (!fs.existsSync(filepath)) problems.push(`${label} fehlt: ${filepath}`);
  };

  mustExist(appAsar, 'app.asar');
  mustExist(path.join(resources, 'smartmontools', 'win32', 'smartctl.exe'), 'smartctl.exe');
  if (fs.existsSync(path.join(resources, 'smartmontools', 'darwin')))
    problems.push('Windows-Paket enthält macOS-smartctl-Ressourcen.');
  mustExist(path.join(resources, 'smartmontools', 'drivedb.h'), 'SMART-Datenbank');
  // File presence is only a packaging guard, not proof of full GPL compliance.
  mustExist(
    path.join(resources, 'smartmontools', 'COPYING-smartmontools.txt'),
    'smartmontools-Lizenztext',
  );
  mustExist(
    path.join(resources, 'smartmontools', 'smartmontools-7.5-source.tar.gz'),
    'smartmontools-Quellarchiv',
  );
  mustExist(path.join(resources, 'usb-ids', 'index.json'), 'USB-ID-Index');
  if (fs.existsSync(path.join(resources, 'usb-ids', 'usb.ids')))
    problems.push('Windows-Paket enthält unnötige USB-ID-Quelldatei usb.ids.');
  mustExist(path.join(resources, 'usb-ids', 'LICENSE-BSD-3-Clause.txt'), 'USB-ID-Lizenztext');
  mustExist(path.join(resources, 'LICENSE-THIRD-PARTY.md'), 'Drittanbieter-Lizenzübersicht');
  mustExist(path.join(resources, 'LICENSE.md'), 'MIT-Lizenz');
  mustExist(path.join(resources, 'DISCLAIMER.md'), 'Diagnosehinweise');
  mustExist(path.join(resources, 'DISCLAIMER.en.md'), 'Englische Diagnosehinweise');
  mustExist(path.join(resources, 'licenses', 'Electron-MIT.txt'), 'Electron-Lizenz');
  mustExist(path.join(resources, 'licenses', 'Lucide-ISC-and-Feather-MIT.txt'), 'Lucide-Lizenz');
  mustExist(path.join(resources, 'icon.png'), 'App-Icon');
  mustExist(
    path.join(releaseDir, 'win-unpacked', 'LICENSES.chromium.html'),
    'Chromium-/Node.js-Lizenzhinweise',
  );
  if (fs.existsSync(appAsar)) {
    if (
      !asarApi ||
      typeof asarApi.listPackage !== 'function' ||
      typeof asarApi.extractFile !== 'function'
    ) {
      problems.push('@electron/asar ist nicht verfügbar; Paketinhalt kann nicht geprüft werden.');
    } else {
      try {
        const entries = new Set(
          asarApi
            .listPackage(appAsar, { isPack: false })
            .map((p) => p.replace(/^[/\\]+/, '').replace(/\\/g, '/')),
        );
        // Renderer libraries are bundled into dist/ by Vite, not duplicated in ASAR.
        for (const name of ['react', 'react-dom', 'lucide-react', 'scheduler']) {
          const prefix = `node_modules/${name}/`;
          if (
            [...entries].some((entry) => entry === prefix.slice(0, -1) || entry.startsWith(prefix))
          )
            problems.push(`Unnötige doppelte Frontend-Abhängigkeit in app.asar: ${name}`);
        }
        for (const file of REQUIRED_ASAR) {
          if (!entries.has(file)) problems.push(`In app.asar fehlt: ${file}`);
        }
        for (const language of ['de-DE', 'en-US']) {
          const name = `locales/${language}.json`;
          if (entries.has(name)) {
            try {
              const catalog = JSON.parse(asarApi.extractFile(appAsar, name).toString('utf8'));
              if (!catalog || typeof catalog !== 'object' || !Object.keys(catalog).length) {
                problems.push(`${name} ist leer oder ungültig.`);
              }
            } catch (error) {
              problems.push(`${name} ist kein gültiges JSON: ${error.message}`);
            }
          }
        }
      } catch (error) {
        problems.push(`app.asar kann nicht gelesen werden: ${error.message}`);
      }
    }
  }
  const fileVersion = pkg.version;
  for (const [kind, file] of [
    ['installer', `DriveNX-Setup-${fileVersion}-x64.exe`],
    ['portable', `DriveNX-Portable-${fileVersion}-x64.exe`],
  ]) {
    if (target === 'all' || target === kind) mustExist(path.join(releaseDir, file), kind);
  }
  return problems;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] || 'all';
  if (!['all', 'installer', 'portable', 'dir'].includes(target)) {
    console.error('Ungültiges Ziel. Erwartet: all, installer, portable oder dir.');
    process.exitCode = 2;
    return;
  }

  let asarApi;
  try {
    // @electron/asar 4 is ESM-only. Keep the CLI and testable package check in CommonJS.
    asarApi = await import('@electron/asar');
  } catch {
    // The package check reports a missing API when app.asar is present.
  }

  const problems = checkWindowsPackage({ root, target, asarApi });
  for (const problem of problems) console.error('FEHLER: ' + problem);
  if (problems.length) process.exitCode = 1;
  else
    console.log(
      'Windows-Paket-Smoketest bestanden: app.asar, Sprachdateien, smartctl und Artefakte geprüft.',
    );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FEHLER: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { checkWindowsPackage, REQUIRED_ASAR };
