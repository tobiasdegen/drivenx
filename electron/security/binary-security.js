'use strict';
const path = require('node:path');
function validBinaryPath(file, platform = process.platform) {
  if (typeof file !== 'string' || file.length === 0 || file.length > 4096 || file.includes('\0'))
    return false;
  const parser = platform === 'win32' ? path.win32 : path.posix;
  return parser.isAbsolute(file) && (platform !== 'win32' || /\.exe$/i.test(file));
}
function isSmartctlVersion(text) {
  return typeof text === 'string' && /^smartctl\s+\d+\.\d+/i.test(text.split(/\r?\n/)[0].trim());
}
module.exports = { validBinaryPath, isSmartctlVersion };
