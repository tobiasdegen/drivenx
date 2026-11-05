'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { canonicalSystemPath } = require('../platform/system-path.js');

// electron-builder's self-extracting launcher supplies the original EXE location.
// An unpacked directory can opt in explicitly with a marker next to DriveNX.exe.
// Installed builds continue using the standard Electron userData folder.
function portableLocation({
  env = process.env,
  platform = process.platform,
  packaged = true,
  executable = process.execPath,
} = {}) {
  if (platform !== 'win32' || !packaged) return null;
  const root = env.PORTABLE_EXECUTABLE_DIR;
  const file = env.PORTABLE_EXECUTABLE_FILE;
  if (
    root &&
    file &&
    path.isAbsolute(root) &&
    path.isAbsolute(file) &&
    path.dirname(path.resolve(file)).toLowerCase() === path.resolve(root).toLowerCase()
  ) {
    return path.join(path.resolve(root), 'DriveNXData');
  }
  if (typeof executable !== 'string' || !path.isAbsolute(executable)) return null;
  if (path.basename(executable).toLowerCase() !== 'drivenx.exe') return null;
  const appDir = path.dirname(path.resolve(executable));
  const marker = path.join(appDir, 'portable.flag');
  try {
    if (!fs.statSync(marker).isFile()) return null;
  } catch {
    return null;
  }
  return path.join(appDir, 'DriveNXData');
}
function assertSafeDirectory(directory, create = false) {
  const absolute = canonicalSystemPath(directory),
    root = path.parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      stat = fs.lstatSync(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Unsicheres portables Datenverzeichnis');
  }
}
// A permission bit check alone does not prove that Windows Defender, volume
// policies or the file system permit actual writes. Check both profile roots.
function verifyWritableDirectory(directory, io = fs) {
  let probe;
  try {
    probe = io.mkdtempSync(path.join(directory, '.drivenx-write-'));
    io.writeFileSync(path.join(probe, 'probe'), '', { flag: 'wx', mode: 0o600 });
  } finally {
    if (probe) io.rmSync(probe, { recursive: true, force: true });
  }
}

function configurePortableData(app, options = {}) {
  const dataDir = portableLocation(options);
  if (!dataDir) return null;
  // Never silently fall back to AppData when the portable directory is not writable.
  assertSafeDirectory(dataDir, true);
  const sessionDir = path.join(dataDir, 'Chromium');
  assertSafeDirectory(sessionDir, true);
  verifyWritableDirectory(dataDir);
  verifyWritableDirectory(sessionDir);
  app.setPath('userData', dataDir);
  app.setPath('sessionData', sessionDir);
  return { dataDir, sessionDir };
}
module.exports = { portableLocation, configurePortableData, verifyWritableDirectory };
