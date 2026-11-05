'use strict';
const { ataDefectEvidence } = require('./ata-raw.js');

// The availability of SMART data is independent of the drive's PASS flag.
// Never use a fixed attribute-count shortcut as proof of media health.
const isCount = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const rowsOf = (raw) =>
  Array.isArray(raw?.ata_smart_attributes?.table)
    ? raw.ata_smart_attributes.table.filter(
        (row) => row && typeof row === 'object' && Number.isSafeInteger(row.id) && row.id > 0,
      )
    : [];

function protocolOf(raw) {
  const protocol = String(raw?.device?.protocol || '').toUpperCase();
  if (protocol === 'NVME' || raw?.nvme_smart_health_information_log) return 'nvme';
  if (protocol === 'SCSI' || protocol === 'SAS' || raw?.scsi_error_counter_log) return 'scsi';
  if (protocol === 'ATA' || raw?.ata_smart_attributes) return 'ata';
  return 'unknown';
}

function healthCoverage(raw) {
  const protocol = protocolOf(raw);
  const available = [];
  const missing = [];
  const requireFields = (names, predicate) => {
    for (const [name, value] of names) (predicate(value) ? available : missing).push(name);
  };
  if (protocol === 'nvme') {
    const nv = record(raw?.nvme_smart_health_information_log);
    requireFields(
      [
        ['nvme.critical_warning', nv.critical_warning],
        ['nvme.media_errors', nv.media_errors],
        ['nvme.available_spare', nv.available_spare],
        ['nvme.available_spare_threshold', nv.available_spare_threshold],
        ['nvme.percentage_used', nv.percentage_used],
      ],
      isCount,
    );
    const evidence = Object.values(nv).some(isCount);
    return {
      protocol,
      assessment: missing.length === 0 ? 'complete' : evidence ? 'partial' : 'unassessable',
      available,
      missing,
    };
  }
  if (protocol === 'scsi') {
    const sc = record(raw?.scsi_error_counter_log);
    requireFields(
      ['read', 'write', 'verify'].map((name) => [
        `scsi.${name}.total_uncorrected_errors`,
        record(sc[name]).total_uncorrected_errors,
      ]),
      isCount,
    );
    return {
      protocol,
      assessment: missing.length === 0 ? 'complete' : available.length ? 'partial' : 'unassessable',
      available,
      missing,
    };
  }
  if (protocol === 'ata') {
    const rows = rowsOf(raw);
    // A real ATA attribute must have an interpretable normalized value or raw
    // representation; a list of numeric IDs alone is not health telemetry.
    const byId = (id) =>
      rows.find((row) => row.id === id && ataDefectEvidence(row).kind === 'count');
    // These are media-relevant indicators, not endurance-percent mappings.
    // An ID alone is not sufficient to interpret a nonzero vendor raw value.
    const mediumRelevant = [5, 187, 197, 198].filter((id) => byId(id));
    const ssdNamed = rows.filter(
      (row) =>
        [171, 172, 179, 181, 182, 183].includes(row.id) &&
        /^(?:Program_Fail|Erase_Fail|Used_Rsvd_Blk|Runtime_Bad_Block)/.test(
          String(row.name || ''),
        ) &&
        byId(row.id),
    );
    const signals = new Set([
      ...mediumRelevant.map(String),
      ...ssdNamed.map((row) => String(row.id)),
    ]);
    available.push(...[...signals].map((id) => `ata.smart.${id}`));
    if (signals.size < 2) missing.push('ata.independent_media_indicators');
    if (rows.length < 3) missing.push('ata.attribute_coverage');
    return {
      protocol,
      assessment:
        signals.size >= 2 && rows.length >= 3
          ? 'complete'
          : rows.length > 0
            ? 'partial'
            : 'unassessable',
      available,
      missing,
    };
  }
  return { protocol, assessment: 'unassessable', available, missing: ['health.telemetry'] };
}

module.exports = { healthCoverage, protocolOf };
