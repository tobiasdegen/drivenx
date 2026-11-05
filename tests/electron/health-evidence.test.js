'use strict';
const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, testFailed, testHistory } = require('../../electron/diagnostics/health.js');
const fujitsu = require('../../fixtures/extended-readouts/fujitsu-extended.json');
const hitachi = require('../../fixtures/extended-readouts/hitachi-extended.json');
const healthy = { smart_status: { passed: true }, ata_smart_attributes: { table: [] } };

function row(type, status, passed, hours) {
  return { type: { string: type }, status: { string: status, passed }, lifetime_hours: hours };
}

test('9081 lifetime ATA errors alone mean warning, not current critical media failure', () => {
  const result = evaluate({ ...healthy, ata_smart_error_log: { extended: { count: 9081 } } }, 64);
  assert.equal(visibleDiagnosisStatus(result), 'observe');
  assert(
    result.findings.some((finding) => finding.code === 'ataErrors' && finding.level === 'warnung'),
  );
  assert(!result.findings.some((finding) => finding.level === 'kritisch'));
});

test('real Fujitsu stays critical due to documented failed read tests, regardless of error count rule', () => {
  const result = evaluate(fujitsu);
  assert.equal(visibleDiagnosisStatus(result), 'defective');
  assert(
    result.findings.some((finding) => finding.code === 'testsFailed' && finding.values.count === 2),
  );
  assert(
    result.findings.some(
      (finding) => finding.code === 'ataErrors' && finding.values.count === 9081,
    ),
  );
});

test('actual Hitachi retains warning for historical ATA errors and reallocation events', () => {
  const result = evaluate(hitachi);
  assert.equal(visibleDiagnosisStatus(result), 'observe');
  assert(!result.findings.some((finding) => finding.code === 'testsFailed'));
});

test('host-cancelled and reset-interrupted tests do not count as drive failures', () => {
  for (const status of [
    'Aborted by host',
    'Interrupted (host reset)',
    'Self-test interrupted by host reset',
  ]) {
    const entry = row('Short offline', status, false, 300);
    assert.equal(testFailed(entry), false, status);
    const result = evaluate(
      { ...healthy, ata_smart_self_test_log: { extended: { table: [entry] } } },
      0,
    );
    assert.equal(visibleDiagnosisStatus(result), 'unassessable');
    assert(
      result.findings.some(
        (finding) => finding.code === 'testsInterrupted' && finding.level === 'info',
      ),
    );
  }
});

test('newer successful extended test supersedes older failures without hiding the history', () => {
  const rows = [
    row('Extended offline', 'Completed without error', true, 1000),
    row('Short offline', 'Completed: read failure', false, 990),
  ];
  assert.deepEqual(testHistory(rows), { failed: 0, historical: 1, interrupted: 0 });
  const result = evaluate(
    { ...healthy, ata_smart_self_test_log: { extended: { table: rows } } },
    0,
  );
  assert.equal(visibleDiagnosisStatus(result), 'observe');
  assert(result.findings.some((finding) => finding.code === 'testsHistorical'));
  assert(!result.findings.some((finding) => finding.code === 'testsFailed'));
});

test('new failing test remains critical even with older successful extended test', () => {
  const rows = [
    row('Short offline', 'Completed: read failure', false, 1010),
    row('Extended offline', 'Completed without error', true, 1000),
  ];
  const result = evaluate(
    { ...healthy, ata_smart_self_test_log: { extended: { table: rows } } },
    128,
  );
  assert.equal(visibleDiagnosisStatus(result), 'defective');
  assert(
    result.findings.some((finding) => finding.code === 'testsFailed' && finding.values.count === 1),
  );
});

test('failure after a successful long test is never waived by an older success', () => {
  const rows = [
    row('Extended offline', 'Completed: read failure', false, 10),
    row('Extended offline', 'Completed without error', true, 65534),
  ];
  // ATA lifetime hours may wrap; chronological table order is authoritative.
  assert.equal(testHistory(rows).failed, 1);
});

test('a successful short test does not supersede a failed extended test', () => {
  const rows = [
    row('Short offline', 'Completed without error', true, 400),
    row('Extended offline', 'Completed: read failure', false, 350),
  ];
  assert.equal(testHistory(rows).failed, 1);
  assert.equal(testHistory(rows).historical, 0);
});

test('PDF and UI both explain host-cancelled tests without claiming a defective medium', () => {
  const { generateHTML } = require('../../electron/reports/report.js');
  const entry = row('Short offline', 'Aborted by host', false, 100);
  const raw = { ...healthy, ata_smart_self_test_log: { extended: { table: [entry] } } };
  const health = evaluate(raw);
  const html = generateHTML({ raw, health, device: { name: '/dev/sdc' } }, 'de-DE');
  assert.match(html, /Selbsttests abgebrochen oder unterbrochen/);
  assert.match(html, /beweist keinen Mediendefekt/);
  assert.doesNotMatch(html, /SMART-Selbsttests mit Fehlern fehlgeschlagen/);
});
