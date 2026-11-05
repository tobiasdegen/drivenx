import { samsung860Metrics } from './ata-ssd-metrics.mjs';
import { formatNvmeDataUnits as sharedFormatNvmeDataUnits } from './diagnostic-metrics.mjs';
// Normalize only universally defined SMART counters for the drive overview.
// USB/PCIe/SATA are transports; diagnostic categories come from SMART protocol.
const safeCounter = (value) => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const number = Number(value.trim());
    return Number.isSafeInteger(number) ? number : null;
  }
  return null;
};
const plainAtaCounter = (attribute) => {
  // Match the conservative 32-bit ATA raw rule used for health and history.
  const text = attribute?.raw?.string;
  if (typeof text !== 'string' || !/^\s*\d+\s*$/.test(text)) return null;
  const n = safeCounter(text);
  if (n === null || n > 0xffffffff) return null;
  const raw = attribute.raw.value;
  return raw === undefined || safeCounter(raw) === n ? n : null;
};
const attribute = (raw, id) => raw?.ata_smart_attributes?.table?.find((row) => row?.id === id);
const nvmeDataUnits = (value) => safeCounter(value);
const formatNvmeDataUnits = (value, locale = 'de-DE') =>
  sharedFormatNvmeDataUnits(value, locale) ?? '–';
function overviewMetrics(raw) {
  const nv = raw?.nvme_smart_health_information_log;
  const sc = raw?.scsi_error_counter_log;
  const proto = String(raw?.device?.protocol || '').toUpperCase();
  const kind =
    nv || proto === 'NVME'
      ? 'nvme'
      : raw?.ata_smart_attributes || proto === 'ATA'
        ? 'ata'
        : sc || proto === 'SCSI'
          ? 'scsi'
          : 'unknown';
  // For NVMe the protocol health log is the canonical source. Top-level
  // aliases are fallbacks only, so conflicting fields are never rendered
  // differently by the history, overview and PDF report.
  const cycles =
    kind === 'nvme'
      ? (safeCounter(nv?.power_cycles) ?? safeCounter(raw?.power_cycle_count))
      : (safeCounter(raw?.power_cycle_count) ??
        (kind === 'ata' ? plainAtaCounter(attribute(raw, 12)) : null));
  const hours =
    kind === 'nvme'
      ? (safeCounter(nv?.power_on_hours) ?? safeCounter(raw?.power_on_time?.hours))
      : safeCounter(raw?.power_on_time?.hours);
  const samsung = kind === 'ata' ? samsung860Metrics(raw) : null;
  const explicitWear =
    kind === 'ata' && raw?.rotation_rate === 0
      ? safeCounter(raw?.endurance_used?.current_percent)
      : null;
  // ATA percentage used is a bounded vendor/SMART percentage; keep a source
  // marker so UI, history and report never mistake a derived estimate for a
  // device-reported value.
  const validWear = explicitWear !== null && explicitWear <= 255 ? explicitWear : null;
  const ataWear = validWear ?? samsung?.usedPercent ?? null;
  const standard = {
    kind,
    powerCycles: cycles,
    powerOnHours: hours,
    // ATA wear is displayed only when smartctl explicitly supplies an
    // endurance_used percentage for a confirmed SSD. Never derive it from
    // normalized vendor attribute 177/233 or from NAND erase cycle counts.
    wearPercent:
      kind === 'nvme' ? safeCounter(nv?.percentage_used) : kind === 'ata' ? ataWear : null,
    ataWrittenBytes: samsung?.writtenBytes ?? null,
    ataWearSource:
      kind !== 'ata' || ataWear === null
        ? null
        : validWear !== null
          ? 'smartctl-endurance'
          : (samsung?.source ?? null),
    readUnits: kind === 'nvme' ? nvmeDataUnits(nv?.data_units_read) : null,
    writtenUnits: kind === 'nvme' ? nvmeDataUnits(nv?.data_units_written) : null,
    readCommands: kind === 'nvme' ? safeCounter(nv?.host_reads) : null,
    writeCommands: kind === 'nvme' ? safeCounter(nv?.host_writes) : null,
    errorCounters: [],
  };
  if (kind === 'nvme') {
    standard.errorCounters = [
      { key: 'mediaErrors', value: safeCounter(nv?.media_errors) },
      { key: 'nvmeLogEntries', value: safeCounter(nv?.num_err_log_entries), informational: true },
      { key: 'unsafeShutdowns', value: safeCounter(nv?.unsafe_shutdowns), informational: true },
      { key: 'spare', value: safeCounter(nv?.available_spare), unit: '%' },
    ];
  } else if (kind === 'ata') {
    standard.errorCounters = [
      {
        key: 'reallocated',
        value: plainAtaCounter(attribute(raw, 5)),
        raw: attribute(raw, 5)?.raw?.string,
      },
      {
        key: 'pending',
        value: plainAtaCounter(attribute(raw, 197)),
        raw: attribute(raw, 197)?.raw?.string,
      },
      {
        key: 'uncorrectable',
        value: plainAtaCounter(attribute(raw, 198)),
        raw: attribute(raw, 198)?.raw?.string,
      },
      {
        key: 'ataLog',
        value: safeCounter(
          raw?.ata_smart_error_log?.extended?.count ?? raw?.ata_smart_error_log?.summary?.count,
        ),
        informational: true,
      },
    ];
  } else if (kind === 'scsi') {
    standard.errorCounters = ['read', 'write', 'verify'].map((op) => ({
      key: `${op}Errors`,
      value: safeCounter(sc?.[op]?.total_uncorrected_errors),
    }));
  }
  return standard;
}
export { overviewMetrics, safeCounter, plainAtaCounter, formatNvmeDataUnits };
