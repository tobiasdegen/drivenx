'use strict';
// Stable, presentation-independent order for the UI and exported reports.
// Evidence and severity are decided by health.js; this module never changes them.
const priority = Object.freeze({
  testsFailed: 0,
  testsHistorical: 17,
  testsInterrupted: 61,
  ataErrors: 1,
  scsiUncorrected: 2,
  smartFailed: 3,
  nvCritical: 4,
  nvSpare: 5,
  thresholdFailed: 6,
  exitSmart: 7,
  exitPrefail: 8,
  pending: 9,
  offlineUncorrectable: 10,
  nvMedia: 11,
  nvLogMedia: 12,
  reallocated: 13,
  reallocationEvents: 14,
  uncorrectable: 14,
  ssdProgramFailures: 15,
  ssdEraseFailures: 16,
  ssdReservedBlocksUsed: 18,
  ssdRuntimeBadBlocks: 19,
  ssdReserveLow: 20,
  ssdEnduranceUsed: 21,
  ssdPackedErrorCounter: 22,
  ssdFlashBlockHistory: 62,
  ssdPackedFlashBlocks: 63,
  ataCrcHistory: 60,
  vendorRaw: 90,
  noData: 98,
  noIssues: 99,
});
const levelPriority = { kritisch: 0, warnung: 1, info: 2 };
function sortFindings(findings) {
  if (!Array.isArray(findings)) return [];
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => {
      const severity =
        (levelPriority[a.finding?.level] ?? 3) - (levelPriority[b.finding?.level] ?? 3);
      if (severity !== 0) return severity;
      const rank = (priority[a.finding?.code] ?? 50) - (priority[b.finding?.code] ?? 50);
      return rank || a.index - b.index;
    })
    .map(({ finding }) => finding);
}
module.exports = { sortFindings };
