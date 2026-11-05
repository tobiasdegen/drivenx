'use strict';
const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { evaluate } = require('../../electron/diagnostics/health.js');
for (const [name, status, count] of [
  ['hitachi-500', 'observe', 6],
  ['hitachi-320', 'observe', 4],
  ['wd-500', 'ok', 0],
  ['samsung-860-500', 'ok', 0],
]) {
  test(`anonymized drive review ${name}`, () => {
    const report = require(
      path.join('..', '..', 'fixtures', 'device-tests', 'samples', `${name}.json`),
    );
    const health = evaluate(report);
    assert.equal(visibleDiagnosisStatus(health), status);
    assert.equal(report.ata_smart_error_log?.summary?.count ?? 0, count);
    if (name === 'hitachi-320') {
      assert(health.findings.some((f) => f.code === 'reallocationEvents' && f.values.count === 1));
      assert(!health.findings.some((f) => f.code === 'testsFailed'));
    }
  });
}
