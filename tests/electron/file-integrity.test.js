'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyFileSync, verifyFileAsync } = require('../../electron/security/file-integrity.js');
const { verifyBundledBinaryAsync } = require('../../electron/platform/bundled-smartctl.js');
const { verifiedDriveDatabaseAsync } = require('../../electron/devices/drive-database.js');

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('synchronous and asynchronous verifiers agree on unmodified, changed and missing files', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-integrity-'));
  const file = path.join(folder, 'binary');
  try {
    fs.writeFileSync(file, 'trusted content');
    const expected = digest('trusted content');
    assert.equal(verifyFileSync(file, expected), true);
    assert.equal(await verifyFileAsync(file, expected), true);
    const original = fs.statSync(file);
    // A metadata-only verification cache would silently accept this change.
    fs.writeFileSync(file, 'changed content'); // same byte length
    fs.utimesSync(file, original.atime, original.mtime);
    assert.equal(fs.statSync(file).size, original.size);
    assert.equal(verifyFileSync(file, expected), false);
    assert.equal(await verifyFileAsync(file, expected), false);
    fs.unlinkSync(file);
    assert.equal(verifyFileSync(file, expected), false);
    assert.equal(await verifyFileAsync(file, expected), false);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('regular files are required and oversized files are rejected', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-integrity-'));
  try {
    const file = path.join(folder, 'large');
    fs.writeFileSync(file, '0123456789');
    const expected = digest('0123456789');
    assert.equal(verifyFileSync(file, expected, { maxSize: 9 }), false);
    assert.equal(await verifyFileAsync(file, expected, { maxSize: 9 }), false);
    assert.equal(verifyFileSync(file, expected, { maxSize: 10 }), true);
    assert.equal(await verifyFileAsync(file, expected, { maxSize: 10 }), true);
    assert.equal(await verifyFileAsync(folder, expected), false);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

// Windows requires Developer Mode or elevated privileges for ordinary file
// symlinks. Skipping that single platform-dependent case keeps the regular
// file / size assertions active for every Windows user.
test('file integrity verification rejects symbolic links when the OS permits creating them', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-integrity-link-'));
  try {
    const file = path.join(folder, 'trusted');
    const symlink = path.join(folder, 'symlink');
    fs.writeFileSync(file, 'trusted content');
    const expected = digest('trusted content');
    try {
      fs.symlinkSync(file, symlink, 'file');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
        t.skip(
          `Windows does not permit test file symlinks (${error.code}); symlink rejection not exercised`,
        );
        return;
      }
      throw error;
    }
    assert.equal(fs.lstatSync(symlink).isSymbolicLink(), true);
    assert.equal(verifyFileSync(symlink, expected), false);
    assert.equal(await verifyFileAsync(symlink, expected), false);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('bundled smartctl is checked asynchronously against the vetted digest', async () => {
  const binary = path.join(
    ELECTRON_SOURCE_DIR,
    '..',
    'vendor',
    'smartmontools',
    'win32',
    'smartctl.exe',
  );
  assert.equal(
    await verifyBundledBinaryAsync(binary, {
      platform: 'win32',
      arch: 'x64',
      packaged: true,
    }),
    true,
  );
  assert.equal(
    await verifyBundledBinaryAsync(binary, {
      platform: 'win32',
      arch: 'ia32',
      packaged: true,
    }),
    false,
  );
  assert.equal(
    await verifyBundledBinaryAsync('/not/there', {
      platform: 'win32',
      arch: 'x64',
      packaged: true,
    }),
    false,
  );
});

test('DriveDB asynchronous verification accepts the vetted file and rejects untrusted data', async () => {
  assert.ok(
    await verifiedDriveDatabaseAsync({ projectRoot: path.resolve(ELECTRON_SOURCE_DIR, '..') }),
  );
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-integrity-'));
  try {
    const dbFolder = path.join(folder, 'vendor', 'smartmontools');
    fs.mkdirSync(dbFolder, { recursive: true });
    fs.writeFileSync(path.join(dbFolder, 'drivedb.h'), 'modified');
    assert.equal(await verifiedDriveDatabaseAsync({ projectRoot: folder }), null);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
