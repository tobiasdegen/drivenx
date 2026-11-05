'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluate } = require('../../electron/diagnostics/health.js');
const { isAtaSsd, ssdFindings } = require('../../electron/diagnostics/ssd-health.js');
const { findingText, generateHTML } = require('../../electron/reports/report.js');

const fixtures = path.join(ELECTRON_SOURCE_DIR, '..', 'fixtures', 'device-tests', 'reference');
const load = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, `${name}.json`), 'utf8'));
function sample(rows, extra = {}) {
  return {
    rotation_rate: 0,
    device: { protocol: 'ATA' },
    smart_status: { passed: true },
    ata_smart_attributes: { table: rows },
    ...extra,
  };
}
const row = (id, name, string, value = Number(string)) => ({
  id,
  name,
  value: 100,
  worst: 100,
  thresh: 10,
  raw: { string, value },
});
const finding = (raw, code) => evaluate(raw).findings.filter((entry) => entry.code === code);

test('actual Intel 128GB: repeated program failures are critical while unknown vendor wearout raw remains opaque', () => {
  const raw = load('intel-128');
  assert.equal(visibleDiagnosisStatus(evaluate(raw)), 'critical');
  assert.deepEqual(
    finding(raw, 'ssdProgramFailures').map((f) => f.values),
    [{ id: 171, count: 18 }],
  );
  assert.equal(finding(raw, 'ssdEraseFailures').length, 0);
  assert.equal(finding(raw, 'ssdEnduranceUsed').length, 0);
  assert.equal(finding(raw, 'ssdReserveLow').length, 0);
  // 233.value=82 is a normalized health parameter, not 82% wear consumed.
  assert.equal(raw.ata_smart_attributes.table.find((item) => item.id === 233).value, 82);
});

test('real Samsung 870 QVO and 860 EVO are healthy with separate device endurance and reserve values', () => {
  for (const [name, wear] of [
    ['samsung-qvo-1927', 3],
    ['samsung-860-250-1935', 7],
  ]) {
    const raw = load(name);
    assert.equal(isAtaSsd(raw), true);
    assert.equal(raw.endurance_used.current_percent, wear);
    assert.equal(raw.spare_available.current_percent, 100);
    assert.equal(evaluate(raw).diagnosis.domains.media, 'ok');
    assert.equal(finding(raw, 'ssdReserveLow').length, 0);
    assert.equal(finding(raw, 'ssdProgramFailures').length, 0);
  }
});

test('Samsung 870 EVO with 462 added bad flash blocks is informational, not 462 user-sector defects', () => {
  const raw = load('samsung-870-500');
  assert.equal(evaluate(raw).diagnosis.domains.media, 'ok');
  assert.deepEqual(
    finding(raw, 'ssdFlashBlockHistory').map((f) => f.values),
    [{ id: 252, count: 462 }],
  );
  assert.equal(finding(raw, 'ssdReservedBlocksUsed').length, 0);
  assert.equal(finding(raw, 'ssdRuntimeBadBlocks').length, 0);
  assert.equal(finding(raw, 'noIssues').length, 0);
  assert.match(findingText(finding(raw, 'ssdFlashBlockHistory')[0], 'de-DE'), /462/);
});

test('verified Samsung and Intel names for programming, erase and spare block counters are independent', () => {
  const raw = sample([
    row(181, 'Program_Fail_Cnt_Total', '4'),
    row(182, 'Erase_Fail_Count_Total', '2'),
    row(179, 'Used_Rsvd_Blk_Cnt_Tot', '3'),
    row(183, 'Runtime_Bad_Block', '1'),
  ]);
  assert.equal(visibleDiagnosisStatus(evaluate(raw)), 'warning');
  for (const code of [
    'ssdProgramFailures',
    'ssdEraseFailures',
    'ssdReservedBlocksUsed',
    'ssdRuntimeBadBlocks',
  ])
    assert.equal(finding(raw, code).length, 1, `${code} must be shown`);
  const html = generateHTML({ raw, health: evaluate(raw), device: { name: '/dev/sdb' } });
  assert.match(html, /Löschfehler/);
  assert.match(html, /Reserveblöcke/);
});

test('ambiguous SSD packed raw is never converted into a decimal count', () => {
  const raw = sample([row(181, 'Program_Fail_Cnt_Total', '19 (1986 14)', 8529805967379)]);
  assert.equal(finding(raw, 'ssdProgramFailures').length, 0);
  assert.deepEqual(
    finding(raw, 'ssdPackedErrorCounter').map((f) => f.values),
    [{ id: 181 }],
  );
});

test('do not interpret ATA SMART IDs as SSD error counters on HDDs or with unrelated names', () => {
  const fakeHdd = sample([row(181, 'Program_Fail_Cnt_Total', '3')], { rotation_rate: 5400 });
  assert.equal(isAtaSsd(fakeHdd), false);
  assert.equal(ssdFindings(fakeHdd).length, 0);
  assert.equal(finding(fakeHdd, 'ssdProgramFailures').length, 0);
  const unknownId = sample([
    row(181, 'Unknown_Attribute', '3'),
    row(183, 'SATA_Downshift_Count', '5'),
  ]);
  assert.equal(finding(unknownId, 'ssdProgramFailures').length, 0);
  assert.equal(finding(unknownId, 'ssdRuntimeBadBlocks').length, 0);
});

test('device-supplied SATA SSD spare threshold and rated endurance are independent warnings', () => {
  const raw = sample([], {
    spare_available: { current_percent: 5, threshold_percent: 10 },
    endurance_used: { current_percent: 103 },
  });
  assert.equal(visibleDiagnosisStatus(evaluate(raw)), 'warning');
  assert.deepEqual(
    finding(raw, 'ssdReserveLow').map((f) => f.values),
    [{ spare: 5, threshold: 10 }],
  );
  assert.deepEqual(
    finding(raw, 'ssdEnduranceUsed').map((f) => f.values),
    [{ used: 103 }],
  );
  assert.equal(
    finding(
      sample([], { spare_available: { current_percent: 10, threshold_percent: 10 } }),
      'ssdReserveLow',
    ).length,
    0,
  );
  assert.equal(
    finding(sample([], { spare_available: { current_percent: 5 } }), 'ssdReserveLow').length,
    0,
  );
  assert.equal(
    finding(sample([], { endurance_used: { current_percent: 7 } }), 'ssdEnduranceUsed').length,
    0,
  );
});

test('HDD with smartctl spare_available must not be labeled as SSD in the UI', () => {
  const panel = fs.readFileSync(
    path.join(ELECTRON_SOURCE_DIR, '..', 'src', 'components', 'tabs', 'AtaStatisticsPanel.tsx'),
    'utf8',
  );
  assert.match(panel, /raw\.rotation_rate\s*===\s*0/);
  assert.match(panel, /const\s+spare\s*=\s*isSsd\s*\?\s*raw\.spare_available\s*:\s*undefined/);
});

test('overview shows SATA SSD endurance only from explicit smartctl percentage', async () => {
  const { overviewMetrics } = await import('../../shared/overview-metrics.mjs');
  assert.equal(overviewMetrics(load('samsung-qvo-1927')).wearPercent, 3);
  assert.equal(overviewMetrics(load('samsung-860-250-1935')).wearPercent, 7);
  assert.equal(overviewMetrics(load('intel-128')).wearPercent, null);
  const hdd = sample([], { rotation_rate: 5400, endurance_used: { current_percent: 20 } });
  assert.equal(overviewMetrics(hdd).wearPercent, null);
  const dashboard = fs.readFileSync(
    path.join(ELECTRON_SOURCE_DIR, '..', 'src/components/DriveOverview.tsx'),
    'utf8',
  );
  assert.match(dashboard, /showWear\s*&&\s*kpi\(\s*tr\(\s*'overviewWear'\s*\)/);
});
