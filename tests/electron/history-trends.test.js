'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const modulePromise = import(
  pathToFileURL(path.join(ELECTRON_SOURCE_DIR, '..', 'src/history-trends.mjs')).href
);

function record(metrics) {
  return { capturedAt: new Date().toISOString(), status: 'ok', metrics };
}

test('history trends compare only the last two measurements', async () => {
  const { buildHistoryTrends } = await modulePromise;
  const trend = buildHistoryTrends([
    record({ powerCycles: 1 }),
    record({ powerCycles: 10 }),
    record({ powerCycles: 13 }),
  ]);
  assert.equal(trend.length, 1);
  assert.deepEqual(
    { ...trend[0], lastChangedAt: null },
    {
      key: 'powerCycles',
      before: 10,
      after: 13,
      difference: 3,
      reset: false,
      unit: '',
      lastChangedAt: null,
    },
  );
  assert.ok(trend[0].lastChangedAt);
});

test('history trends omit missing, fractional, negative and unsafe counters', async () => {
  const { buildHistoryTrends } = await modulePromise;
  const trend = buildHistoryTrends([
    record({ powerCycles: null, powerOnHours: 5, mediaErrors: 2, reallocatedSectors: 4 }),
    record({
      powerCycles: 12,
      powerOnHours: 5.1,
      mediaErrors: -1,
      reallocatedSectors: Number.MAX_SAFE_INTEGER + 1,
    }),
  ]);
  assert.deepEqual(trend, []);
  assert.deepEqual(buildHistoryTrends([record({ powerCycles: 1 })]), []);
});

test('counter reset and gauge reductions are distinguished', async () => {
  const { buildHistoryTrends } = await modulePromise;
  const trend = buildHistoryTrends([
    record({ powerCycles: 60, availableSparePercent: 100, nvmeWrittenUnits: 900 }),
    record({ powerCycles: 2, availableSparePercent: 95, nvmeWrittenUnits: 950 }),
  ]);
  assert.equal(trend.find((row) => row.key === 'powerCycles')?.reset, true);
  assert.equal(trend.find((row) => row.key === 'availableSparePercent')?.reset, false);
  assert.equal(trend.find((row) => row.key === 'nvmeWrittenUnits')?.difference, 50);
});

test('historical metrics are not hidden when the latest reading omits them', async () => {
  const { historyMetricKeys } = await modulePromise;
  const columns = historyMetricKeys([
    record({ powerCycles: 10, ataErrorCount: 3 }),
    record({ powerCycles: 11, mediaErrors: 0 }),
  ]);
  assert.deepEqual(columns, ['powerCycles', 'mediaErrors', 'ataErrorCount']);
  assert.deepEqual(historyMetricKeys([record({ unexpectedVendorRaw: 42 })]), []);
  assert.deepEqual(historyMetricKeys([]), []);
});

test('history chart ignores invalid timestamps and unsafe values, then sorts valid samples', async () => {
  const { historyChartPoints, historyChartKeys } = await modulePromise;
  const records = [
    { capturedAt: '2026-10-03T11:00:00.000Z', metrics: { powerCycles: 3 } },
    { capturedAt: 'invalid', metrics: { powerCycles: 4 } },
    { capturedAt: '2026-02-30T10:00:00Z', metrics: { powerCycles: 99 } },
    { capturedAt: '2026-10-01T11:00:00.000Z', metrics: { powerCycles: 1 } },
    { capturedAt: '2026-10-02T11:00:00.000Z', metrics: { powerCycles: -2 } },
    { capturedAt: '2026-10-04T11:00:00.000Z', metrics: { powerCycles: 3.5 } },
  ];
  assert.deepEqual(
    historyChartPoints(records, 'powerCycles').map((r) => r.metrics.powerCycles),
    [1, 3],
  );
  assert.deepEqual(historyChartKeys(records), ['powerCycles']);
  assert.deepEqual(historyChartPoints(records, 'unknownMetric'), []);
  // The original history table remains untouched by chart sorting.
  assert.equal(records[0].metrics.powerCycles, 3);
  assert.equal(records[1].capturedAt, 'invalid');
  assert.equal(records[2].metrics.powerCycles, 99);
});

test('history chart must not offer an option based only on invalid dates', async () => {
  const { historyChartKeys, historyChartPoints } = await modulePromise;
  const records = [
    { capturedAt: 'bad-date', metrics: { mediaErrors: 1 } },
    { capturedAt: 'also-invalid', metrics: { mediaErrors: 2 } },
    { capturedAt: '2026-10-04T11:00:00.000Z', metrics: { mediaErrors: 3 } },
  ];
  assert.deepEqual(historyChartKeys(records), []);
  assert.deepEqual(historyChartPoints(records, undefined), []);
});

test('backend and chart reject impossible calendar dates consistently', async () => {
  const { historyChartKeys, historyChartPoints } = await modulePromise;
  const records = [
    { capturedAt: '2026-02-28T10:00:00+01:00', metrics: { powerCycles: 1 } },
    { capturedAt: '2026-02-30T10:00:00Z', metrics: { powerCycles: 2 } },
  ];
  assert.deepEqual(
    historyChartPoints(records, 'powerCycles').map((r) => r.metrics.powerCycles),
    [1],
  );
  assert.deepEqual(historyChartKeys(records), []);
});
