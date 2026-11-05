'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createReportExporter,
  suggestedFilename,
} = require('../../electron/reports/report-export.js');
const { evaluate } = require('../../electron/diagnostics/health.js');
const device = { name: '/dev/sda', type: 'sat' };
const report = {
  device,
  raw: { model_name: 'ABC', serial_number: 'XYZ' },
  reportId: 'r1',
  health: evaluate({ model_name: 'ABC', smart_status: { passed: true } }),
  exitCode: 0,
  capturedAt: '2026-10-19T12:12:00Z',
};

function make(overrides = {}) {
  let current = report;
  const written = [];
  const renamed = [];
  const removed = [];
  let destroyed = 0;
  const pdfWindow = {
    loadURL: async () => {},
    webContents: { printToPDF: async () => Buffer.from('test-pdf') },
    isDestroyed: () => false,
    destroy: () => {
      destroyed++;
    },
  };
  const args = {
    validateRequest: (d, format, locale, reportId) => ({ device: d, format, locale, reportId }),
    assertDevice: (d) => d,
    reports: { get: () => current },
    deviceKey: (d) => d.name,
    showSaveDialog: async () => ({ filePath: '/tmp/result.json' }),
    createPdfWindow: () => pdfWindow,
    writeFile: async (...args) => written.push(args),
    renameFile: async (...args) => renamed.push(args),
    removeFile: async (...args) => removed.push(args),
    generateHTML: () => '<html></html>',
    getSettings: () => ({}),
    ...overrides,
  };
  return {
    exportReport: createReportExporter(args),
    written,
    renamed,
    removed,
    setReport: (next) => {
      current = next;
    },
    getDestroyed: () => destroyed,
  };
}

test('export validates current reportId and handles missing or stale reports', async () => {
  const harness = make();
  await assert.rejects(harness.exportReport(device, 'json', 'de-DE', 'old'), /nicht mehr aktuell/);
  harness.setReport(null);
  await assert.rejects(harness.exportReport(device, 'json', 'de-DE', 'r1'), /Keine aktuelle/);
});

test('export rejects a refresh while the save dialog is open', async () => {
  let release;
  const dialog = new Promise((resolve) => {
    release = resolve;
  });
  const harness = make({ showSaveDialog: () => dialog });
  const running = harness.exportReport(device, 'json', 'de-DE', 'r1');
  harness.setReport({ ...report, reportId: 'r2' });
  release({ filePath: '/tmp/result.json' });
  await assert.rejects(running, /während des Exports geändert/);
  assert.equal(harness.written.length, 0);
});

test('JSON export writes the original smartctl report, PDF closes its window', async () => {
  const harness = make();
  const json = await harness.exportReport(device, 'json', 'de-DE', 'r1');
  assert.equal(json.path, '/tmp/result.json');
  assert.equal(JSON.parse(harness.written[0][1]).serial_number, 'XYZ');
  assert.equal(harness.renamed[0][1], '/tmp/result.json');
  await harness.exportReport(device, 'pdf', 'en-US', 'r1');
  assert.equal(harness.getDestroyed(), 1);
  assert.deepEqual(harness.written[1][1], Buffer.from('test-pdf'));
});

test('report filenames are sanitized without path separators or control characters', () => {
  const file = suggestedFilename(
    { ...report, raw: { model_name: '../../Test*', serial_number: 'one/two' } },
    'pdf',
  );
  assert.ok(file.startsWith('DriveNX_'));
  assert.ok(file.endsWith('.pdf'));
  assert.ok(!file.includes('/'));
});

test('PDF export rejects a snapshot revoked during asynchronous PDF rendering', async () => {
  let release;
  const rendering = new Promise((resolve) => {
    release = resolve;
  });
  const pdfWindow = {
    loadURL: async () => {},
    webContents: { printToPDF: () => rendering },
    isDestroyed: () => false,
    destroy: () => {},
  };
  const harness = make({ createPdfWindow: () => pdfWindow });
  const job = harness.exportReport(device, 'pdf', 'de-DE', 'r1');
  await new Promise((resolve) => setImmediate(resolve));
  harness.setReport(null);
  release(Buffer.from('old-pdf'));
  await assert.rejects(job, /während des Exports geändert/);
  assert.equal(harness.written.length, 0);
});

test('HTML and PDF exports use exactly the evaluated snapshot without reclassification', async () => {
  const captured = [];
  const harness = make({
    generateHTML: (snapshot) => {
      captured.push(snapshot);
      return '<html></html>';
    },
  });
  await harness.exportReport(device, 'html', 'de-DE', 'r1');
  await harness.exportReport(device, 'pdf', 'de-DE', 'r1');
  assert.equal(captured.length, 2);
  assert.strictEqual(captured[0], report);
  assert.strictEqual(captured[1], report);
  assert.strictEqual(captured[0].health, report.health);
});

test('missing diagnosis assessment aborts export before opening the Save dialog', async () => {
  let opened = 0;
  const harness = make({
    showSaveDialog: async () => {
      opened++;
      return { filePath: '/tmp/out.pdf' };
    },
  });
  harness.setReport({ ...report, health: undefined });
  await assert.rejects(harness.exportReport(device, 'pdf', 'de-DE', 'r1'), (error) => {
    assert.equal(error.userMessageKey, 'invalidDiagnosisSnapshot');
    return true;
  });
  assert.equal(opened, 0);
});

test('every report format rejects a rescan while the export is being staged', async () => {
  for (const format of ['json', 'html', 'pdf']) {
    let harness;
    harness = make({
      writeFile: async () => {
        // Writing the temporary output can take time. This simulates a rescan
        // while the filesystem operation is pending, before final commit.
        harness.setReport(null);
      },
    });
    await assert.rejects(
      harness.exportReport(device, format, 'de-DE', 'r1'),
      (error) => error.userMessageKey === 'reportChangedDuringExport',
      `format: ${format}`,
    );
    assert.equal(harness.renamed.length, 0, `${format}: stale output must not commit`);
    assert.equal(harness.removed.length, 1, `${format}: staging must be cleaned`);
    if (format === 'pdf') assert.equal(harness.getDestroyed(), 1);
  }
});

test('an export revoked while the final filesystem rename finishes never reports success', async () => {
  let harness;
  harness = make({
    renameFile: async () => {
      harness.setReport(null);
    },
  });
  await assert.rejects(
    harness.exportReport(device, 'json', 'de-DE', 'r1'),
    (error) => error.userMessageKey === 'reportChangedDuringExport',
  );
});

test('report exports require a structured diagnosis', async () => {
  const { exportReport } = make({
    reports: { get: () => ({ ...report, health: { status: 'ok', findings: [] } }) },
  });
  await assert.rejects(
    () => exportReport(device, 'json', 'de-DE', 'r1'),
    (err) => err.code === 'invalidDiagnosisSnapshot' || /Diagnose-Snapshot/.test(err.message),
  );
});
