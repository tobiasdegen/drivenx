'use strict';
const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const history = require('../../electron/data/measurement-history.js');
const { evaluate } = require('../../electron/diagnostics/health.js');

const samsung = require('../../fixtures/device-tests/DriveNX_Samsung_SSD_860_EVO_1TB.json');
test('single ATA attribute cannot establish complete healthy diagnosis', () => {
  const r = evaluate({
    smart_status: { passed: true },
    ata_smart_attributes: { table: [{ id: 9, raw: { string: '1' } }] },
  });
  assert.equal(visibleDiagnosisStatus(r), 'unassessable');
  assert.equal(r.readout.status, 'eingeschraenkt');
  assert.ok(!r.findings.some((f) => f.code === 'noIssues'));
});
test('Samsung 860 EVO readout supports model-scoped manufacturer wear and exact TBW', async () => {
  const { samsung860Metrics } = await import('../../shared/ata-ssd-metrics.mjs');
  const r = samsung860Metrics(samsung);
  assert.equal(r.usedPercent, 1);
  assert.ok(BigInt(r.writtenBytes) > 8_000_000_000_000n);
  assert.equal(samsung860Metrics({ ...samsung, model_name: 'Other SSD' }), null);
  const contradictory = structuredClone(samsung);
  contradictory.endurance_used.current_percent = 15;
  assert.equal(samsung860Metrics(contradictory).inconsistent, true);
});
test('plausibility warnings are cautious and only rely on valid longitudinal values', async () => {
  const { plausibilityHints } = await import('../../src/drive-plausibility.mjs');
  const result = plausibilityHints([
    { capturedAt: '2026-01-01', metrics: { powerOnHours: 10, powerCycles: 5 } },
    { capturedAt: '2026-02-01', metrics: { powerOnHours: 1, powerCycles: 5 } },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].code, 'counterDecreased');
  assert.deepEqual(plausibilityHints([{ metrics: { powerOnHours: null, nvmeReadUnits: 0 } }]), []);
});
test('history backup rejects another drive and merges same-drive records', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-import-'));
  const id = 'a'.repeat(64);
  const record = {
    capturedAt: '2026-10-24T10:00:00Z',
    status: 'ok',
    metrics: { powerOnHours: 15 },
  };
  try {
    const backup = history.exportBackup(id, [record]);
    await assert.rejects(history.importBackup(dir, 'b'.repeat(64), backup), /passt nicht/);
    assert.equal((await history.importBackup(dir, id, backup)).length, 1);
    assert.equal((await history.importBackup(dir, id, backup)).length, 1);
    await assert.rejects(
      history.importBackup(dir, id, {
        ...backup,
        records: [{ ...record, metrics: { badKey: 1 } }],
      }),
      /ungültig/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Windows TRIM flag explicitly represents OS configuration, not drive or USB support', async () => {
  const { parseTrimStatus, queryWindowsTrim } = require('../../electron/platform/windows-trim.js');
  assert.deepEqual(
    parseTrimStatus(
      'NTFS DisableDeleteNotify = 0 (Disabled)\r\nReFS DisableDeleteNotify = 1 (Enabled)',
    ),
    { ntfs: 'enabled', refs: 'disabled' },
  );
  assert.deepEqual(parseTrimStatus('unavailable'), { ntfs: null, refs: null });
  assert.deepEqual(await queryWindowsTrim({ platform: 'darwin' }), {
    supported: false,
    ntfs: null,
    refs: null,
  });
  let command;
  const result = await queryWindowsTrim({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    runTextProcess: async (bin, args, options) => {
      command = { bin, args, options };
      return 'NTFS DisableDeleteNotify = 0';
    },
  });
  assert.equal(result.ntfs, 'enabled');
  assert.equal(command.bin, 'C:\\Windows\\System32\\fsutil.exe');
  assert.deepEqual(command.args, ['behavior', 'query', 'DisableDeleteNotify']);
});

test('macOS host I/O attribution requires a unique exact whole-disk IOMedia match', () => {
  const { parseMacHostIo } = require('../../electron/platform/mac-host-io.js');
  const driver = (disk, bytes) =>
    `+-o Storage <class IOBlockStorageDriver, id 0x2>\n  | {\n  |   "Statistics" = {"Bytes (Read)"=${bytes},"Operations (Read)"=13,"Errors (Read)"=0}\n  | }\n  +-o Disk <class IOMedia, id 0x3>\n    | {\n    |   "BSD Name" = "${disk}"\n    | }\n`;
  assert.equal(parseMacHostIo(driver('disk3', 1500), '/dev/disk3').bytesRead, 1500);
  assert.equal(parseMacHostIo(driver('disk3s1', 1500), '/dev/disk3'), null);
  assert.equal(
    parseMacHostIo(driver('disk0', 100) + driver('disk3', 900), '/dev/disk3').bytesRead,
    900,
  );
  assert.equal(parseMacHostIo(driver('disk3', 1500) + driver('disk3', 900), '/dev/disk3'), null);
  assert.equal(parseMacHostIo(driver('disk3', 1500), '/dev/other'), null);
});

test('macOS I/O counters are not attributed to a sibling IOMedia outside the driver subtree', () => {
  const { parseMacHostIo } = require('../../electron/platform/mac-host-io.js');
  const output = `+-o Root <class IOService, id 0x1>
  | +-o Driver A <class IOBlockStorageDriver, id 0x2>
  | | { 
  | |   "Statistics" = {"Bytes (Read)"=888,"Errors (Read)"=3}
  | | }
  | +-o Unrelated media <class IOMedia, id 0x3>
  | | {
  | |   "BSD Name" = "disk5"
  | | }
`;
  assert.equal(parseMacHostIo(output, '/dev/disk5'), null);
});

test('macOS I/O counters are attributed to the exact nested IOMedia under its driver', () => {
  const { parseMacHostIo } = require('../../electron/platform/mac-host-io.js');
  const output = `+-o Root <class IOService, id 0x1>
  | +-o Driver A <class IOBlockStorageDriver, id 0x2>
  | | {
  | |   "Statistics" = {"Bytes (Read)"=77,"Errors (Read)"=0}
  | | }
  | | +-o Disk <class IOMedia, id 0x3>
  | | | {
  | | |   "BSD Name" = "disk5"
  | | | }
`;
  assert.equal(parseMacHostIo(output, '/dev/disk5').bytesRead, 77);
});

test('HTML report export returns escaped customer-facing document without starting PDF Chromium', async () => {
  const { createReportExporter } = require('../../electron/reports/report-export.js');
  const device = { name: '/dev/disk5', type: 'sat' };
  const snapshot = {
    device,
    raw: { model_name: 'Samsung SSD 860 EVO <script>' },
    reportId: 'session-a',
    exitCode: 0,
    health: evaluate({ model_name: 'Samsung SSD 860 EVO <script>' }),
  };
  let data;
  let pdf = false;
  const exportReport = createReportExporter({
    validateRequest: (d, format, locale, id) => ({ device: d, format, locale, reportId: id }),
    assertDevice: (d) => d,
    reports: { get: () => snapshot },
    deviceKey: (d) => d.name,
    showSaveDialog: async () => ({ filePath: '/tmp/safe-report.html' }),
    createPdfWindow: () => {
      pdf = true;
      throw new Error('PDF not needed');
    },
    writeFile: async (file, body, options) => {
      data = { file, body, options };
    },
    renameFile: async () => {},
    generateHTML: () => '<html><body>safe</body></html>',
    getSettings: () => ({}),
  });
  await exportReport(device, 'html', 'de-DE', 'session-a');
  assert.match(data.file, /\.drivenx-.*\.tmp$/);
  assert.equal(data.options.encoding, 'utf8');
  assert.match(data.body, /safe/);
  assert.equal(pdf, false);
});

test('Samsung ATA-specific warranty values appear in report only for a recognized model', () => {
  const { generateHTML } = require('../../electron/reports/report.js');
  const raw = require('../../fixtures/device-tests/DriveNX_Samsung_SSD_860_EVO_1TB.json');
  const html = generateHTML(
    { raw, health: evaluate(raw), device: { name: '/dev/disk5' } },
    'de-DE',
  );
  assert.match(html, /Geschriebene Daten \(Samsung SMART 241\)/);
  assert.match(html, /SSD-Verschleiß \(gemeldet\)/);
  const unrelated = generateHTML(
    {
      raw: { ...raw, model_name: 'UNKNOWN SSD' },
      health: evaluate({ ...raw, model_name: 'UNKNOWN SSD' }),
      device: { name: '/dev/disk5' },
    },
    'de-DE',
  );
  assert.doesNotMatch(unrelated, /Geschriebene Daten \(Samsung SMART 241\)/);
});
