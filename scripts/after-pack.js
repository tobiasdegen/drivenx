'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { verifyBundledBinary } = require('../electron/platform/bundled-smartctl.js');
const { chromiumLicenseCandidates } = require('../electron/ui/license-viewer.js');

// electron-builder invokes afterPack before code signing. The file shipped in
// Contents/Resources must be executable, not merely present and hash-valid.
async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // electron-builder Arch enum: x64=1, arm64=3. Reject unsupported Intel packaging.
  if (![3, 'arm64'].includes(context.arch)) {
    throw new Error(
      'macOS-Paketierung ist derzeit nur für ARM64 mit geprüftem smartctl freigegeben.',
    );
  }
  const productFilename = context.packager.appInfo.productFilename;
  const binary = path.join(
    context.appOutDir,
    `${productFilename}.app`,
    'Contents',
    'Resources',
    'smartmontools',
    'darwin',
    'smartctl',
  );
  // The current macOS release deliberately supports ARM64 only.
  if (
    !verifyBundledBinary(binary, {
      platform: 'darwin',
      arch: 'arm64',
      packaged: true,
    })
  ) {
    throw new Error('macOS-Paket enthält kein gültiges ARM64-smartctl.');
  }
  const appContents = path.join(context.appOutDir, `${productFilename}.app`, 'Contents');
  const noticeCandidates = chromiumLicenseCandidates({
    execPath: path.join(appContents, 'MacOS', productFilename),
    resourcesPath: path.join(appContents, 'Resources'),
    platform: 'darwin',
  });
  if (!noticeCandidates.some((file) => fs.existsSync(file)))
    throw new Error('macOS-Paket enthält keine LICENSES.chromium.html-Lizenzhinweise.');
  // These are recipients' license documents, not development-only sources.
  const resourcesPath = path.join(appContents, 'Resources');
  if (fs.existsSync(path.join(resourcesPath, 'smartmontools', 'win32')))
    throw new Error('macOS-Paket enthält Windows-smartctl-Ressourcen.');
  if (fs.existsSync(path.join(resourcesPath, 'usb-ids', 'usb.ids')))
    throw new Error('macOS-Paket enthält unnötige USB-ID-Quelldatei usb.ids.');
  // Static About window uses this exact bundled PNG (no external loading).
  const aboutIcon = path.join(resourcesPath, 'icon.png');
  if (!fs.existsSync(aboutIcon) || fs.statSync(aboutIcon).size < 100)
    throw new Error('macOS-Paket: PNG-App-Icon für den Über-Dialog fehlt.');
  for (const name of [
    'LICENSE.md',
    'DISCLAIMER.md',
    'DISCLAIMER.en.md',
    'LICENSE-THIRD-PARTY.md',
    'licenses/Electron-MIT.txt',
    'licenses/Lucide-ISC-and-Feather-MIT.txt',
    'smartmontools/COPYING-smartmontools.txt',
    'smartmontools/smartmontools-7.5-source.tar.gz',
    'usb-ids/index.json',
    'usb-ids/LICENSE-BSD-3-Clause.txt',
  ]) {
    if (!fs.existsSync(path.join(resourcesPath, name))) {
      throw new Error(`macOS-Paket: Lizenzressource fehlt: ${name}`);
    }
  }
  fs.chmodSync(binary, 0o755);
  // Windows does not represent POSIX executable bits in fs.stat().mode.
  // This hook runs for actual macOS packaging, where the check remains mandatory.
  if (process.platform !== 'win32' && (fs.statSync(binary).mode & 0o111) !== 0o111) {
    throw new Error('macOS-Paket: smartctl konnte nicht ausführbar gemacht werden.');
  }
}
module.exports = afterPack;
