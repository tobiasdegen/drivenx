'use strict';
const { verifyFileSync, verifyFileAsync } = require('../security/file-integrity.js');
const MAX_BINARY_BYTES = 16 * 1024 * 1024;
// Digests are embedded in app.asar, not read from writable user settings.
const DIGESTS = Object.freeze({
  darwin: Object.freeze({
    arm64: 'ba9691d84342c36420fb022141abd3922129ddad4d2e653a93ca3e9ec2f0ddce',
  }),
  win32: Object.freeze({
    x64: 'b5db94e5082c042be44994b7a4fa8f7b5c8e713b2ab1c9a560d8f7a7995ea27d',
  }),
});
function verifyBundledBinary(
  file,
  { platform = process.platform, arch = process.arch, packaged = true } = {},
) {
  if (!packaged) return true;
  const expected = DIGESTS[platform]?.[arch];
  if (!expected) return false; // No vetted binary for this release target.
  return verifyFileSync(file, expected, { maxSize: MAX_BINARY_BYTES });
}
async function verifyBundledBinaryAsync(
  file,
  { platform = process.platform, arch = process.arch, packaged = true } = {},
) {
  if (!packaged) return true;
  const expected = DIGESTS[platform]?.[arch];
  return expected ? verifyFileAsync(file, expected, { maxSize: MAX_BINARY_BYTES }) : false;
}
module.exports = { verifyBundledBinary, verifyBundledBinaryAsync, DIGESTS };
