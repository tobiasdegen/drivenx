/**
 * Select readable error-log records for display. The preference for an extended
 * ATA log matches electron/diagnostics/ata-logs.js: summary records must not be mixed with
 * the extended log's lifetime count when both formats are present.
 */
/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} table
 * @returns {import('./smartctl-types.ts').SmartErrorRow[]}
 */
function readableErrorRows(table) {
  return Array.isArray(table) ? table.filter(isRecord) : [];
}

/**
 * @param {import('./smartctl-types.ts').SmartctlReport} raw
 * @returns {{
 *   log: {count?: number, logged_count?: number, table?: import('./smartctl-types.ts').SmartErrorRow[]} | null,
 *   rows: import('./smartctl-types.ts').SmartErrorRow[]
 * }}
 */
function selectedAtaErrorLog(raw) {
  const logs = raw?.ata_smart_error_log;
  const extended = logs?.extended;
  const log =
    isRecord(extended) && (typeof extended.count === 'number' || Array.isArray(extended.table))
      ? extended
      : isRecord(logs?.summary)
        ? logs.summary
        : null;
  return { log, rows: readableErrorRows(log?.table) };
}

/** A displayed total is known only when the selected log or all SCSI counters are valid. */
/**
 * @param {import('./smartctl-types.ts').SmartctlReport | null | undefined} raw
 * @returns {number | undefined}
 */
function errorLogCount(raw) {
  if (!isRecord(raw)) return undefined;
  if (raw.ata_smart_error_log) {
    const count = selectedAtaErrorLog(raw).log?.count;
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
      ? count
      : undefined;
  }
  const nvmeCount = raw.nvme_smart_health_information_log?.num_err_log_entries;
  if (nvmeCount != null) {
    return typeof nvmeCount === 'number' && Number.isSafeInteger(nvmeCount) && nvmeCount >= 0
      ? nvmeCount
      : undefined;
  }
  const scsi = raw.scsi_error_counter_log;
  if (!isRecord(scsi)) return undefined;
  const counters = ['read', 'write', 'verify'].map((name) => scsi[name]?.total_uncorrected_errors);
  if (
    counters.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
  )
    return undefined;
  const total = counters.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? total : undefined;
}

export { isRecord, readableErrorRows, selectedAtaErrorLog, errorLogCount };
