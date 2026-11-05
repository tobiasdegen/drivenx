'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  portableLocation,
  configurePortableData,
  verifyWritableDirectory,
} = require('../../electron/data/portable-data.js');
test('portable launcher uses original EXE directory, not extraction directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-portable-'));
  try {
    const env = {
      PORTABLE_EXECUTABLE_DIR: root,
      PORTABLE_EXECUTABLE_FILE: path.join(root, 'DriveNX.exe'),
    };
    const calls = [];
    const data = configurePortableData(
      { setPath: (...args) => calls.push(args) },
      { env, platform: 'win32', packaged: true },
    );
    assert.equal(data.dataDir, path.join(root, 'DriveNXData'));
    assert.deepEqual(
      calls.map((x) => x[0]),
      ['userData', 'sessionData'],
    );
    assert.ok(fs.statSync(data.sessionDir).isDirectory());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('installed/dev/mac builds never use portable launcher paths', () => {
  const root = 'C:\\Tools';
  const env = {
    PORTABLE_EXECUTABLE_DIR: root,
    PORTABLE_EXECUTABLE_FILE: 'C:\\Tools\\DriveNX.exe',
  };
  assert.equal(portableLocation({ env, platform: 'darwin', packaged: true }), null);
  assert.equal(portableLocation({ env, platform: 'win32', packaged: false }), null);
  assert.equal(portableLocation({ env: {}, platform: 'win32', packaged: true }), null);
  assert.equal(
    portableLocation({ env: { PORTABLE_EXECUTABLE_DIR: root }, platform: 'win32', packaged: true }),
    null,
  );
});

test('marked unpacked Windows build uses local data directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-unpacked-'));
  try {
    fs.writeFileSync(path.join(root, 'portable.flag'), '');
    const calls = [];
    const data = configurePortableData(
      { setPath: (...args) => calls.push(args) },
      {
        env: {},
        platform: 'win32',
        packaged: true,
        executable: path.join(root, 'DriveNX.exe'),
      },
    );
    assert.equal(data.dataDir, path.join(root, 'DriveNXData'));
    assert.deepEqual(
      calls.map((x) => x[0]),
      ['userData', 'sessionData'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('unmarked unpacked build and unrelated executables use normal profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-unmarked-'));
  try {
    const options = { env: {}, platform: 'win32', packaged: true };
    assert.equal(
      portableLocation({ ...options, executable: path.join(root, 'DriveNX.exe') }),
      null,
    );
    fs.writeFileSync(path.join(root, 'portable.flag'), '');
    assert.equal(portableLocation({ ...options, executable: path.join(root, 'Other.exe') }), null);
    assert.equal(
      portableLocation({
        ...options,
        executable: path.join(root, 'DriveNX.exe'),
        packaged: false,
      }),
      null,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('portable directory write test actually writes and removes its temporary probe', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-probe-'));
  try {
    verifyWritableDirectory(root);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('portable write probe reports real filesystem failure without silently continuing', () => {
  const io = {
    mkdtempSync: () => {
      throw Object.assign(new Error('blocked'), { code: 'EACCES' });
    },
    writeFileSync: () => {
      throw new Error('should not write');
    },
    rmSync: () => {
      throw new Error('should not clean up a nonexistent probe');
    },
  };
  assert.throws(() => verifyWritableDirectory('/blocked', io), { code: 'EACCES' });
});

test('portable write probe also cleans up after a failed file write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-probe-fail-'));
  const io = {
    mkdtempSync: fs.mkdtempSync,
    writeFileSync: () => {
      throw Object.assign(new Error('blocked'), { code: 'ENOSPC' });
    },
    rmSync: fs.rmSync,
  };
  try {
    assert.throws(() => verifyWritableDirectory(root, io), { code: 'ENOSPC' });
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
