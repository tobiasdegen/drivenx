import {
  METRICS,
  HISTORY_METRIC_KEYS,
  validHistoryTimestamp,
} from '../shared/diagnostic-metrics.mjs';

/** Preserve metrics from older readings even if the newest snapshot omits them. */
/** @typedef {{key: string, before: number, after: number, difference: number, reset: boolean, unit: string, lastChangedAt: string | null}} HistoryTrend */
/** @param {import('./types').HistoryRecord[]} records @returns {string[]} */
export function historyMetricKeys(records) {
  if (!Array.isArray(records)) return [];
  return HISTORY_METRIC_KEYS.filter((key) =>
    records.some((record) => record?.metrics && Object.hasOwn(record.metrics, key)),
  );
}

/** Chart options require two real measurements; an option with one point
 * would hide the chart and its selector, making the UI impossible to recover.
 */
/** @param {import('./types').HistoryRecord[]} records @returns {string[]} */
export function historyChartKeys(records) {
  if (!Array.isArray(records)) return [];
  return HISTORY_METRIC_KEYS.filter(
    (key) =>
      records.reduce(
        (count, record) =>
          count +
          (isValidCounter(record?.metrics?.[key]) && validHistoryTimestamp(record?.capturedAt)
            ? 1
            : 0),
        0,
      ) >= 2,
  );
}

/** Only plot measurements with a real timestamp and an exact, unsigned counter.
 * Sorting a copy also preserves the ordering used by the history table. */
/**
 * @param {import('./types').HistoryRecord[]} records
 * @param {string | undefined} key
 * @returns {import('./types').HistoryRecord[]}
 */
export function historyChartPoints(records, key) {
  if (!Array.isArray(records) || !Object.hasOwn(METRICS, key)) return [];
  return records
    .filter(
      (record) =>
        validHistoryTimestamp(record?.capturedAt) && isValidCounter(record?.metrics?.[key]),
    )
    .slice()
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

function isValidCounter(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Compare the two latest saved measurements; never infer absent counters. */
/** @param {import('./types').HistoryRecord[]} records @returns {HistoryTrend[]} */
export function buildHistoryTrends(records) {
  if (records.length < 2) return [];

  const previous = records[records.length - 2];
  const current = records[records.length - 1];
  const result = [];

  for (const [key, definition] of Object.entries(METRICS)) {
    const { kind, unit } = definition;
    const before = previous.metrics[key];
    const after = current.metrics[key];
    if (!isValidCounter(before) || !isValidCounter(after)) continue;

    result.push({
      key,
      before,
      after,
      difference: after - before,
      reset: kind === 'counter' && after < before,
      unit: unit === 'count' || unit === '512000B' ? '' : unit,
      lastChangedAt:
        records.findLast(
          (r, i) =>
            i > 0 &&
            isValidCounter(records[i - 1].metrics?.[key]) &&
            isValidCounter(r.metrics?.[key]) &&
            r.metrics[key] !== records[i - 1].metrics[key],
        )?.capturedAt ?? null,
    });
  }
  return result;
}
