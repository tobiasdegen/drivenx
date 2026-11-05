'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluate } = require('../../electron/diagnostics/health.js');
const fixtureDir = path.join(ELECTRON_SOURCE_DIR, '..', 'fixtures', 'diagnosis-reference');
const baseline = require('../../fixtures/diagnosis-reference/expected.json');

const attr = (id, name, raw) => ({ id, name, raw: String(raw) });
const diagnostic = (raw) => evaluate(raw).diagnosis;
let view;
async function helpers() {
  if (!view) view = await import('../../src/smart-attribute-status.mjs');
  return view;
}
function ata(rows, rotation = 7200) {
  return {
    device: { protocol: 'ATA' },
    rotation_rate: rotation,
    ata_smart_attributes: { table: rows },
    smart_status: { passed: true },
  };
}
function entry(id, name, value) {
  return { id, name, value: 100, thresh: 20, raw: { value, string: String(value) } };
}

test('ATA health evidence, not raw presence or obsolete fail flag, decides row severity', async () => {
  const { attributeSeverity } = await helpers();
  const raw = ata([
    entry(197, 'Current_Pending_Sector', 2),
    entry(199, 'UDMA_CRC_Error_Count', 110),
  ]);
  const diagnosis = diagnostic(raw);
  assert.equal(attributeSeverity(attr(197, 'Current_Pending_Sector', 2), diagnosis), 'critical');
  assert.equal(attributeSeverity(attr(199, 'UDMA_CRC_Error_Count', 110), diagnosis), 'warning');
  assert.equal(attributeSeverity(attr(9, 'Power_On_Hours', 110), diagnosis), null);
  assert.equal(
    attributeSeverity(attr(197, 'Different_Name', 0), { ...diagnosis, evidence: [] }),
    null,
  );
});

test('proprietary packed raw values do not acquire an invented warning', async () => {
  const { attributeSeverity } = await helpers();
  const raw = ata([{ id: 5, name: 'Some_Vendor_Code', raw: { string: '200 (43 8)' } }], 0);
  assert.equal(attributeSeverity(attr(5, 'Some_Vendor_Code', '200 (43 8)'), diagnostic(raw)), null);
});

test('NVMe health bits and media errors are mapped, log count alone is not', async () => {
  const { attributeSeverity } = await helpers();
  const raw = {
    device: { protocol: 'NVMe' },
    nvme_smart_health_information_log: {
      critical_warning: 4,
      media_errors: 2,
      num_err_log_entries: 7,
      percentage_used: 90,
      available_spare: 100,
      available_spare_threshold: 10,
      temperature: 42,
    },
  };
  const d = diagnostic(raw);
  assert.equal(attributeSeverity(attr('–', 'critical_warning', '4'), d), 'critical');
  assert.equal(attributeSeverity(attr('–', 'media_errors', '2'), d), 'critical');
  assert.equal(attributeSeverity(attr('–', 'percentage_used', '90'), d), 'warning');
  assert.equal(attributeSeverity(attr('–', 'num_err_log_entries', '7'), d), null);
});

test('SCSI aggregated errors only mark nonzero contributing rows', async () => {
  const { attributeSeverity } = await helpers();
  const raw = {
    device: { protocol: 'SCSI' },
    scsi_error_counter_log: {
      read: { total_uncorrected_errors: 3 },
      write: { total_uncorrected_errors: 0 },
      verify: { total_uncorrected_errors: 0 },
    },
  };
  const diagnosis = diagnostic(raw);
  assert.equal(
    attributeSeverity(attr('–', 'read / total_uncorrected_errors', '3'), diagnosis),
    'critical',
  );
  assert.equal(
    attributeSeverity(attr('–', 'write / total_uncorrected_errors', '0'), diagnosis),
    null,
  );
  assert.equal(
    attributeSeverity(attr('–', 'verify / total_uncorrected_errors', '–'), diagnosis),
    null,
  );
});

test('severity sorting is stable and unlinked global findings remain disclosed', async () => {
  const { attributeRowsWithStatus, sortAttributeRows, unlinkedEvidence } = await helpers();
  const diagnosis = {
    protocol: 'ata',
    evidence: [
      { ruleId: 'pending', source: 'ata_smart_attributes.197', severity: 'critical' },
      { ruleId: 'testsFailed', source: 'self_test_log', severity: 'defective' },
    ],
  };
  const rows = attributeRowsWithStatus([attr(9, 'Hours', 100), attr(197, 'Pending', 2)], diagnosis);
  assert.equal(sortAttributeRows(rows)[0].id, 197);
  assert.deepEqual(
    unlinkedEvidence(rows, diagnosis).map((item) => item.ruleId),
    ['testsFailed'],
  );
});

test('all indexed real captures get reproducible table annotations', async () => {
  const { attributeRowsWithStatus } = await helpers();
  for (const { file } of baseline.cases) {
    const raw = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8'));
    const rows = (raw.ata_smart_attributes?.table || []).map((entry) =>
      attr(entry.id, entry.name, entry.raw?.string ?? entry.raw?.value ?? '–'),
    );
    const diagnosis = diagnostic(raw);
    const items = attributeRowsWithStatus(rows, diagnosis);
    assert.equal(items.length, rows.length);
    for (const item of items) assert.ok(item.severity !== undefined);
  }
});
