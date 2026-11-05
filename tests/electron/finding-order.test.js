const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sortFindings } = require('../../electron/diagnostics/finding-order.js');
const { evaluate } = require('../../electron/diagnostics/health.js');
const { generateHTML } = require('../../electron/reports/report.js');

const fujitsu = require('../../fixtures/fujitsu-sample.json');
test('Fujitsu: confirmed failures precede vendor ambiguity', () => {
  const result = evaluate(fujitsu);
  assert.equal(visibleDiagnosisStatus(result), 'defective');
  const codes = result.findings.map((f) => f.code);
  assert(codes.indexOf('testsFailed') >= 0 && codes.indexOf('ataErrors') >= 0);
  assert(codes.indexOf('testsFailed') < codes.indexOf('ataErrors'));
  assert(codes.indexOf('ataErrors') < codes.indexOf('vendorRaw'));
});
test('finding order is stable and never mutates input', () => {
  const entries = [
    { level: 'info', code: 'noData' },
    { level: 'kritisch', code: 'ataErrors' },
    { level: 'kritisch', code: 'testsFailed' },
    { level: 'warnung', code: 'vendorRaw' },
  ];
  const sorted = sortFindings(entries);
  assert.deepEqual(
    sorted.map((x) => x.code),
    ['testsFailed', 'ataErrors', 'vendorRaw', 'noData'],
  );
  assert.equal(entries[0].code, 'noData');
});
test('report prioritizes critical evidence even with unsorted supplied findings', () => {
  const health = evaluate(fujitsu);
  const html = generateHTML({ raw: fujitsu, health, device: { name: '/dev/sdb' } }, 'de-DE');
  const tests = html.indexOf('2 SMART-Selbsttests');
  const errors = html.indexOf('9.080 ATA-Fehler');
  const vendor = html.indexOf('Reallocated_Sector_Ct');
  assert(tests !== -1 && errors !== -1 && vendor !== -1);
  assert(tests < errors && errors < vendor);
});
