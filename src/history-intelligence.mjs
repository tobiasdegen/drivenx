import { METRICS, validHistoryTimestamp } from '../shared/diagnostic-metrics.mjs';

const validNumber = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

// Only counters with verified, cross-measurement semantics are interpreted as
// fault trends. Operating hours, write volume and raw vendor counts are not.
const FAULT_METRICS = Object.freeze({
  mediaErrors: { domain: 'media', actionable: true },
  reallocatedSectors: { domain: 'media', actionable: true },
  pendingSectors: { domain: 'media', actionable: true },
  offlineUncorrectable: { domain: 'media', actionable: true },
  reportedUncorrectable: { domain: 'media', actionable: true },
  ssdProgramFailures: { domain: 'media', actionable: true },
  scsiReadErrors: { domain: 'media', actionable: true },
  scsiWriteErrors: { domain: 'media', actionable: true },
  scsiVerifyErrors: { domain: 'media', actionable: true },
  ataCrcErrors: { domain: 'connection', actionable: true },
  unsafeShutdowns: { domain: 'power', actionable: false },
  nvmeErrorLogEntries: { domain: 'controller', actionable: false },
  ataErrorCount: { domain: 'controller', actionable: false },
});

/**
 * Use all valid observations. Never infer a zero value for an absent metric.
 * On a cumulative-counter drop, start a fresh comparable segment. A change in
 * pending sectors is a gauge change, not proof that sectors are repaired.
 */
/** @typedef {{
 * key: string,
 * domain: 'media' | 'connection' | 'power' | 'controller',
 * trend: 'reset' | 'insufficient' | 'increased' | 'decreased' | 'previousIncrease' | 'unchanged',
 * current: number,
 * baseline: number,
 * delta: number | null,
 * latestDelta: number | null,
 * stableDays: number | null,
 * firstAt: string,
 * lastAt: string,
 * samples: number,
 * resets: number,
 * action: 'inspectConnection' | 'secureDataAndVerify' | 'verifyMedia' | null
 * }} HistoryIntelligence
 */
/** @param {readonly import('./types').HistoryRecord[]} records @returns {HistoryIntelligence[]} */
export function analyzeHistory(records) {
  if (!Array.isArray(records) || records.length < 2) return [];
  const ordered = records
    .filter(
      (r) => validHistoryTimestamp(r?.capturedAt) && r.metrics && typeof r.metrics === 'object',
    )
    .slice()
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const findings = [];
  for (const [key, classification] of Object.entries(FAULT_METRICS)) {
    if (!Object.hasOwn(METRICS, key)) continue;
    const values = ordered.filter((r) => validNumber(r.metrics[key]));
    if (values.length < 2) continue;
    // Exclude duplicate-time captures and keep only the last observation.
    const samples = [];
    for (const row of values) {
      if (samples.at(-1)?.capturedAt === row.capturedAt) samples[samples.length - 1] = row;
      else samples.push(row);
    }
    if (samples.length < 2) continue;
    // A metric omitted by the latest readout is unknown now, not stable.
    if (samples.at(-1).capturedAt !== ordered.at(-1).capturedAt) continue;
    let start = 0;
    let resets = 0;
    let mostRecentIncrease = null;
    for (let i = 1; i < samples.length; i++) {
      const before = samples[i - 1].metrics[key];
      const after = samples[i].metrics[key];
      if (METRICS[key].kind === 'counter' && after < before) {
        resets++;
        start = i;
        mostRecentIncrease = null;
      } else if (after > before) {
        mostRecentIncrease = samples[i].capturedAt;
      }
    }
    const first = samples[start];
    const last = samples.at(-1);
    const baseline = first.metrics[key];
    const current = last.metrics[key];
    const previous = samples.at(-2).metrics[key];
    const comparable = samples.length - start >= 2;
    const reset = !comparable && resets > 0;
    const delta = comparable ? current - baseline : null;
    const latestDelta = comparable ? current - previous : null;
    const stableDays =
      comparable && mostRecentIncrease
        ? Math.max(
            0,
            Math.floor((Date.parse(last.capturedAt) - Date.parse(mostRecentIncrease)) / 86_400_000),
          )
        : comparable && delta === 0
          ? Math.max(
              0,
              Math.floor((Date.parse(last.capturedAt) - Date.parse(first.capturedAt)) / 86_400_000),
            )
          : null;
    const trend = reset
      ? 'reset'
      : !comparable
        ? 'insufficient'
        : latestDelta > 0
          ? 'increased'
          : latestDelta < 0
            ? 'decreased'
            : delta > 0
              ? 'previousIncrease'
              : delta < 0
                ? 'decreased'
                : 'unchanged';
    findings.push({
      key,
      domain: classification.domain,
      trend,
      current,
      baseline: reset ? previous : baseline,
      delta,
      latestDelta,
      stableDays,
      firstAt: reset ? samples.at(-2).capturedAt : first.capturedAt,
      lastAt: last.capturedAt,
      samples: samples.length - start,
      resets,
      // An NVMe error-log entry is not a verified media failure. Nor does
      // a pending-sector decrease prove recovery.
      action:
        trend === 'increased' && classification.actionable
          ? classification.domain === 'connection'
            ? 'inspectConnection'
            : 'secureDataAndVerify'
          : trend === 'decreased' && key === 'pendingSectors'
            ? 'verifyMedia'
            : null,
    });
  }
  return findings;
}
