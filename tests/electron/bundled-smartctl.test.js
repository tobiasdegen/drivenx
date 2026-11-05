'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { verifyBundledBinary, DIGESTS } = require('../../electron/platform/bundled-smartctl.js');
test('bundled macOS ARM64 smartctl matches vetted SHA-256', () => {
  const file = path.join(ELECTRON_SOURCE_DIR, '../vendor/smartmontools/darwin/smartctl');
  assert.equal(
    verifyBundledBinary(file, { platform: 'darwin', arch: 'arm64', packaged: true }),
    true,
  );
  assert.equal(DIGESTS.darwin.arm64.length, 64);
});
test('bundled Windows x64 smartctl is authorized only for x64', () => {
  const file = path.join(ELECTRON_SOURCE_DIR, '../vendor/smartmontools/win32/smartctl.exe');
  assert.equal(verifyBundledBinary(file, { platform: 'win32', arch: 'x64', packaged: true }), true);
  assert.equal(
    verifyBundledBinary(file, { platform: 'win32', arch: 'arm64', packaged: true }),
    false,
  );
});
test('unknown platform/arch fails closed', () => {
  const file = path.join(ELECTRON_SOURCE_DIR, '../vendor/smartmontools/darwin/smartctl');
  assert.equal(
    verifyBundledBinary(file, { platform: 'win32', arch: 'ia32', packaged: true }),
    false,
  );
  assert.equal(
    verifyBundledBinary(file, { platform: 'darwin', arch: 'x64', packaged: true }),
    false,
  );
});
test('missing or changed binary fails closed', () => {
  assert.equal(
    verifyBundledBinary('/not/there', { platform: 'darwin', arch: 'arm64', packaged: true }),
    false,
  );
  const file = path.join(ELECTRON_SOURCE_DIR, '../vendor/smartmontools/darwin/README.txt');
  assert.equal(
    verifyBundledBinary(file, { platform: 'darwin', arch: 'arm64', packaged: true }),
    false,
  );
});
