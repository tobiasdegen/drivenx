/** Read-only ATA diagnostics from smartctl -x. Never infer zero from absent data. */
import { counter } from './extended-metrics.mjs';

function statistics(raw) {
  const pages = raw?.ata_device_statistics?.pages;
  if (!Array.isArray(pages)) return [];
  return pages
    .filter((page) => Array.isArray(page?.table))
    .map((page) => ({
      number: page.number,
      name: String(page.name || `Page ${page.number}`),
      rows: page.table
        .filter((item) => Number.isInteger(item?.offset))
        .map((item) => ({
          offset: item.offset,
          name: String(item.name || `Offset ${item.offset}`),
          valid: item.flags?.valid === true,
          monitored: item.flags?.monitored_condition_met === true,
          normalized: item.flags?.normalized === true,
          value: item.flags?.valid === true ? counter(item.value) : null,
        })),
    }));
}
function phyEvents(raw) {
  const table = raw?.sata_phy_event_counters?.table;
  if (!Array.isArray(table)) return [];
  return table
    .filter((row) => Number.isInteger(row?.id))
    .map((row) => ({
      id: row.id,
      name: String(row.name || `PHY ${row.id}`),
      overflow: row.overflow === true,
      value: row.overflow === true ? null : counter(row.value),
    }));
}
function logDirectory(raw) {
  const table = raw?.ata_log_directory?.table;
  if (!Array.isArray(table)) return [];
  return table
    .filter((row) => Number.isInteger(row?.address) && row.address >= 0)
    .map((row) => ({
      address: row.address,
      name: String(row.name || `Log ${row.address}`),
      read: row.read === true,
      write: row.write === true,
      gpSectors: counter(row.gp_sectors),
      smartSectors: counter(row.smart_sectors),
    }));
}
function temperatureHistory(raw) {
  const src = raw?.ata_sct_temperature_history;
  if (!Array.isArray(src?.table)) return null;
  // The circular buffer's index is device-specific. Keep original slot order,
  // never invent absolute timestamps or interpolate missing measurements.
  const values = src.table.map((n) =>
    typeof n === 'number' && Number.isInteger(n) && n >= -50 && n <= 150 ? n : null,
  );
  return {
    values,
    index: counter(src.index),
    slots: counter(src.size),
    sampleMinutes: counter(src.sampling_period_minutes),
    logMinutes: counter(src.logging_interval_minutes),
    missing: values.filter((n) => n === null).length,
  };
}
function configuredSelectiveSpans(raw) {
  const spans = raw?.ata_smart_selective_self_test_log?.table;
  if (!Array.isArray(spans)) return [];
  return spans.filter((span) => {
    const min = span?.lba_min;
    const max = span?.lba_max;
    const status = span?.status?.string;
    return !(
      min === 0 &&
      max === 0 &&
      (!status || /^(not[_ ]testing|not[_ ]started)$/i.test(status))
    );
  });
}
/** Group SCT ring-buffer samples by temperature; no time ordering is inferred. */
function temperatureBands(history) {
  if (!history?.values) return [];
  const bands = [
    { min: -Infinity, max: 20, label: '<20 °C', count: 0 },
    { min: 20, max: 30, label: '20–29 °C', count: 0 },
    { min: 30, max: 40, label: '30–39 °C', count: 0 },
    { min: 40, max: Infinity, label: '≥40 °C', count: 0 },
  ];
  for (const value of history.values) {
    if (value !== null) {
      const band = bands.find((item) => value >= item.min && value < item.max);
      if (band) band.count++;
    }
  }
  return bands;
}
export {
  statistics,
  phyEvents,
  logDirectory,
  temperatureHistory,
  configuredSelectiveSpans,
  temperatureBands,
};
