'use strict';
// Prefer 48-bit ATA logs. Old logs are used only when extended information
// is unavailable, never combined (the same event could appear in both).
function ataErrorLog(report) {
  const log = report?.ata_smart_error_log;
  const extended = log?.extended;
  return extended && (typeof extended.count === 'number' || Array.isArray(extended.table))
    ? extended
    : log?.summary;
}
function ataTestLog(report) {
  const log = report?.ata_smart_self_test_log;
  const extended = log?.extended;
  return extended && Array.isArray(extended.table) ? extended : log?.standard;
}
module.exports = { ataErrorLog, ataTestLog };
