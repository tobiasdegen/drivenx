const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');
const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, firstDecimal } = require('../../electron/diagnostics/health.js');
const fixture = require('../../fixtures/fujitsu-sample.json');
test('actual supplied Fujitsu: critical despite passed overall flag', () => {
  const r = evaluate(fixture);
  assert.equal(visibleDiagnosisStatus(r), 'defective');
  assert(r.findings.some((f) => f.code === 'testsFailed' && f.values.count === 2));
  assert(r.findings.some((f) => f.code === 'ataErrors' && f.values.count === 9080));
});
test('packed Fujitsu raw attribute is 19, not 8529805967379', () =>
  assert.equal(firstDecimal(fixture.ata_smart_attributes.table.find((a) => a.id === 5)), 19));
test('SMART PASS with an empty ATA attribute table is unknown and incomplete', () => {
  const result = evaluate({ smart_status: { passed: true }, ata_smart_attributes: { table: [] } });
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert.equal(result.readout.status, 'fehlgeschlagen');
  assert(result.readout.issues.some((x) => x.code === 'noHealthData'));
  assert(!result.findings.some((x) => x.code === 'noIssues'));
});
test('SMART PASS without protocol-specific health information is not enough', () => {
  const result = evaluate({ smart_status: { passed: true } });
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert.equal(result.readout.status, 'fehlgeschlagen');
});
test('SMART PASS with an isolated ATA attribute remains incomplete', () => {
  const result = evaluate({
    smart_status: { passed: true },
    ata_smart_attributes: { table: [{ id: 9, value: 99, thresh: 0, raw: { string: '100' } }] },
  });
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert.equal(result.readout.status, 'eingeschraenkt');
});
test('pending sector escalated', () =>
  assert.equal(
    visibleDiagnosisStatus(
      evaluate({
        smart_status: { passed: true },
        rotation_rate: 7200,
        ata_smart_attributes: {
          table: [{ id: 197, name: 'Current_Pending_Sector', raw: { string: '1', value: 1 } }],
        },
      }),
    ),
    'critical',
  ));
test('unparsed packed raw does not falsely become numeric count', () =>
  assert.equal(firstDecimal({ raw: { string: 'n/a', value: 999999 } }), null));

require('node:test')('SCSI uncorrected read errors are critical', () => {
  const assert = require('node:assert/strict');
  const { evaluate } = require('../../electron/diagnostics/health.js');
  const d = {
    device: { protocol: 'SCSI' },
    smart_status: { passed: true },
    scsi_error_counter_log: {
      read: { total_uncorrected_errors: 3 },
      write: { total_uncorrected_errors: 0 },
    },
  };
  assert.equal(visibleDiagnosisStatus(evaluate(d, 0)), 'critical');
});

const fs = require('node:fs');
const path = require('node:path');
const fixtures = path.join(ELECTRON_SOURCE_DIR, '..', 'fixtures', 'device-tests');
for (const [file, expected] of [
  ['drive-apple-ssd-ap0512z.json', 'ok'],
  ['drive-samsung-ssd-860-evo-500gb.json', 'ok'],
  ['drive-wdc-wd5000bevt-00a0rt0.json', 'ok'],
  ['drive-wdc-wd5000bevt-22zat0.json', 'ok'],
  ['drive-hitachi-hts543232l9a300.json', 'observe'],
  ['drive-hitachi-hts545050b9a300.json', 'observe'],
]) {
  test(`drive regression ${file}`, () => {
    const json = JSON.parse(fs.readFileSync(path.join(fixtures, file), 'utf8'));
    assert.equal(visibleDiagnosisStatus(evaluate(json)), expected);
    if (json.device.protocol === 'NVMe')
      assert.equal(evaluate(json).readout.status, 'eingeschraenkt');
  });
}

for (const [filename, expect] of [
  ['DriveNX_SAMSUNG_KUS020203M-B000.json', 3802],
  ['DriveNX_SAMSUNG_KUS040202M-B000.json', 1800],
]) {
  test(`Surface NVMe commands ${filename}`, () => {
    const r = JSON.parse(fs.readFileSync(path.join(fixtures, filename), 'utf8'));
    const { nvmeErrorSummary, supportsSelfTest } = require('../../electron/diagnostics/health.js');
    const result = evaluate(r);
    const summary = nvmeErrorSummary(r);
    assert.equal(visibleDiagnosisStatus(result), 'ok');
    assert.equal(summary.cumulative, expect);
    assert.equal(summary.entries, 16);
    assert.equal(summary.media, 0);
    assert(summary.command > 0);
    assert(summary.partial);
    assert.equal(supportsSelfTest(r), false);
  });
}
test('Samsung 860 EVO successful test is not a failure', () => {
  const r = JSON.parse(
    fs.readFileSync(path.join(fixtures, 'DriveNX_Samsung_SSD_860_EVO_1TB.json'), 'utf8'),
  );
  const { testRows, testFailed } = require('../../electron/diagnostics/health.js');
  assert.equal(testRows(r).length, 1);
  assert.equal(testRows(r).filter(testFailed).length, 0);
  assert.equal(visibleDiagnosisStatus(evaluate(r)), 'ok');
});
test('NVMe media status code remains visible as warning', () => {
  const r = {
    smart_status: { passed: true },
    nvme_smart_health_information_log: {
      critical_warning: 0,
      media_errors: 0,
      num_err_log_entries: 1,
    },
    nvme_error_information_log: {
      table: [{ status_field: { status_code_type: 2, status_code: 128 } }],
    },
  };
  assert.equal(visibleDiagnosisStatus(evaluate(r)), 'warning');
});

test('historical ATA threshold violation is warning, not current failure', () => {
  const r = {
    smart_status: { passed: true },
    ata_smart_attributes: {
      table: [
        {
          id: 9,
          name: 'Power_On_Hours',
          value: 100,
          worst: 1,
          thresh: 10,
          when_failed: 'In_the_past',
          raw: { string: '1000' },
        },
      ],
    },
  };
  const result = evaluate(r);
  assert.equal(visibleDiagnosisStatus(result), 'warning');
  assert(result.findings.some((f) => f.code === 'thresholdPast'));
  assert(!result.findings.some((f) => f.code === 'thresholdFailed'));
});
test('current ATA threshold violation is a device-reported failure', () => {
  const r = {
    smart_status: { passed: true },
    ata_smart_attributes: {
      table: [
        { id: 9, value: 5, worst: 5, thresh: 10, when_failed: 'now', raw: { string: '1000' } },
      ],
    },
  };
  assert.equal(visibleDiagnosisStatus(evaluate(r)), 'defective');
});
test('historical ATA violation with pending sectors remains critical', () => {
  const r = {
    smart_status: { passed: true },
    rotation_rate: 7200,
    ata_smart_attributes: {
      table: [
        {
          id: 197,
          name: 'Current_Pending_Sector',
          value: 100,
          worst: 1,
          thresh: 10,
          when_failed: 'In_the_past',
          raw: { string: '2' },
        },
      ],
    },
  };
  assert.equal(visibleDiagnosisStatus(evaluate(r)), 'critical');
});

test('vendor encoded SMART raw does not claim a specific sector count', () => {
  const { ataDefectEvidence } = require('../../electron/diagnostics/health.js');
  assert.deepEqual(ataDefectEvidence({ raw: { string: '19 (1986 14)', value: 8529805967379 } }), {
    kind: 'vendor',
    nonzero: true,
  });
  assert.equal(
    visibleDiagnosisStatus(
      evaluate({
        smart_status: { passed: true },
        ata_smart_attributes: {
          table: [{ id: 197, raw: { string: '19 (1986 14)', value: 8529805967379 } }],
        },
      }),
    ),
    'unassessable',
  );
});
test('standard numeric pending sectors still trigger critical status', () => {
  const { ataDefectEvidence } = require('../../electron/diagnostics/health.js');
  assert.deepEqual(ataDefectEvidence({ raw: { string: '2', value: 2 } }), {
    kind: 'count',
    count: 2,
  });
});

test('readout without SMART remains unknown, never healthy', () => {
  const result = evaluate(
    {
      device: { protocol: 'SCSI' },
      smart_support: { available: false },
      temperature: { current: 0 },
    },
    4,
  );
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert(result.findings.some((f) => f.code === 'noData'));
  assert(!result.findings.some((f) => f.code === 'noIssues'));
});

test('Fujitsu encoded indicators are warnings without fabricated counts', () => {
  const r = {
    smart_status: { passed: true },
    ata_smart_attributes: {
      table: [
        {
          id: 5,
          name: 'Reallocated_Sector_Ct',
          raw: { string: '19 (1986 14)', value: 8529805967379 },
        },
        {
          id: 187,
          name: 'Reported_Uncorrect',
          raw: { string: '281470681948207', value: 281470681948207 },
        },
        { id: 197, name: 'Current_Pending_Sector', raw: { string: '0', value: 0 } },
      ],
    },
  };
  const findings = evaluate(r, 0).findings;
  assert.equal(findings.filter((f) => f.code === 'vendorRaw').length, 2);
  assert(findings.every((f) => f.code !== 'pending'));
  assert(
    findings.find((f) => f.code === 'vendorRaw' && f.values.id === 5).values.name ===
      'Reallocated_Sector_Ct',
  );
});

test('actual Fujitsu failed self-tests and error log dominate overall PASSED', () => {
  const r = evaluate(fixture);
  assert.equal(visibleDiagnosisStatus(r), 'defective');
  assert(r.findings.some((f) => f.code === 'testsFailed' && f.level === 'kritisch'));
  assert(r.findings.some((f) => f.code === 'ataErrors' && f.level === 'warnung'));
});

test('ATA SMART 196 counts events, never implies matching sector count', () => {
  const r = evaluate(
    {
      smart_status: { passed: true },
      rotation_rate: 7200,
      ata_smart_attributes: {
        table: [{ id: 196, name: 'Reallocated_Event_Count', raw: { string: '1', value: 1 } }],
      },
    },
    0,
  );
  assert.equal(visibleDiagnosisStatus(r), 'observe');
  assert(r.findings.some((f) => f.code === 'reallocationEvents' && f.values.count === 1));
  const packed = evaluate(
    {
      smart_status: { passed: true },
      rotation_rate: 7200,
      ata_smart_attributes: {
        table: [{ id: 196, raw: { string: '19 (8 16127)', value: 35416637459 } }],
      },
    },
    0,
  );
  assert(!packed.findings.some((f) => f.code === 'reallocationEvents'));
});

test('vendor-packed pending sectors remain qualitative warnings, not 19 bad sectors', () => {
  const raw = {
    smart_status: { passed: true },
    ata_smart_attributes: {
      table: [
        {
          id: 197,
          name: 'Current_Pending_Sector',
          raw: { string: '19 (1986 14)', value: 8529805967379 },
        },
      ],
    },
  };
  const result = evaluate(raw);
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert(result.findings.some((f) => f.code === 'vendorRaw' && f.values.id === 197));
  assert(!result.findings.some((f) => f.code === 'pending'));
});

test('Windows smartctl access denied is a readout failure, never a drive-health defect', () => {
  const result = evaluate(
    {
      smartctl: {
        exit_status: 2,
        messages: [
          {
            severity: 'error',
            string:
              'Smartctl open device /dev/sdb [SAT] failed: \\\\.\\PhysicalDrive1: Open failed, Error=5',
          },
        ],
      },
    },
    2,
  );
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert.equal(result.readout.status, 'fehlgeschlagen');
  assert.ok(result.readout.issues.some((issue) => issue.code === 'permissionDenied'));
  assert.equal(
    result.findings.some((finding) => finding.level === 'kritisch'),
    false,
  );
});

test('NVMe isolated counter is not a healthy complete assessment', () => {
  const result = evaluate({
    device: { protocol: 'NVMe' },
    nvme_smart_health_information_log: { power_on_hours: 12 },
  });
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert.equal(result.readout.status, 'eingeschraenkt');
  assert(result.readout.issues.some((issue) => issue.code === 'partialRead'));
  assert(!result.findings.some((finding) => finding.code === 'noIssues'));
});

test('NVMe without spare telemetry cannot claim a complete readout', () => {
  const result = evaluate({
    device: { protocol: 'NVMe' },
    nvme_smart_health_information_log: {
      critical_warning: 0,
      media_errors: 0,
      percentage_used: 2,
    },
  });
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert.equal(result.readout.status, 'eingeschraenkt');
});

test('NVMe fault indicators still escalate even when readout is incomplete', () => {
  const result = evaluate({
    device: { protocol: 'NVMe' },
    nvme_smart_health_information_log: { media_errors: 2 },
  });
  assert.equal(visibleDiagnosisStatus(result), 'critical');
  assert.equal(result.readout.status, 'eingeschraenkt');
});

test('SCSI isolated successful error count is not a full health assessment', () => {
  const result = evaluate({
    device: { protocol: 'SCSI' },
    scsi_error_counter_log: { read: { total_uncorrected_errors: 0 } },
  });
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert.equal(result.readout.status, 'eingeschraenkt');
});

test('SCSI without verify counter cannot claim a complete readout', () => {
  const result = evaluate({
    device: { protocol: 'SCSI' },
    scsi_error_counter_log: {
      read: { total_uncorrected_errors: 0 },
      write: { total_uncorrected_errors: 0 },
    },
  });
  assert.equal(visibleDiagnosisStatus(result), 'unassessable');
  assert.equal(result.readout.status, 'eingeschraenkt');
});

test('SCSI fault counters do not lose precision when their sum exceeds a safe integer', () => {
  const raw = {
    device: { protocol: 'SCSI' },
    scsi_error_counter_log: {
      read: { total_uncorrected_errors: Number.MAX_SAFE_INTEGER },
      write: { total_uncorrected_errors: 1 },
      verify: { total_uncorrected_errors: 0 },
    },
  };
  const result = evaluate(raw);
  const entry = result.findings.find((finding) => finding.code === 'scsiUncorrected');
  assert.equal(entry.level, 'kritisch');
  assert.equal(entry.values.count, '9007199254740992');
});
