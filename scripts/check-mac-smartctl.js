'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { verifyBundledBinary } = require('../electron/platform/bundled-smartctl.js');

function checkMacSmartctl({ root = path.resolve(__dirname, '..'), arch = 'arm64' } = {}) {
  if (arch !== 'arm64') {
    throw new Error(
      `macOS-Release für ${arch} nicht verfügbar: nur ein geprüftes ARM64-smartctl liegt bei.`,
    );
  }
  const file = path.join(root, 'vendor', 'smartmontools', 'darwin', 'smartctl');
  if (
    !fs.existsSync(file) ||
    !verifyBundledBinary(file, { platform: 'darwin', arch, packaged: true })
  ) {
    throw new Error(
      'macOS-Release nicht verfügbar: ARM64-smartctl fehlt oder SHA-256 stimmt nicht.',
    );
  }
  // A correct checksum does not mean macOS can execute the bundled Mach-O.
  // The executable bit must survive checkout, packaging and ZIP distribution.
  if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o111) !== 0o111) {
    throw new Error(
      'macOS-Release nicht verfügbar: smartctl ist nicht ausführbar (chmod 755 vendor/smartmontools/darwin/smartctl).',
    );
  }
  return file;
}
if (require.main === module) {
  try {
    console.log(checkMacSmartctl());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { checkMacSmartctl };
