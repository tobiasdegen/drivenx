'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifySmartFailure,
  smartProcessError,
  hasSmartctlAccessDenied,
} = require('../../electron/devices/smart-errors.js');
test('permission denied on unix is distinguished from broken SMART health', () => {
  assert.equal(
    classifySmartFailure({ stderr: 'Permission denied', platform: 'linux' }).code,
    'permission',
  );
  assert.equal(
    classifySmartFailure({ stderr: 'SMART overall-health FAILED', code: 4 }).code,
    'other',
  );
});
test('Windows access denied gives a specific administrator hint', () => {
  const result = classifySmartFailure({ stderr: 'Access is denied', platform: 'win32' });
  assert.equal(result.code, 'permission');
  assert.match(result.message, /Administratorrechten/);
});
test('unknown USB bridges are device issues, not privilege issues', () => {
  assert.equal(classifySmartFailure({ stderr: 'Unknown USB bridge' }).code, 'device');
});
test('missing binary and timeout remain distinct', () => {
  assert.equal(smartProcessError('missing', { code: 'ENOENT' }).code, 'missing_binary');
  assert.equal(smartProcessError('timeout', { code: 'ETIMEDOUT' }).code, 'timeout');
});
test('executable permission errors differ from device access errors', () => {
  assert.equal(
    smartProcessError('spawn: Permission denied', { code: 'EACCES_EXEC' }).code,
    'executable_blocked',
  );
});

test('Windows smartctl Open failed Error=5 is an explicit permission failure', () => {
  const message =
    'Smartctl open device /dev/sdb [SAT] failed: \\\\.\\PhysicalDrive1: Open failed, Error=5';
  assert.equal(classifySmartFailure({ message, platform: 'win32' }).code, 'permission');
  assert.equal(
    hasSmartctlAccessDenied({ smartctl: { messages: [{ severity: 'error', string: message }] } }),
    true,
  );
  assert.equal(
    hasSmartctlAccessDenied({
      smartctl: { messages: [{ severity: 'error', string: 'Device open failed, error=2' }] },
    }),
    false,
  );
  assert.equal(
    hasSmartctlAccessDenied({
      smartctl: { messages: [{ severity: 'warning', string: 'access denied' }] },
    }),
    true,
  );
  assert.equal(
    hasSmartctlAccessDenied({
      smartctl: { messages: [{ severity: 'info', string: 'access denied' }] },
    }),
    false,
  );
});

test('malformed input to access-denied classifier cannot crash the backend', () => {
  const { hasSmartctlAccessDenied } = require('../../electron/devices/smart-errors.js');
  for (const malformed of [
    null,
    0,
    '',
    false,
    [],
    { smartctl: 'invalid' },
    { smartctl: { messages: [null, 3, false] } },
  ]) {
    assert.equal(hasSmartctlAccessDenied(malformed), false);
  }
});

test('Linux polkit refusal is classified as missing permission', () => {
  const result = classifySmartFailure({
    stderr: 'Error executing command as another user: Not authorized',
    platform: 'linux',
  });
  assert.equal(result.code, 'permission');
  assert.match(result.message, /Polkit/);
});
