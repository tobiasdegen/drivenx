'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  METRICS,
  HISTORY_METRIC_KEYS,
  formatByteVolume,
  formatSectors,
  formatNvmeDataUnits,
  formatAtaBytes,
  historyVolumeBytes,
  formatHistoryMetricValue,
  formatHistoryMetricDifference,
} = require('../../shared/diagnostic-metrics.mjs');
const { samsung860Metrics } = require('../../shared/ata-ssd-metrics.mjs');
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
const { evaluate } = require('../../electron/diagnostics/health.js');
const de = require('../../locales/de-DE.json');
const en = require('../../locales/en-US.json');
const samsung = require('../../fixtures/device-tests/DriveNX_Samsung_SSD_860_EVO_1TB.json');
const nvme = require('../../fixtures/device-tests/drive-apple-ssd-ap0512z.json');

const report = (raw, lang = 'de-DE') =>
  generateHTML(
    {
      raw,
      health: evaluate(raw),
      device: { name: '/dev/disk2' },
      capturedAt: '2026-10-24T13:00:00.000Z',
    },
    lang,
  );

test('history store, trends and chart use a single key and unit registry', async () => {
  const { historyMetricKeys, historyChartKeys, buildHistoryTrends } =
    await import('../../src/history-trends.mjs');
  assert.deepEqual(history.METRICS, METRICS);
  assert.deepEqual(HISTORY_METRIC_KEYS, Object.keys(METRICS));
  assert.ok(Object.isFrozen(METRICS));
  const before = {
    capturedAt: '2026-10-24T13:00:00Z',
    metrics: { ataWrittenBytes: 8000000000000 },
  };
  const after = { capturedAt: '2026-10-24T14:00:00Z', metrics: { ataWrittenBytes: 8100000000000 } };
  assert.ok(historyMetricKeys([before, after]).includes('ataWrittenBytes'));
  assert.ok(historyChartKeys([before, after]).includes('ataWrittenBytes'));
  const change = buildHistoryTrends([before, after]).find((r) => r.key === 'ataWrittenBytes');
  assert.equal(change?.difference, 100000000000);
  assert.equal(change?.unit, 'B');
  assert.equal(historyVolumeBytes('ataWrittenBytes', 8100000000000), 8100000000000n);
});

test('every supported history metric has a usable DE and EN label', () => {
  for (const key of HISTORY_METRIC_KEYS) {
    for (const [lang, catalog] of [
      ['de-DE', de],
      ['en-US', en],
    ]) {
      assert.ok(
        typeof catalog.historyMetrics[key] === 'string' && catalog.historyMetrics[key].trim(),
        `${lang}.historyMetrics.${key}`,
      );
    }
  }
  assert.deepEqual(Object.keys(de.historyMetrics).sort(), Object.keys(en.historyMetrics).sort());
  assert.deepEqual(Object.keys(en.historyMetrics).sort(), [...HISTORY_METRIC_KEYS].sort());
});

test('decimal drive volumes are exact and consistent for NVMe, sectors and ATA bytes', () => {
  assert.equal(formatNvmeDataUnits(1953125, 'de-DE'), '1 TB');
  assert.equal(formatNvmeDataUnits(1953125, 'en-US', true), '1.00 TB');
  assert.equal(formatSectors(1953125000, 512, 'de-DE'), '1,00 TB');
  assert.equal(formatAtaBytes('1000000000000', 'de-DE'), '1,00 TB');
  assert.equal(formatHistoryMetricValue('nvmeReadUnits', 1953125, 'en-US'), '1 TB');
  assert.equal(formatHistoryMetricValue('ataWrittenBytes', 1000000000000, 'en-US'), '1.00 TB');
  assert.equal(formatByteVolume(0n, 'de-DE'), '0 GB');
  assert.equal(formatByteVolume(0n, 'de-DE', true), '0,00 GB');
  assert.equal(formatByteVolume(512n, 'de-DE', true), '<0,01 GB');
  assert.equal(formatByteVolume(512n, 'en-US'), '<0.01 GB');
});

test('unknown or imprecise storage counters never become invented quantities', () => {
  for (const value of [
    null,
    undefined,
    -1,
    1.2,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '9 (vendor)',
  ]) {
    assert.equal(formatNvmeDataUnits(value), null);
    assert.equal(historyVolumeBytes('nvmeWrittenUnits', value), null);
  }
  assert.equal(formatSectors(5, null), null);
  assert.equal(formatByteVolume('18446744073709551616', 'en-US'), '18,446,744.07 TB');
  assert.equal(formatHistoryMetricValue('nvmeWrittenUnits', null, 'en-US'), '–');
});

test('Samsung ATA lifetime interpretation agrees across overview, history and report', async () => {
  const { overviewMetrics } = await import('../../shared/overview-metrics.mjs');
  const source = samsung860Metrics(samsung);
  const overview = overviewMetrics(samsung);
  const entry = history.snapshot({
    raw: samsung,
    capturedAt: '2026-10-24T13:00:00Z',
    health: evaluate(samsung),
  });
  assert.ok(entry && source && source.writtenBytes);
  assert.equal(overview.wearPercent, source.usedPercent);
  assert.equal(overview.ataWrittenBytes, source.writtenBytes);
  assert.equal(entry.metrics.wearPercent, source.usedPercent);
  assert.equal(entry.metrics.ataWrittenBytes, Number(source.writtenBytes));
  const volume = formatAtaBytes(source.writtenBytes, 'de-DE');
  assert.ok(report(samsung).includes(volume));
  assert.ok(report(samsung).includes(`${source.usedPercent} %`));
  // No vendor interpretation or proprietary write amount for an unknown SSD.
  assert.equal(samsung860Metrics({ ...samsung, model_name: 'Some Unknown SSD' }), null);
});

test('NVMe report and history use standard 512000-byte units', async () => {
  const { overviewMetrics } = await import('../../shared/overview-metrics.mjs');
  const overview = overviewMetrics(nvme);
  const amount = formatNvmeDataUnits(overview.writtenUnits, 'de-DE', true);
  if (overview.writtenUnits === null) return;
  assert.equal(
    historyVolumeBytes('nvmeWrittenUnits', overview.writtenUnits),
    BigInt(overview.writtenUnits) * 512000n,
  );
  assert.ok(report(nvme).includes(amount));
});

test('chart selector only lists metrics with at least two valid measurements', async () => {
  const { historyChartKeys } = await import('../../src/history-trends.mjs');
  const rows = [
    {
      capturedAt: '2026-10-01T12:00:00Z',
      metrics: { powerCycles: 4, ataWrittenBytes: 8000000000000, wearPercent: 2 },
    },
    {
      capturedAt: '2026-10-02T12:00:00Z',
      metrics: { powerCycles: 5, ataWrittenBytes: null, wearPercent: -1 },
    },
    {
      capturedAt: '2026-10-03T12:00:00Z',
      metrics: { powerCycles: null, ataWrittenBytes: 8200000000000, wearPercent: null },
    },
  ];
  assert.deepEqual(historyChartKeys(rows), ['powerCycles', 'ataWrittenBytes']);
  assert.deepEqual(historyChartKeys([rows[0]]), []);
  assert.deepEqual(historyChartKeys(null), []);
});

test('reports distinguish directly reported from vendor-derived Samsung wear', () => {
  const derived = structuredClone(samsung);
  delete derived.endurance_used;
  const deReport = report(derived, 'de-DE');
  const enReport = report(derived, 'en-US');
  assert.match(deReport, /SSD-Verschleiß \(aus SMART 177 abgeleitet\)/);
  assert.match(enReport, /SSD wear \(derived from SMART 177\)/);
  assert.match(report(samsung, 'de-DE'), /SSD-Verschleiß \(gemeldet\)/);
});

test('signed gauge changes retain meaningful declines without fake volume values', () => {
  assert.equal(formatHistoryMetricDifference('availableSparePercent', -5, 'de-DE'), '−5');
  assert.equal(formatHistoryMetricDifference('wearPercent', 2, 'en-US'), '+2');
  assert.equal(formatHistoryMetricDifference('nvmeWrittenUnits', 1000, 'de-DE'), '+0,51 GB');
  assert.equal(
    formatHistoryMetricDifference('powerCycles', Number.MAX_SAFE_INTEGER + 2, 'de-DE'),
    '–',
  );
});
