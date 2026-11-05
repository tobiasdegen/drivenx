'use strict';
const { backendError } = require('../security/user-errors.js');
const path = require('node:path');
/** System-wide file-system TRIM configuration, never proof of USB pass-through. */
function parseTrimStatus(output) {
  if (typeof output !== 'string') return { ntfs: null, refs: null };
  const result = { ntfs: null, refs: null };
  for (const match of output.matchAll(/\b(NTFS|ReFS)\s+DisableDeleteNotify\s*=\s*([01])\b/gi))
    result[match[1].toLowerCase()] = match[2] === '0' ? 'enabled' : 'disabled';
  return result;
}
async function queryWindowsTrim({
  platform = process.platform,
  env = process.env,
  runTextProcess,
} = {}) {
  if (platform !== 'win32') return { supported: false, ntfs: null, refs: null };
  if (typeof runTextProcess !== 'function') throw backendError('windowsSystemQueryUnavailable');
  const systemRoot = env.SystemRoot || env.windir;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot))
    throw backendError('windowsSystemDirectoryMissing');
  const binary = path.win32.join(systemRoot, 'System32', 'fsutil.exe');
  const output = await runTextProcess(binary, ['behavior', 'query', 'DisableDeleteNotify'], {
    timeout: 8000,
    maxOutput: 8192,
    maxError: 2048,
  });
  return { supported: true, ...parseTrimStatus(output) };
}
module.exports = { parseTrimStatus, queryWindowsTrim };
