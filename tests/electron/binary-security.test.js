'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validBinaryPath,
  isSmartctlVersion,
} = require('../../electron/security/binary-security.js');
test('custom smartctl path must be absolute', () => {
  assert.equal(validBinaryPath('./smartctl', 'linux'), false);
  assert.equal(validBinaryPath('/usr/bin/smartctl', 'linux'), true);
  assert.equal(validBinaryPath('smartctl.exe', 'win32'), false);
  assert.equal(
    validBinaryPath('C:\\Program Files\\smartmontools\\bin\\smartctl.exe', 'win32'),
    true,
  );
  assert.equal(validBinaryPath('C:\\tools\\smartctl.bat', 'win32'), false);
});
test('smartctl identity rejects unrelated version output', () => {
  assert.equal(isSmartctlVersion('smartctl 7.5 2025-04-30'), true);
  assert.equal(isSmartctlVersion('malware 1.0'), false);
  assert.equal(isSmartctlVersion(''), false);
});
