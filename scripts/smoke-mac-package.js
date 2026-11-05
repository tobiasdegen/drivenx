'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  verifyPackagedMacSmartctl,
  macBinaryInfo,
} = require('../electron/platform/mac-smartctl-integrity.js');

function findApp(root, override) {
  if (override) return path.resolve(override);
  for (const folder of ['mac-arm64', 'mac', 'mac-universal']) {
    const candidate = path.join(root, 'release', folder, 'DriveNX.app');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
async function smokeMacPackage({
  root = path.resolve(__dirname, '..'),
  appPath,
  hostVersion,
  execute = true,
  verifySignature,
  verifyDigest,
  asarApi,
} = {}) {
  const bundle = findApp(root, appPath);
  if (!bundle)
    throw new Error(
      'DriveNX.app nicht gefunden: release/mac-arm64/ prüfen oder --app=/Pfad/DriveNX.app übergeben.',
    );
  const resourcesPath = path.join(bundle, 'Contents', 'Resources');
  // Check the actual Electron archive as well as the external smartctl resources.
  const archive = path.join(resourcesPath, 'app.asar');
  if (!fs.existsSync(archive)) throw new Error('macOS-Paket enthält kein app.asar.');
  let asar = asarApi;
  if (!asar) {
    try {
      asar = await import('@electron/asar');
    } catch {
      throw new Error('@electron/asar 4 ist nicht verfügbar; das Paket kann nicht geprüft werden.');
    }
  }
  let entries;
  try {
    entries = new Set(
      asar
        .listPackage(archive, { isPack: false })
        .map((name) => name.replace(/^[/\\]+/, '').replace(/\\/g, '/')),
    );
  } catch (error) {
    throw new Error(`macOS app.asar kann nicht gelesen werden: ${error.message}`, { cause: error });
  }
  for (const required of [
    'package.json',
    'electron/main.js',
    'electron/preload.js',
    'locales/de-DE.json',
    'locales/en-US.json',
    'dist/index.html',
  ]) {
    if (!entries.has(required)) throw new Error(`In macOS app.asar fehlt: ${required}`);
  }
  for (const name of ['react', 'react-dom', 'lucide-react', 'scheduler']) {
    const prefix = `node_modules/${name}/`;
    if ([...entries].some((entry) => entry === prefix.slice(0, -1) || entry.startsWith(prefix))) {
      throw new Error(`Doppelte Frontend-Abhängigkeit in macOS app.asar: ${name}`);
    }
  }
  const binary = path.join(resourcesPath, 'smartmontools', 'darwin', 'smartctl');
  if (fs.existsSync(path.join(resourcesPath, 'smartmontools', 'win32')))
    throw new Error('macOS-Paket enthält Windows-smartctl-Ressourcen.');
  for (const [file, label] of [
    ['usb-ids/index.json', 'USB-ID-Index'],
    ['usb-ids/LICENSE-BSD-3-Clause.txt', 'USB-ID-Lizenztext'],
  ]) {
    if (!fs.existsSync(path.join(resourcesPath, file)))
      throw new Error(`macOS-Paket enthält keinen ${label}.`);
  }
  if (fs.existsSync(path.join(resourcesPath, 'usb-ids', 'usb.ids')))
    throw new Error('macOS-Paket enthält unnötige USB-ID-Quelldatei usb.ids.');
  // The centered About window renders the packaged icon without access to app.asar.
  const icon = path.join(resourcesPath, 'icon.png');
  if (!fs.existsSync(icon) || fs.statSync(icon).size < 100)
    throw new Error('macOS-Paket: PNG-App-Icon für den Über-Dialog fehlt.');
  const resolvedHost =
    hostVersion ??
    (process.platform === 'darwin'
      ? execFileSync('/usr/bin/sw_vers', ['-productVersion'], {
          encoding: 'utf8',
          timeout: 3000,
        }).trim()
      : undefined);
  const outcome = await verifyPackagedMacSmartctl(binary, {
    resourcesPath,
    hostVersion: resolvedHost,
    ...(verifySignature ? { verifySignature } : {}),
    ...(verifyDigest ? { verifyDigest } : {}),
  });
  if (!outcome.ok) throw new Error(outcome.reason);
  if (execute) {
    if (process.platform !== 'darwin')
      throw new Error('smartctl kann nur auf macOS ausgeführt werden.');
    try {
      const output = execFileSync(binary, ['--version'], {
        encoding: 'utf8',
        timeout: 12000,
        maxBuffer: 128 * 1024,
      });
      if (!/smartctl\s+7\.5\b/i.test(output)) throw new Error('Unerwartete smartctl-Version');
    } catch (error) {
      throw new Error(
        `Das mitgelieferte smartctl lässt sich nicht starten: ${error.stderr?.toString().slice(0, 900) || error.message}`,
        { cause: error },
      );
    }
  }
  return { bundle, binary, hostVersion: resolvedHost, mode: outcome.source, info: outcome.info };
}
if (require.main === module) {
  smokeMacPackage({ appPath: process.argv.find((a) => a.startsWith('--app='))?.slice(6) })
    .then((value) =>
      console.log(
        `macOS-Paket-Smoketest bestanden: ${value.binary} (${value.mode}, macOS >= ${value.info.minimum || '?'}, Host ${value.hostVersion || '?'})`,
      ),
    )
    .catch((error) => {
      console.error(`macOS-Paket-Smoketest fehlgeschlagen: ${error.message}`);
      process.exitCode = 1;
    });
}
module.exports = { smokeMacPackage, findApp };
