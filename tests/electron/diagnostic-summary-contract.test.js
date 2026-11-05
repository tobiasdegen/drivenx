'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDetailCache } = require('../../electron/diagnostics/detail-cache.js');
const { evaluate } = require('../../electron/diagnostics/health.js');
const { createDiagnosticService } = require('../../electron/diagnostics/diagnostic-service.js');
const { generateHTML: productionHTML } = require('../../electron/reports/report.js');
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

const history = require('../../electron/data/measurement-history.js');
const { overviewMetrics } = require('../../shared/overview-metrics.mjs');
const { getCatalogSection } = require('../../electron/ui/translator.js');

const sampleNVMe = () => ({
  serial_number: 'TEST-NVME-01',
  model_name: 'APPLE SSD TEST',
  user_capacity: { bytes: 500000000000 },
  device: { protocol: 'NVMe' },
  power_on_time: { hours: 10 },
  power_cycle_count: 3,
  nvme_smart_health_information_log: {
    power_on_hours: 500,
    power_cycles: 40,
    percentage_used: 2,
    data_units_read: 1953125,
    data_units_written: 1953125,
    media_errors: 0,
    num_err_log_entries: 0,
  },
});

test('main process emits one normalized overview together with raw SMART and health', async () => {
  const raw = sampleNVMe();
  const saved = [];
  const service = createDiagnosticService({
    validateDevice: (d) => d,
    assertDevice: (d) => d,
    deviceKey: (d) => d.name,
    reports: createDetailCache(),
    operations: { run: (_name, callback) => callback() },
    smartAccess: { detail: async () => ({ json: raw, exitCode: 0 }) },
    evaluate: () => evaluate(raw),
    history: {
      identity: () => 'test',
      save: async (_path, detail) => {
        saved.push(detail);
      },
    },
    getSettings: () => ({ autoSaveHistory: true }),
    getUserDataPath: () => '/unused',
    scanGeneration: () => 1,
    isScanning: () => false,
    createId: () => 'test-report-id',
    logSaveError: (e) => {
      throw e;
    },
  });
  const detail = await service.detail({ name: '/dev/disk0', type: 'nvme' });
  assert.deepEqual(detail.metrics, overviewMetrics(raw));
  assert.equal(
    detail.metrics.powerOnHours,
    500,
    'NVMe health log wins over conflicting general field',
  );
  assert.equal(detail.metrics.powerCycles, 40);
  assert.equal(saved.length, 1);
  assert.equal(saved[0], detail, 'auto history receives the same immutable snapshot reference');
  const entry = history.snapshot(detail);
  assert.equal(entry.metrics.powerOnHours, detail.metrics.powerOnHours);
  assert.equal(entry.metrics.powerCycles, detail.metrics.powerCycles);
  assert.equal(entry.metrics.wearPercent, detail.metrics.wearPercent);
  assert.match(generateHTML(detail, 'de-DE'), /500 h/);
  assert.doesNotMatch(generateHTML(detail, 'de-DE'), /Betriebsstunden<\/th><td>10 h/);
});

test('reports without normalized metrics use the same shared evaluator', () => {
  const raw = sampleNVMe();
  const entry = history.snapshot({
    raw,
    health: evaluate(raw),
    capturedAt: '2026-10-24T10:00:00Z',
  });
  assert.equal(entry.metrics.powerOnHours, overviewMetrics(raw).powerOnHours);
  assert.match(
    generateHTML({ raw, health: evaluate(raw), device: { name: '/dev/disk0' } }, 'en-US'),
    /500 h/,
  );
});

test('invalid NVMe counters and conflicting ATA vendor raw values never become invented values', () => {
  const nvme = sampleNVMe();
  nvme.nvme_smart_health_information_log.power_on_hours = '9007199254740993';
  nvme.power_on_time.hours = null;
  const summary = overviewMetrics(nvme);
  assert.equal(summary.powerOnHours, null);
  const raw = {
    device: { protocol: 'ATA' },
    ata_smart_attributes: { table: [{ id: 12, raw: { string: '25', value: 26 } }] },
  };
  assert.equal(overviewMetrics(raw).powerCycles, null);
  assert.equal(
    history.snapshot({ raw, capturedAt: '2026-10-24T10:00:00Z' }),
    null,
    'history rejects anonymous devices',
  );
});

test('ATA endurance source distinguishes reported from derived values', () => {
  const samsung = require('../../fixtures/device-tests/DriveNX_Samsung_SSD_860_EVO_1TB.json');
  assert.equal(overviewMetrics(samsung).ataWearSource, 'smartctl-endurance');
  const derived = structuredClone(samsung);
  delete derived.endurance_used;
  assert.equal(overviewMetrics(derived).ataWearSource, 'samsung-860-normalized-177');
  assert.equal(
    history.snapshot({
      raw: samsung,
      health: evaluate(samsung),
      capturedAt: '2026-10-24T10:00:00Z',
    }).metrics.wearPercent,
    overviewMetrics(samsung).wearPercent,
  );
});

test('native dialogs and readout labels have centralized German/English copy', () => {
  for (const language of ['de-DE', 'en-US']) {
    const dialogs = getCatalogSection(language, 'dialogs');
    const smartView = getCatalogSection(language, 'smartView');
    for (const field of ['chooseCompanyLogo'])
      assert.ok(typeof dialogs[field] === 'string' && dialogs[field].length > 5);
    assert.ok(smartView.smartctlExitCode.includes('smartctl'));
  }
});
