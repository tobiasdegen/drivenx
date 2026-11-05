// @ts-check
'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const INTEGRITY_LEVEL = /S-1-16-(12288|16384)\b/;

/**
 * System utilities must never be resolved relative to the current directory or PATH.
 * Require a drive-rooted Windows directory; UNC paths are not trusted here.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
function whoamiPath(env) {
  const root = env.SystemRoot || env.windir;
  if (!root || !/^[a-z]:\\/i.test(root) || !path.win32.isAbsolute(root)) return null;
  return path.win32.join(root, 'System32', 'whoami.exe');
}

/**
 * @param {{
 *  platform?: NodeJS.Platform,
 *  env?: NodeJS.ProcessEnv,
 *  getuid?: (() => number) | undefined,
 *  run?: (file: string, args: string[], options: {windowsHide: boolean, timeout: number, maxBuffer: number}) => Promise<string>,
 *  trackSystem?: (operation: () => Promise<string>) => Promise<string>
 * }} [options]
 * @returns {Promise<boolean | null>}
 */
async function queryElevatedState({
  platform = process.platform,
  env = process.env,
  getuid = process.getuid,
  run = async (file, args, options) => (await execFileAsync(file, args, options)).stdout,
  trackSystem = (operation) => operation(),
} = {}) {
  if (platform !== 'win32') return typeof getuid === 'function' ? getuid() === 0 : null;
  const binary = whoamiPath(env);
  if (!binary) return null;
  try {
    const stdout = await trackSystem(() =>
      run(binary, ['/groups', '/fo', 'csv', '/nh'], {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 64 * 1024,
      }),
    );
    // High (12288) or System (16384) integrity indicates an elevated token.
    return INTEGRITY_LEVEL.test(stdout);
  } catch {
    // Permission checks are informational; do not report failed checks as 'not elevated'.
    return null;
  }
}

module.exports = { whoamiPath, queryElevatedState };
