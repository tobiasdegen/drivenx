'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selfTestSupport, selfTestResult } = require('../../shared/self-test-assessment.mjs');
const {
  supportsSelfTest,
  testFailed,
  testInterrupted,
} = require('../../electron/diagnostics/health.js');
test('unknown capability cannot authorize a SMART self-test', () => {
  assert.equal(selfTestSupport({ ata_smart_attributes: { table: [{ id: 9 }] } }), 'unknown');
  assert.equal(selfTestSupport({ nvme_smart_health_information_log: {} }), 'unknown');
  assert.equal(supportsSelfTest({}), null);
  assert.equal(
    selfTestSupport({ ata_smart_data: { capabilities: { self_tests_supported: false } } }),
    'unsupported',
  );
  assert.equal(
    selfTestSupport({ ata_smart_data: { capabilities: { self_tests_supported: true } } }),
    'supported',
  );
  assert.equal(
    selfTestSupport({
      device: { protocol: 'NVMe' },
      nvme_optional_admin_commands: { self_test: true },
    }),
    'supported',
  );
});
test('self-test failures are classified identically in health and renderer', () => {
  for (const [status, expected] of [
    [{ passed: false, string: 'Aborted by host' }, 'interrupted'],
    [{ passed: false, string: 'Interrupted by reset' }, 'interrupted'],
    [{ passed: false, string: 'Completed: read failure' }, 'failed'],
    [{ passed: true, string: 'Completed without error' }, 'passed'],
    [{ string: 'Self-test in progress' }, 'running'],
  ]) {
    const row = { status };
    assert.equal(selfTestResult(row), expected);
    assert.equal(testFailed(row), expected === 'failed');
    assert.equal(testInterrupted(row), expected === 'interrupted');
  }
});
