import { formatSectors } from '../shared/diagnostic-metrics.mjs';
// Supplementary, read-only device statistics from smartctl -x.
// These counters are not used for the SMART health assessment: in particular
// transport resets and non-identical endurance sources are not defect proofs.
function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function counter(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const converted = Number(value.trim());
    return Number.isSafeInteger(converted) ? converted : null;
  }
  return null;
}
function statistic(report, pageNumber, offset) {
  const pages = report?.ata_device_statistics?.pages;
  if (!Array.isArray(pages)) return null;
  const page = pages.find((entry) => asRecord(entry) && entry.number === pageNumber);
  if (!Array.isArray(page?.table)) return null;
  const entry = page.table.find((row) => asRecord(row) && row.offset === offset);
  // Invalid/unavailable ATA Device Statistics values are not zeroes.
  return entry?.flags?.valid === true ? counter(entry.value) : null;
}
function phyCounter(report, id) {
  const table = report?.sata_phy_event_counters?.table;
  if (!Array.isArray(table)) return null;
  const entry = table.find((row) => asRecord(row) && row.id === id);
  // An overflowed small PHY counter no longer represents its actual lifetime total.
  return entry && entry.overflow !== true ? counter(entry.value) : null;
}
function extendedMetrics(extended, standard) {
  const extendedData = asRecord(extended);
  const standardData = asRecord(standard);
  if (!extendedData) return null;
  const blockSize = counter(extendedData.logical_block_size);
  const baseBlockSize = counter(standardData?.logical_block_size);
  const sectorBytes =
    blockSize && baseBlockSize && blockSize !== baseBlockSize ? null : (blockSize ?? baseBlockSize);
  const wearExtended = counter(extendedData.endurance_used?.current_percent);
  const wearStandard = counter(standardData?.endurance_used?.current_percent);
  return {
    readSectors: statistic(extendedData, 1, 40),
    writtenSectors: statistic(extendedData, 1, 24),
    sectorBytes,
    uncorrectable: statistic(extendedData, 4, 8),
    commandResets: statistic(extendedData, 4, 16),
    hardwareResets: statistic(extendedData, 6, 8),
    interfaceCrc: statistic(extendedData, 6, 24),
    phyLinkTransitions: phyCounter(extendedData, 9),
    phyComresets: phyCounter(extendedData, 10),
    maxTemperature: statistic(extendedData, 5, 32),
    minTemperature: statistic(extendedData, 5, 40),
    wearExtended,
    wearStandard,
    wearDifferent: wearExtended !== null && wearStandard !== null && wearExtended !== wearStandard,
    extendedErrorCount: counter(extendedData.ata_smart_error_log?.extended?.count),
    extendedSelfTestCount: counter(extendedData.ata_smart_self_test_log?.extended?.count),
    extendedSelfTestErrors: counter(
      extendedData.ata_smart_self_test_log?.extended?.error_count_total,
    ),
  };
}
export { counter, statistic, phyCounter, formatSectors, extendedMetrics };
