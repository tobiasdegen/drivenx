'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const history = require('../../electron/data/measurement-history.js');
const { pathToFileURL } = require('node:url');
const load = () =>
  import(
    pathToFileURL(path.join(ELECTRON_SOURCE_DIR, '..', 'src', 'history-intelligence.mjs')).href
  );
const at = (date, metrics) => ({ capturedAt: `${date}T10:00:00Z`, metrics });

test('historical CRC increase is distinguished from later stable readings', async () => {
  const { analyzeHistory } = await load();
  const rows = [
    at('2026-01-01', { ataCrcErrors: 10 }),
    at('2026-01-03', { ataCrcErrors: 14 }),
    at('2026-02-03', { ataCrcErrors: 14 }),
  ];
  const result = analyzeHistory(rows).find((r) => r.key === 'ataCrcErrors');
  assert.equal(result.trend, 'previousIncrease');
  assert.equal(result.delta, 4);
  assert.equal(result.latestDelta, 0);
  assert.equal(result.stableDays, 31);
  assert.equal(result.action, null);
});

test('rising media errors prompt action; ordinary NVMe log entries do not imply media damage', async () => {
  const { analyzeHistory } = await load();
  const result = analyzeHistory([
    at('2026-01-01', { mediaErrors: 0, nvmeErrorLogEntries: 0 }),
    at('2026-01-02', { mediaErrors: 4, nvmeErrorLogEntries: 3 }),
  ]);
  assert.equal(result.find((r) => r.key === 'mediaErrors').action, 'secureDataAndVerify');
  assert.equal(result.find((r) => r.key === 'nvmeErrorLogEntries').action, null);
});

test('counter reset cannot manufacture a long-term trend and is never interpreted as repair', async () => {
  const { analyzeHistory } = await load();
  const result = analyzeHistory([
    at('2026-01-01', { mediaErrors: 100 }),
    at('2026-01-02', { mediaErrors: 1 }),
  ]);
  assert.equal(result[0].trend, 'reset');
  assert.equal(result[0].delta, null);
  assert.equal(result[0].action, null);
});

test('invalid history metrics and dates do not contaminate the trend', async () => {
  const { analyzeHistory } = await load();
  assert.deepEqual(
    analyzeHistory([
      at('2026-01-01', { mediaErrors: null }),
      at('2026-02-01', { mediaErrors: 10 }),
    ]),
    [],
  );
  assert.deepEqual(
    analyzeHistory([
      { capturedAt: '2026-02-30T00:00:00Z', metrics: { mediaErrors: 1 } },
      at('2026-03-01', { mediaErrors: 3 }),
    ]),
    [],
  );
});

test('opt-in history backup supports explicit recovery of a missing live file', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-opt-backup-'));
  const raw = {
    model_name: 'Example SSD',
    serial_number: 'SSDABC123456',
    user_capacity: { bytes: 512000000000 },
    rotation_rate: 0,
    ata_smart_attributes: {
      table: [{ id: 199, name: 'UDMA_CRC_Error_Count', raw: { string: '12', value: 12 } }],
    },
  };
  const report = {
    raw,
    capturedAt: '2026-10-27T12:00:00Z',
    health: { diagnosis: { overallAlert: 'observe', domains: { media: 'ok' } } },
    metrics: {},
  };
  try {
    const id = history.identity(raw);
    assert.ok(id);
    await history.save(folder, report, undefined, true);
    assert.equal(await history.hasLocalBackup(folder, id), true);
    await fs.rm(path.join(folder, 'history', `${id}.json`));
    assert.deepEqual(await history.read(folder, id), []);
    const restored = await history.restoreLocalBackup(folder, id);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].metrics.ataCrcErrors, 12);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('backup remains opt-in and local restoration cannot access another drive', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-opt-off-'));
  const raw = {
    model_name: 'Example SSD',
    serial_number: 'SSDABC123456',
    user_capacity: { bytes: 512000000000 },
    rotation_rate: 0,
  };
  const report = {
    raw,
    capturedAt: '2026-10-27T12:00:00Z',
    health: { diagnosis: { overallAlert: 'ok', domains: { media: 'ok' } } },
    metrics: {},
  };
  try {
    const id = history.identity(raw);
    await history.save(folder, report);
    assert.equal(await history.hasLocalBackup(folder, id), false);
    await assert.rejects(history.restoreLocalBackup(folder, 'b'.repeat(64)), /Keine lokale/);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('restoration IPC is bound to the currently selected report', async () => {
  const { registerHistoryIpc } = require('../../electron/ipc/history-ipc.js');
  const active = { reportId: 'a', raw: { model_name: 'Example SSD' } };
  let current = active;
  const handlers = new Map();
  let callback;
  registerHistoryIpc({
    register: (name, handler) => handlers.set(name, handler),
    currentReport: () => current,
    history: {
      identity: () => 'a'.repeat(64),
      restoreLocalBackup: async (_, id, allowed) => {
        callback = allowed;
        return [{ capturedAt: '2026-10-27T12:00:00Z', status: 'ok', metrics: { mediaErrors: 0 } }];
      },
    },
    getUserDataPath: () => '/tmp',
    ipcValidate: { reportIdToken: (x) => x },
    getSettings: () => ({ locale: 'de-DE' }),
  });
  const result = await handlers.get('diagnostics:restoreLocalHistory')({}, 'a');
  assert.equal(result.records.length, 1);
  assert.equal(callback(), true);
  current = null;
  assert.equal(callback(), false);
  await assert.rejects(
    handlers.get('diagnostics:restoreLocalHistory')({}, 'a'),
    /nicht mehr aktuell/,
  );
});

test('a corrupted optional backup cannot hide an otherwise readable history', async () => {
  const { registerHistoryIpc } = require('../../electron/ipc/history-ipc.js');
  const active = { reportId: 'a', raw: { model_name: 'Example SSD' } };
  const handlers = new Map();
  registerHistoryIpc({
    register: (name, handler) => handlers.set(name, handler),
    currentReport: () => active,
    history: {
      identity: () => 'a'.repeat(64),
      read: async () => [
        { capturedAt: '2026-10-27T12:00:00Z', status: 'ok', metrics: { mediaErrors: 0 } },
      ],
      hasLocalBackup: async () => {
        throw Error('Corrupted backup');
      },
    },
    getUserDataPath: () => '/tmp',
    ipcValidate: { reportIdToken: (x) => x },
    getSettings: () => ({ locale: 'de-DE' }),
  });
  const result = await handlers.get('diagnostics:history')({}, 'a');
  assert.equal(result.records.length, 1);
  assert.equal(result.backupWarning, true);
});

test('inconsistent Samsung endurance sources remain visible rather than silently normalized', async () => {
  const raw = require('../../fixtures/device-tests/DriveNX_Samsung_SSD_860_EVO_1TB.json');
  const { samsung860Metrics } = await import('../../shared/ata-ssd-metrics.mjs');
  const example = structuredClone(raw);
  example.endurance_used.current_percent = 15;
  const result = samsung860Metrics(example);
  assert.equal(result.inconsistent, true);
  assert.equal(result.normalizedUsedPercent, 1);
  assert.equal(result.reportedUsedPercent, 15);
  const view = await fs.readFile(
    path.join(ELECTRON_SOURCE_DIR, '..', 'src', 'components', 'DriveOverview.tsx'),
    'utf8',
  );
  assert.match(view, /overviewWearConflict/);
});

test('wear and spare reversal are plausible warnings, not proofs of counter tampering', async () => {
  const { plausibilityHints } = await import('../../src/drive-plausibility.mjs');
  const result = plausibilityHints([
    at('2026-01-01', { wearPercent: 20, availableSparePercent: 90 }),
    at('2026-02-01', { wearPercent: 8, availableSparePercent: 95 }),
  ]);
  assert.ok(result.some((r) => r.code === 'wearDecreased'));
  assert.ok(result.some((r) => r.code === 'spareIncreased'));
});

test('missing latest metric does not masquerade as stable current telemetry', async () => {
  const { analyzeHistory } = await load();
  const result = analyzeHistory([
    at('2026-01-01', { ataCrcErrors: 2 }),
    at('2026-02-01', { ataCrcErrors: 2 }),
    at('2026-03-01', { mediaErrors: 0 }),
  ]);
  assert.equal(
    result.find((r) => r.key === 'ataCrcErrors'),
    undefined,
  );
});
