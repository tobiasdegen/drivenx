'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluate, testRows } = require('../../electron/diagnostics/health.js');
const { ataErrorLog, ataTestLog } = require('../../electron/diagnostics/ata-logs.js');
const { generateHTML } = require('../../electron/reports/report.js');
const { createSmartAccess } = require('../../electron/devices/smart-access.js');
const fixture = (name, mode) =>
  JSON.parse(
    fs.readFileSync(
      path.join(ELECTRON_SOURCE_DIR, '..', 'fixtures', 'extended-readouts', `${name}-${mode}.json`),
      'utf8',
    ),
  );

test('Fujitsu extended log correctly finds 9081 lifetime errors and failed tests', () => {
  const standard = fixture('fujitsu', 'standard');
  const extended = fixture('fujitsu', 'extended');
  assert.equal(ataErrorLog(standard).count, 9080);
  assert.equal(ataErrorLog(extended).count, 9081);
  assert.equal(ataTestLog(extended).table.length, 2);
  assert.equal(testRows(extended).filter((row) => row.status?.passed === false).length, 2);
  const health = evaluate(extended);
  assert.equal(visibleDiagnosisStatus(health), 'defective');
  assert.ok(health.findings.some((finding) => finding.code === 'testsFailed'));
  assert.ok(
    health.findings.some(
      (finding) => finding.code === 'ataErrors' && finding.values.count === 9081,
    ),
  );
  const html = generateHTML({ raw: extended, health, device: { name: '/dev/sdc' } });
  assert.match(html, /9\.081/);
  assert.match(html, /UNC 7 sectors/);
});

test('Hitachi 4 old error events remain warnings, not evidence of current failed tests', () => {
  const standard = fixture('hitachi', 'standard');
  const extended = fixture('hitachi', 'extended');
  assert.equal(ataErrorLog(standard).count, 4);
  assert.equal(ataErrorLog(extended).count, 4);
  assert.equal(visibleDiagnosisStatus(evaluate(extended)), 'observe');
  assert.ok(!evaluate(extended).findings.some((finding) => finding.code === 'testsFailed'));
  assert.equal(ataTestLog(extended).table[0].status.passed, true);
  assert.equal(extended.ata_smart_error_log.extended.table[0].completion_registers.lba, 625153409);
});

test('extended-only log is preferred and legacy-only report remains supported', () => {
  const old = {
    ata_smart_error_log: { summary: { count: 10 } },
    ata_smart_self_test_log: { standard: { table: [{ status: { passed: false } }] } },
  };
  assert.equal(ataErrorLog(old).count, 10);
  assert.equal(testRows(old).length, 1);
  const both = {
    ...old,
    ata_smart_error_log: { ...old.ata_smart_error_log, extended: { count: 11 } },
    ata_smart_self_test_log: {
      ...old.ata_smart_self_test_log,
      extended: { table: [{ status: { passed: true } }] },
    },
  };
  assert.equal(ataErrorLog(both).count, 11);
  assert.equal(testRows(both).length, 1);
  assert.equal(testRows(both)[0].status.passed, true);
  assert.equal(evaluate(both).findings.filter((f) => f.code === 'ataErrors').length, 1);
});

test('default ATA/SCSI read requests -x and NVMe retains -a', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (device) => device,
    runSmart: async (argv) => {
      calls.push(argv);
      return { json: { smart_status: { passed: true } }, exitCode: 0 };
    },
  });
  for (const type of ['sat', 'scsi', 'nvme']) await gateway.detail({ type, name: '/dev/sdb' });
  assert.deepEqual(
    calls.map((args) => args.slice(0, 4)),
    [
      ['-x', '-j', '-d', 'sat'],
      ['-x', '-j', '-d', 'scsi'],
      ['-a', '-j', '-d', 'nvme'],
    ],
  );
});

test('unusable -x response falls back to authorized -a; live errors never get hidden', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (argv) => {
      calls.push(argv[0]);
      return argv[0] === '-x'
        ? {
            json: { smartctl: { messages: [{ severity: 'error', string: 'unsupported log' }] } },
            exitCode: 4,
          }
        : { json: { smart_status: { passed: false } }, exitCode: 8 };
    },
  });
  const report = await gateway.detail({ type: 'sat', name: '/dev/sdb' });
  assert.deepEqual(calls, ['-x', '-a']);
  assert.equal(report.json.smart_status.passed, false);
  assert.equal(report.exitCode, 8);
});

test('anonymization keeps original SMART attributes, composite raw strings and histories', () => {
  const f = fixture('fujitsu', 'extended'),
    h = fixture('hitachi', 'extended');
  for (const obj of [f, h]) {
    assert.equal(obj.serial_number, 'ANONYMIZED');
    assert.deepEqual(obj.wwn, { redacted: true });
  }
  assert.equal(f.ata_smart_attributes.table.find((a) => a.id === 5).raw.string, '19 (1986 14)');
  assert.equal(
    h.ata_smart_attributes.table.find((a) => a.id === 194).raw.string,
    '19 (Min/Max 7/71)',
  );
});

test('a bare ATA SMART PASS from -x does not suppress the fuller standard attribute read', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (argv) => {
      calls.push(argv[0]);
      return argv[0] === '-x'
        ? { json: { device: { protocol: 'ATA' }, smart_status: { passed: true } }, exitCode: 4 }
        : {
            json: {
              device: { protocol: 'ATA' },
              smart_status: { passed: true },
              ata_smart_attributes: { table: [{ id: 9 }] },
            },
            exitCode: 0,
          };
    },
  });
  const report = await gateway.detail({ type: 'sat', name: '/dev/sdb' });
  assert.deepEqual(calls, ['-x', '-a']);
  assert.equal(report.json.ata_smart_attributes.table[0].id, 9);
});
