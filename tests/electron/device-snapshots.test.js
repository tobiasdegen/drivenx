'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluate } = require('../../electron/diagnostics/health.js');
const { generateHTML: productionHTML, findingText } = require('../../electron/reports/report.js');
// Report tests construct the current diagnostic contract, never deprecated status-only fixtures.
const { evaluate: evaluateForReport } = require('../../electron/diagnostics/health.js');
const generateHTML = (detail, locale, prefs) =>
  productionHTML(
    {
      ...detail,
      health: detail?.health?.diagnosis ? detail.health : evaluateForReport(detail.raw || {}),
    },
    locale,
    prefs,
  );

const dir = path.join(ELECTRON_SOURCE_DIR, '..', 'fixtures', 'device-tests', 'reference');
const expected = Object.freeze({
  'hitachi-500': 'observe',
  'intel-128': 'critical',
  'seagate-250-a': 'defective',
  'seagate-250-b': 'defective',
  'seagate-500-a': 'ok',
  'seagate-500-b': 'ok',
  'samsung-t1': 'unassessable',
  'samsung-860-250-1935': 'ok',
  'samsung-860-250-1936': 'ok',
  'samsung-870-250': 'ok',
  'samsung-870-500': 'observe',
  'samsung-qvo-1927': 'warning',
  'samsung-qvo-1930': 'warning',
  'samsung-qvo-1931': 'warning',
  'wd-320': 'ok',
  'wd-500': 'ok',
  'wd-750': 'warning',
});
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));

test('the 17 anonymized real smartctl snapshots remain accounted for', () => {
  assert.deepEqual(
    fs.readdirSync(dir).sort(),
    Object.keys(expected)
      .map((name) => `${name}.json`)
      .sort(),
  );
});
for (const [name, status] of Object.entries(expected)) {
  test(`real SMART snapshot ${name}: ${status}`, () => {
    const raw = read(name);
    const original = JSON.stringify(raw);
    const result = evaluate(raw);
    assert.equal(visibleDiagnosisStatus(result), status);
    assert.equal(JSON.stringify(raw), original, 'evaluation must not mutate the SMART dump');
    assert.match(raw.serial_number, /^REDACTED-/);
    assert.equal(raw.wwn, undefined);
    assert.ok(Array.isArray(result.findings));
  });
}
test('both Seagate 250 GB drives are critical by normalized SMART 196 despite opaque raw', () => {
  for (const name of ['seagate-250-a', 'seagate-250-b']) {
    const result = evaluate(read(name));
    assert(result.findings.some((finding) => finding.code === 'smartFailed'));
    assert(
      result.findings.some(
        (finding) => finding.code === 'thresholdFailed' && finding.values.id === 196,
      ),
    );
    assert(!result.findings.some((finding) => finding.code === 'reallocationEvents'));
  }
});
test('the Intel program fail signal stays visible, without adding it to sector count', () => {
  const result = evaluate(read('intel-128'));
  assert(
    result.findings.some(
      (finding) => finding.code === 'reallocated' && finding.values.count === 18,
    ),
  );
  assert(
    result.findings.some(
      (finding) => finding.code === 'ssdProgramFailures' && finding.values.count === 18,
    ),
  );
  assert(!result.findings.some((finding) => finding.code === 'pending'));
});
test('the Samsung QVO 1011 CRC events are historical information, not media failure', () => {
  for (const name of ['samsung-qvo-1927', 'samsung-qvo-1930', 'samsung-qvo-1931']) {
    const result = evaluate(read(name));
    assert.equal(result.diagnosis.domains.media, 'ok');
    assert.equal(result.diagnosis.domains.connection, 'warning');
    assert(
      result.findings.some(
        (finding) => finding.code === 'ataCrcHistory' && finding.values.count === 1011,
      ),
    );
    assert(!result.findings.some((finding) => finding.code === 'noIssues'));
    assert.match(
      findingText(
        result.findings.find((finding) => finding.code === 'ataCrcHistory'),
        'de-DE',
      ),
      /1\.011/,
    );
    const html = generateHTML(
      { raw: read(name), health: result, device: { name: '/dev/sdc' } },
      'de-DE',
    );
    assert.match(html, /Historische Schnittstellen-CRC-Fehler/);
    assert.match(html, /Kabel|USB-Bridge/);
  }
});
test('two old CRC errors are also preserved without turning a healthy Samsung EVO into a warning', () => {
  const result = evaluate(read('samsung-870-500'));
  assert.equal(result.diagnosis.domains.media, 'ok');
  assert.equal(result.diagnosis.domains.connection, 'observe');
  assert(
    result.findings.some(
      (finding) => finding.code === 'ataCrcHistory' && finding.values.count === 2,
    ),
  );
});
test('WD 750 remains warning despite passed long self-test, and packed timeout is not a count', () => {
  const result = evaluate(read('wd-750'));
  assert.equal(visibleDiagnosisStatus(result), 'warning');
  assert(
    result.findings.some(
      (finding) => finding.code === 'uncorrectable' && finding.values.count === 2,
    ),
  );
  assert(!result.findings.some((finding) => finding.code === 'pending'));
  assert(!result.findings.some((finding) => finding.code === 'offlineUncorrectable'));
  const timeout = read('wd-750').ata_smart_attributes.table.find((a) => a.id === 188);
  assert.equal(timeout.raw.value, 8590065667);
});
test('limited SMART visibility from Samsung Portable SSD T1 does not masquerade as health', () => {
  const result = evaluate(read('samsung-t1'));
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert.equal(result.readout.status, 'fehlgeschlagen');
});
test('the Samsung 860 written-LBA counter changes backwards without being a defect diagnosis', () => {
  const first = read('samsung-860-250-1935');
  const second = read('samsung-860-250-1936');
  const written = (report) => report.ata_smart_attributes.table.find((a) => a.id === 241).raw.value;
  assert.equal(written(second) - written(first), -192);
  assert.equal(visibleDiagnosisStatus(evaluate(second)), 'ok');
});
test('the 870 QVO counter stays stable across the three consecutive dumps', () => {
  const reports = ['samsung-qvo-1927', 'samsung-qvo-1930', 'samsung-qvo-1931'].map(read);
  const attr = (report, id) => report.ata_smart_attributes.table.find((x) => x.id === id).raw.value;
  assert.deepEqual(
    reports.map((report) => attr(report, 199)),
    [1011, 1011, 1011],
  );
  assert.deepEqual(
    reports.map((report) => report.power_cycle_count),
    [884, 885, 886],
  );
});
