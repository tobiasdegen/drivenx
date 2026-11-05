'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backendError, userErrorMessage } = require('../../electron/security/user-errors.js');
const { createScanController } = require('../../electron/devices/scan-controller.js');
const de = require('../../locales/de-DE.json');
const en = require('../../locales/en-US.json');

test('the same backend error code yields German and English IPC messages', () => {
  for (const key of [
    'scanGenerationChanged',
    'staleDiagnosisData',
    'selfTestUnsupported',
    'queryResultUnavailable',
    'reportChangedDuringExport',
  ]) {
    const error = backendError(key);
    assert.equal(error.message, de.backendErrors[key]);
    assert.equal(userErrorMessage(error, 'de-DE'), de.backendErrors[key]);
    assert.equal(userErrorMessage(error, 'en-US'), en.backendErrors[key]);
    assert.notEqual(de.backendErrors[key], en.backendErrors[key]);
  }
});

test('unknown exceptions and genuine smartctl output are not falsely translated', () => {
  const raw = new Error('smartctl: Unsupported device transport');
  assert.equal(userErrorMessage(raw, 'en-US'), raw.message);
  assert.equal(userErrorMessage('device open failed', 'de-DE'), 'device open failed');
  assert.throws(() => backendError('__invalid_key'), /Unknown backend error/);
});

test('scan authorization errors carry the stable localizable code', () => {
  const scan = createScanController({
    platform: 'darwin',
    scanDevices: async () => ({ devices: [], warnings: [] }),
    safeDevice: (device) => device,
    deviceKey: (device) => `${device.name}\0${device.type}`,
    reports: { reset() {} },
    isTestPending: () => false,
  });
  assert.throws(
    () => scan.assertDevice({ name: '/dev/disk9', type: 'auto' }),
    (error) => {
      assert.equal(error.userMessageKey, 'deviceNotInScan');
      assert.match(userErrorMessage(error, 'en-US'), /current scan/);
      return true;
    },
  );
});
