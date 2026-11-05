/** @typedef {{ readonly kind: 'counter' | 'gauge', readonly unit: string }} MetricDefinition */
/**
 * Stable measurements and units shared by persistence, history and reports.
 * Raw NVMe units are 512,000 bytes each; ATA-written-bytes are actual bytes.
 * Adding a metric requires explicitly declaring its interpretation here.
 */
/** @type {Readonly<Record<string, MetricDefinition>>} */
export const METRICS = Object.freeze({
  powerOnHours: { kind: 'counter', unit: 'h' },
  powerCycles: { kind: 'counter', unit: 'count' },
  wearPercent: { kind: 'gauge', unit: '%' },
  mediaErrors: { kind: 'counter', unit: 'count' },
  availableSparePercent: { kind: 'gauge', unit: '%' },
  pendingSectors: { kind: 'gauge', unit: 'count' },
  reallocatedSectors: { kind: 'counter', unit: 'count' },
  offlineUncorrectable: { kind: 'counter', unit: 'count' },
  ataErrorCount: { kind: 'counter', unit: 'count' },
  ataCrcErrors: { kind: 'counter', unit: 'count' },
  reportedUncorrectable: { kind: 'counter', unit: 'count' },
  ssdProgramFailures: { kind: 'counter', unit: 'count' },
  nvmeReadUnits: { kind: 'counter', unit: '512000B' },
  nvmeWrittenUnits: { kind: 'counter', unit: '512000B' },
  ataWrittenBytes: { kind: 'counter', unit: 'B' },
  nvmeErrorLogEntries: { kind: 'counter', unit: 'count' },
  unsafeShutdowns: { kind: 'counter', unit: 'count' },
  scsiReadErrors: { kind: 'counter', unit: 'count' },
  scsiWriteErrors: { kind: 'counter', unit: 'count' },
  scsiVerifyErrors: { kind: 'counter', unit: 'count' },
});
/** @type {readonly string[]} */
export const HISTORY_METRIC_KEYS = Object.freeze(Object.keys(METRICS));

/** Accept the same real calendar dates in persisted histories and charts.
 * Date.parse alone silently normalizes invalid dates such as February 30.
 */
/** @param {unknown} value @returns {value is string} */
export function validHistoryTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDay = new Date(0);
  calendarDay.setUTCFullYear(year, month - 1, day);
  return (
    calendarDay.getUTCFullYear() === year &&
    calendarDay.getUTCMonth() === month - 1 &&
    calendarDay.getUTCDate() === day
  );
}

const unsigned = (value) => {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
};

/** Exact, decimal SI volume formatting. Never pass unsafe JS integers to BigInt. */
/** @param {bigint | number | string | null | undefined} bytes
 * @param {'de-DE' | 'en-US'} [locale]
 * @param {boolean} [fixedDecimals]
 * @returns {string | null}
 */
export function formatByteVolume(bytes, locale = 'de-DE', fixedDecimals = false) {
  const total = unsigned(bytes);
  if (total === null) return null;
  const divisor = total >= 1_000_000_000_000n ? 1_000_000_000_000n : 1_000_000_000n;
  const rounded = (total * 100n + divisor / 2n) / divisor;
  const decimal = locale === 'en-US' ? '.' : ',';
  const fractional = String(rounded % 100n).padStart(2, '0');
  const digits = fixedDecimals ? fractional : fractional.replace(/0+$/, '');
  if (total > 0n && rounded === 0n) return `${locale === 'en-US' ? '<0.01' : '<0,01'} GB`;
  return `${(rounded / 100n).toLocaleString(locale)}${digits ? decimal + digits : ''} ${divisor === 1_000_000_000_000n ? 'TB' : 'GB'}`;
}

/** @param {unknown} units @returns {bigint | null} */
export function nvmeVolumeBytes(units) {
  const count = unsigned(units);
  // smartctl counters must be representable as exact JavaScript integers.
  return count !== null && count <= BigInt(Number.MAX_SAFE_INTEGER) ? count * 512_000n : null;
}
/** @param {unknown} sectors @param {unknown} sectorBytes @returns {bigint | null} */
export function sectorVolumeBytes(sectors, sectorBytes) {
  const count = unsigned(sectors);
  const size = unsigned(sectorBytes);
  return count !== null &&
    count <= BigInt(Number.MAX_SAFE_INTEGER) &&
    size !== null &&
    size <= BigInt(Number.MAX_SAFE_INTEGER) &&
    size > 0n
    ? count * size
    : null;
}
/** @param {unknown} units
 * @param {'de-DE' | 'en-US'} [locale]
 * @param {boolean} [fixedDecimals]
 * @returns {string | null}
 */
export function formatNvmeDataUnits(units, locale = 'de-DE', fixedDecimals = false) {
  return formatByteVolume(nvmeVolumeBytes(units), locale, fixedDecimals);
}
/** @param {string | number | bigint | null | undefined} bytes
 * @param {'de-DE' | 'en-US'} [locale]
 * @returns {string | null}
 */
export function formatAtaBytes(bytes, locale = 'de-DE') {
  return formatByteVolume(bytes, locale, true);
}
/** @param {unknown} sectors
 * @param {unknown} sectorBytes
 * @param {'de-DE' | 'en-US'} [locale]
 * @returns {string | null}
 */
export function formatSectors(sectors, sectorBytes, locale = 'de-DE') {
  return formatByteVolume(sectorVolumeBytes(sectors, sectorBytes), locale, true);
}

/** @param {string} key @param {unknown} value @returns {bigint | null} */
export function historyVolumeBytes(key, value) {
  if (key === 'nvmeReadUnits' || key === 'nvmeWrittenUnits') return nvmeVolumeBytes(value);
  if (key === 'ataWrittenBytes') return unsigned(value);
  return null;
}
/** @param {string} key
 * @param {unknown} value
 * @param {'de-DE' | 'en-US'} [locale]
 * @returns {string}
 */
export function formatHistoryMetricValue(key, value, locale = 'de-DE') {
  if (key === 'nvmeReadUnits' || key === 'nvmeWrittenUnits')
    return formatNvmeDataUnits(value, locale) ?? '–';
  if (key === 'ataWrittenBytes') return formatAtaBytes(value, locale) ?? '–';
  return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString(locale) : '–';
}

/** A decline in a gauge is a real negative trend. The UI labels decreases
 * of cumulative counters as resets separately, before calling this helper.
 */
/** @param {string} key
 * @param {number} difference
 * @param {'de-DE' | 'en-US'} [locale]
 * @returns {string}
 */
export function formatHistoryMetricDifference(key, difference, locale = 'de-DE') {
  if (!Number.isSafeInteger(difference)) return '–';
  const value = formatHistoryMetricValue(key, Math.abs(difference), locale);
  if (value === '–') return value;
  return `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${value}`;
}
