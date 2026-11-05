'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluate } = require('../../electron/diagnostics/health.js');
const { healthCoverage } = require('../../electron/diagnostics/health-coverage.js');
const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');
const dir = path.join(ELECTRON_SOURCE_DIR, '..', 'fixtures', 'diagnosis-reference');
const baseline = require('../../fixtures/diagnosis-reference/expected.json');

function nvme(values) {
  return {
    device: { protocol: 'NVMe' },
    nvme_smart_health_information_log: {
      critical_warning: 0,
      media_errors: 0,
      available_spare: 100,
      available_spare_threshold: 10,
      percentage_used: 2,
      ...values,
    },
  };
}
function ata(rows, extras = {}) {
  return {
    device: { protocol: 'ATA' },
    smart_status: { passed: true },
    ata_smart_attributes: { table: rows },
    ...extras,
  };
}
function a(id, count) {
  return { id, raw: { string: String(count), value: count } };
}

test('43 anonymized real smartctl captures match expected diagnosis classifications', () => {
  assert.equal(baseline.captures, 43);
  assert.equal(baseline.cases.length, 43);
  const outcomes = { complete: 0, partial: 0, unassessable: 0 };
  for (const entry of baseline.cases) {
    const file = path.join(dir, entry.file);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(!('serial_number' in raw) && !('wwn' in raw));
    const diagnosis = evaluate(raw).diagnosis;
    outcomes[diagnosis.assessment]++;
    assert.deepEqual(
      {
        assessment: diagnosis.assessment,
        media: diagnosis.domains.media,
        connection: diagnosis.domains.connection,
        thermal: diagnosis.domains.thermal,
        overallAlert: diagnosis.overallAlert,
      },
      entry.expected,
      `${entry.file}: ${entry.model}`,
    );
    assert.equal(diagnosis.algorithmVersion, baseline.algorithmVersion);
    for (const evidence of diagnosis.evidence) {
      assert(['media', 'connection', 'thermal'].includes(evidence.domain));
      assert(['ok', 'observe', 'warning', 'critical', 'defective'].includes(evidence.severity));
      assert.equal(typeof evidence.ruleId, 'string');
      assert.equal(typeof evidence.source, 'string');
    }
    if (diagnosis.assessment === 'unassessable' && diagnosis.overallAlert === null)
      assert.equal(visibleDiagnosisStatus({ diagnosis }), 'unassessable');
  }
  assert.deepEqual(outcomes, { complete: 42, partial: 1, unassessable: 0 });
});

test('SMART passed and six unrelated ATA IDs cannot establish healthy media', () => {
  const result = evaluate(ata([9, 12, 190, 192, 193, 194].map((id) => a(id, 0))));
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert.equal(result.readout.status, 'eingeschraenkt');
  assert.equal(result.diagnosis.domains.media, null);
  assert.equal(result.diagnosis.assessment, 'partial');
});

test('NVMe needs a real health log; partial success and optional command logs are not sufficient', () => {
  for (const raw of [
    nvme({ available_spare_threshold: undefined }),
    {
      device: { protocol: 'NVMe' },
      smart_status: { passed: true },
      nvme_smart_health_information_log: { num_err_log_entries: 123 },
    },
  ]) {
    const result = evaluate(raw);
    assert.notEqual(visibleDiagnosisStatus(result), 'ok');
    assert.equal(result.diagnosis.domains.media, null);
  }
  const readError = evaluate(nvme({ num_err_log_entries: 3000 }), 4);
  // Exit bit 2 can mean an optional -x command failed despite a full health log.
  assert.equal(readError.diagnosis.assessment, 'complete');
  assert.equal(readError.diagnosis.domains.media, 'ok');
});

test('NVMe warning bits are decoded without treating unknown bits as proved failure', () => {
  const readOnly = evaluate(nvme({ critical_warning: 8 }));
  assert.equal(readOnly.diagnosis.domains.media, 'defective');
  const overheated = evaluate(nvme({ critical_warning: 2 }));
  assert.equal(overheated.diagnosis.domains.thermal, 'critical');
  assert.equal(overheated.diagnosis.domains.media, 'ok');
  const unknown = evaluate(nvme({ critical_warning: 32 }));
  assert.equal(unknown.diagnosis.assessment, 'partial');
  assert.equal(unknown.diagnosis.domains.media, 'warning');
  assert(unknown.diagnosis.evidence.some((x) => x.ruleId === 'nvme_unknown_warning_bits'));
  const invalid = evaluate(nvme({ critical_warning: 2 ** 40 }));
  assert.equal(invalid.diagnosis.assessment, 'partial');
  assert.equal(invalid.diagnosis.domains.media, 'warning');
});

test('NVMe reserve threshold equality is a critical media warning', () => {
  const result = evaluate(nvme({ available_spare: 10, available_spare_threshold: 10 }));
  assert.equal(result.diagnosis.domains.media, 'critical');
  assert(result.diagnosis.evidence.some((x) => x.ruleId === 'nvme_spare_threshold'));
});

test('SCSI needs read/write/verify counters and preserves positive errors on partial readouts', () => {
  const scsi = (counters) => ({
    device: { protocol: 'SCSI' },
    scsi_error_counter_log: Object.fromEntries(
      Object.entries(counters).map(([name, value]) => [name, { total_uncorrected_errors: value }]),
    ),
  });
  assert.equal(evaluate(scsi({ read: 0, write: 0, verify: 0 })).diagnosis.domains.media, 'ok');
  assert.equal(evaluate(scsi({ read: 0, write: 0 })).diagnosis.domains.media, null);
  const fault = evaluate(scsi({ read: 1 }));
  assert.equal(fault.diagnosis.domains.media, 'critical');
  assert.equal(fault.diagnosis.assessment, 'partial');
});

test('connection counters are independent from NAND/media health', () => {
  const raw = ata(
    [
      { ...a(5, 0), name: 'Reallocated_Sector_Ct' },
      { ...a(197, 0), name: 'Current_Pending_Sector' },
      { ...a(198, 0), name: 'Offline_Uncorrectable' },
      { ...a(199, 1000), name: 'UDMA_CRC_Error_Count' },
    ],
    { rotation_rate: 7200 },
  );
  const diagnosis = evaluate(raw).diagnosis;
  assert.equal(diagnosis.domains.connection, 'warning');
  assert.equal(diagnosis.domains.media, 'ok');
  assert.equal(diagnosis.overallAlert, 'warning');
});

test('ATA manufacturer failure is defective even with partial SMART data', () => {
  const raw = ata([a(9, 123)], { smart_status: { passed: false } });
  const result = evaluate(raw);
  assert.equal(result.diagnosis.domains.media, 'defective');
  assert.equal(result.diagnosis.assessment, 'partial');
  assert(result.diagnosis.recommendedActionCodes.includes('prioritize_backup_or_imaging'));
});

test('current manufacturer temperature limits are used, not historical maximum temperatures', () => {
  const raw = nvme({});
  raw.temperature = { current: 83, op_limit_max: 80, critical_limit_max: 86, lifetime_max: 100 };
  assert.equal(evaluate(raw).diagnosis.domains.thermal, 'warning');
  raw.temperature.current = 87;
  assert.equal(evaluate(raw).diagnosis.domains.thermal, 'critical');
  raw.temperature.current = 40;
  assert.equal(evaluate(raw).diagnosis.domains.thermal, null);
  raw.temperature.current = null;
  assert.equal(evaluate(raw).diagnosis.domains.thermal, null);
});

test('invalid and vendor-packed ATA inputs do not throw or invent scalar failure counts', () => {
  const irregular = [
    null,
    false,
    { id: 5, raw: { string: '12598 (41936 1)', value: 99999 } },
    { id: 197, raw: null },
    a(198, 0),
  ];
  const raw = ata(irregular, { ata_smart_self_test_log: { extended: { table: [null] } } });
  assert.doesNotThrow(() => evaluate(raw));
  const result = evaluate(raw);
  assert.equal(result.diagnosis.assessment, 'partial');
  assert(
    !result.diagnosis.evidence.some((x) => x.ruleId === 'reallocated' && x.actualValue === 12598),
  );
});

test('missing diagnostic result is not silently interpreted as healthy', () => {
  assert.equal(visibleDiagnosisStatus({}), 'unassessable');
});

test('health.diagnosis is the only diagnostic status contract', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'capture-024.json'), 'utf8'));
  const health = evaluate(raw);
  assert.equal(Object.hasOwn(health, 'status'), false);
  assert.equal(health.diagnosis.algorithmVersion, '1.0.0');
  assert.equal(visibleDiagnosisStatus(health), 'warning');
  assert.equal(health.diagnosis.domains.media, 'ok');
  assert.equal(health.diagnosis.domains.connection, 'warning');
});

test('real Intel and Micron NAND defects are critical even with SMART PASS', () => {
  for (const name of ['capture-006.json', 'capture-009.json']) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const result = evaluate(raw);
    assert.equal(result.diagnosis.domains.media, 'critical', name);
    assert.equal(visibleDiagnosisStatus(result), 'critical', name);
    assert(
      result.diagnosis.evidence.some((item) => item.mappingConfidence === 'verified'),
      name,
    );
  }
});

test('raw Media Health and communication history are independent', () => {
  const observations = [
    { file: 'capture-023.json', media: 'ok', connection: 'observe' },
    { file: 'capture-024.json', media: 'ok', connection: 'warning' },
  ];
  for (const item of observations) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, item.file), 'utf8'));
    const result = evaluate(raw);
    assert.equal(result.diagnosis.domains.media, item.media);
    assert.equal(result.diagnosis.domains.connection, item.connection);
    assert(
      !result.diagnosis.evidence.some(
        (e) => e.ruleId === 'ata_crc_history' && e.domain === 'media',
      ),
    );
  }
});

test('visible diagnosis findings do not repeat a CRC history already explained by diagnostic evidence', async () => {
  const { visibleDiagnosisFindings } = await import('../../shared/diagnosis-model.mjs');
  const result = visibleDiagnosisFindings({
    diagnosis: {
      domains: { media: 'ok', connection: 'observe' },
      evidence: [
        {
          ruleId: 'ata_crc_history',
          source: 'ata_smart_attributes.199',
          severity: 'observe',
          actualValue: 1,
        },
      ],
    },
    findings: [{ code: 'ataCrcHistory', level: 'info', values: { count: 1 } }],
  });
  assert.equal(result.filter((x) => x.code === 'ata_crc_history').length, 1);
  assert.equal(
    result.some((x) => x.code === 'ataCrcHistory'),
    false,
  );
});
