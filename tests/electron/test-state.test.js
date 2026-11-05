'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selfTestRunning } = require('../../electron/devices/test-state.js');
test('NVMe laufender und abgeschlossener Selbsttest', () => {
  assert.equal(
    selfTestRunning({ nvme_self_test_log: { current_self_test_operation: { value: 1 } } }),
    true,
  );
  assert.equal(
    selfTestRunning({ nvme_self_test_log: { current_self_test_operation: { value: 0 } } }),
    false,
  );
});
test('ATA laufender Selbsttest laut Status-Nibble', () => {
  assert.equal(
    selfTestRunning({ ata_smart_data: { self_test: { status: { value: 0xf9 } } } }),
    true,
  );
  assert.equal(selfTestRunning({ ata_smart_data: { self_test: { status: { value: 0 } } } }), false);
});
test('Fehlende Angaben sind kein Nachweis eines laufenden Tests', () =>
  assert.equal(selfTestRunning({}), false));
