/** Conservative, explainable inconsistencies. These are NOT forgery proofs. */
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
/** @typedef {{code: 'zeroHoursWithIo'} | {code: 'counterDecreased', metric: string, at: string} | {code: 'wearDecreased', at: string} | {code: 'spareIncreased', at: string}} PlausibilityHint */
/**
 * Flags inconsistencies; does not establish whether SMART values were manipulated.
 * @param {readonly import('./types').HistoryRecord[] | null | undefined} records
 * @returns {PlausibilityHint[]}
 */
export function plausibilityHints(records) {
  if (!Array.isArray(records) || !records.length) return [];
  const ordered = records
    .filter((r) => r?.metrics)
    .slice()
    .sort((a, b) => String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')));
  if (!ordered.length) return [];
  const newest = ordered.at(-1).metrics;
  const hints = [];
  if (
    count(newest.powerOnHours) === 0 &&
    (count(newest.nvmeWrittenUnits) > 20000000 || count(newest.nvmeReadUnits) > 20000000)
  )
    hints.push({ code: 'zeroHoursWithIo' });
  const monotonic = [
    'powerOnHours',
    'powerCycles',
    'mediaErrors',
    'ataErrorCount',
    'reallocatedSectors',
    'nvmeWrittenUnits',
    'nvmeReadUnits',
    'nvmeErrorLogEntries',
    'unsafeShutdowns',
    'ataCrcErrors',
    'reportedUncorrectable',
    'ssdProgramFailures',
    'scsiReadErrors',
    'scsiWriteErrors',
    'scsiVerifyErrors',
  ];
  for (const metric of monotonic) {
    for (let i = 1; i < ordered.length; i++) {
      const before = count(ordered[i - 1].metrics[metric]);
      const after = count(ordered[i].metrics[metric]);
      if (before !== null && after !== null && after < before) {
        hints.push({ code: 'counterDecreased', metric, at: ordered[i].capturedAt });
        break;
      }
    }
  }
  // Vendor endurance and reserve gauges are not fault probabilities. A
  // reversal deserves an interpretation check, not an automatic "fake SSD".
  for (let i = 1; i < ordered.length; i++) {
    const before = ordered[i - 1].metrics;
    const after = ordered[i].metrics;
    if (
      count(before.wearPercent) !== null &&
      count(after.wearPercent) !== null &&
      after.wearPercent < before.wearPercent &&
      !hints.some((h) => h.code === 'wearDecreased')
    )
      hints.push({ code: 'wearDecreased', at: ordered[i].capturedAt });
    if (
      count(before.availableSparePercent) !== null &&
      count(after.availableSparePercent) !== null &&
      after.availableSparePercent > before.availableSparePercent &&
      !hints.some((h) => h.code === 'spareIncreased')
    )
      hints.push({ code: 'spareIncreased', at: ordered[i].capturedAt });
  }
  return hints;
}
