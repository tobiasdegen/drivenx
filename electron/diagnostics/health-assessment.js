'use strict';
const { ataDefectEvidence } = require('./ata-raw.js');
const { ataErrorLog } = require('./ata-logs.js');

// One authoritative assessment. Evidence is separated by failure domain.
const LEVELS = Object.freeze(['ok', 'observe', 'warning', 'critical', 'defective']);
const SCORES = Object.freeze(Object.fromEntries(LEVELS.map((level, index) => [level, index])));
const VALID_DOMAINS = Object.freeze(['media', 'connection', 'thermal']);
const HISTORICAL = new Set([
  'ataErrors',
  'testsHistorical',
  'reallocationEvents',
  'exitLog',
  'exitAttributes',
]);
const CONFIRMED_FAILURE = new Set([
  'smartFailed',
  'exitSmart',
  'exitPrefail',
  'thresholdFailed',
  'testsFailed',
]);
const SEVERE_MEDIA = new Set(['pending', 'offlineUncorrectable', 'scsiUncorrected', 'nvMedia']);
const SKIP = new Set([
  'noData',
  'noIssues',
  'nvCritical',
  'nvSpare',
  'ataCrcHistory',
  'nvmeCommandErrors',
  'nvmeOtherErrors',
  'nvmeLogPartial',
  'vendorRaw',
  'exitAttributes',
  'ssdFlashBlockHistory',
  'ssdPackedFlashBlocks',
  'testsInterrupted',
  'reallocated',
  'uncorrectable',
  'pending',
  'offlineUncorrectable',
  'reallocationEvents',
  'ssdProgramFailures',
  'ssdEraseFailures',
  'ssdReservedBlocksUsed',
  'ssdRuntimeBadBlocks',
  'ssdPackedErrorCounter',
  'ssdReserveLow',
  'ssdEnduranceUsed',
  'nvWear',
]);
const number = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

function assessHealth(raw, exitCode, coverage, findings) {
  const evidence = [];
  const domains = { media: null, connection: null, thermal: null };
  const push = (ruleId, domain, severity, source, actualValue, mappingConfidence = 'generic') => {
    evidence.push({
      ruleId,
      domain,
      severity,
      source,
      ...(actualValue === undefined ? {} : { actualValue }),
      mappingConfidence,
    });
    if (domains[domain] === null || SCORES[severity] > SCORES[domains[domain]])
      domains[domain] = severity;
  };
  for (const f of findings) {
    if (!f || SKIP.has(f.code)) continue;
    if (f.code === 'nvmeLogMedia') {
      push(f.code, 'media', 'warning', 'nvme_error_information_log', f.values?.count);
      continue;
    }
    const domain = 'media';
    const severity = CONFIRMED_FAILURE.has(f.code)
      ? 'defective'
      : SEVERE_MEDIA.has(f.code)
        ? 'critical'
        : HISTORICAL.has(f.code)
          ? 'observe'
          : 'warning';
    const source = f.values?.id
      ? `ata_smart_attributes.${f.values.id}`
      : f.code === 'ataErrors'
        ? 'ata_smart_error_log'
        : f.code.startsWith('tests')
          ? 'self_test_log'
          : f.code.startsWith('exit')
            ? 'smartctl.exit_status'
            : 'smartctl';
    push(f.code, domain, severity, source, f.values?.count ?? f.values?.id, 'generic');
  }
  // ATA raw IDs are not universally meaningful across HDD and SSD controllers.
  // Require a known media type, a matching semantic name, and an unambiguous
  // scalar raw value before acting on a raw counter.
  const ata = raw?.ata_smart_attributes?.table;
  const isHdd = typeof raw?.rotation_rate === 'number' && raw.rotation_rate > 0;
  const isSsd = raw?.rotation_rate === 0;
  if (Array.isArray(ata) && (isHdd || isSsd)) {
    const rules = [
      [5, /^(?:Reallocated_Sector_Ct|Reallocate_NAND_Blk_Cnt)$/, 'reallocated'],
      [187, /^(?:Reported_Uncorrect|Uncorrectable_Error_Cnt)$/, 'uncorrectable'],
      [197, /^(?:Current_Pending_Sector|Current_Pending_ECC_Cnt)$/, 'pending'],
      [198, /^Offline_Uncorrectable$/, 'offlineUncorrectable'],
      [196, /^Reallocated_Event_Count$/, 'reallocationEvents'],
    ];
    for (const [id, namePattern, ruleId] of rules) {
      const row = ata.find(
        (value) => value?.id === id && namePattern.test(String(value?.name || '')),
      );
      const value = row ? ataDefectEvidence(row) : null;
      if (value?.kind !== 'count' || value.count === 0) continue;
      let severity = 'observe';
      if (id === 197 || id === 198) severity = 'critical';
      if (id === 187) severity = isSsd || value.count >= 10 ? 'critical' : 'warning';
      if (id === 5) severity = value.count >= (isHdd ? 8 : 16) ? 'critical' : 'warning';
      if (id === 196) severity = value.count >= 8 ? 'warning' : 'observe';
      push(ruleId, 'media', severity, `ata_smart_attributes.${id}`, value.count, 'verified');
    }
    // These counters are only defined here for particular ATA-SSD SMART names.
    if (isSsd) {
      const names = {
        171: /^Program_Fail_Count$/,
        181: /^(?:Program_Fail_Count|Program_Fail_Cnt_Total)$/,
        172: /^Erase_Fail_Count$/,
        182: /^(?:Erase_Fail_Count|Erase_Fail_Count_Total)$/,
        179: /^Used_Rsvd_Blk_Cnt_Tot$/,
        183: /^Runtime_Bad_Block$/,
      };
      for (const row of ata) {
        if (!row || !names[row.id]?.test(String(row.name || ''))) continue;
        const value = ataDefectEvidence(row);
        if (value.kind !== 'count' || value.count <= 0) continue;
        const severity = value.count >= 16 && [171, 181].includes(row.id) ? 'critical' : 'warning';
        const code = [171, 181].includes(row.id)
          ? 'ssdProgramFailures'
          : [172, 182].includes(row.id)
            ? 'ssdEraseFailures'
            : row.id === 179
              ? 'ssdReservedBlocksUsed'
              : 'ssdRuntimeBadBlocks';
        push(code, 'media', severity, `ata_smart_attributes.${row.id}`, value.count, 'verified');
      }
    }
  }
  const crc = Array.isArray(ata) ? ata.find((row) => row?.id === 199) : null;
  const crcValue =
    crc && /(?:CRC|UDMA_CRC)/i.test(String(crc.name || '')) ? ataDefectEvidence(crc) : null;
  if (crcValue?.kind === 'count' && crcValue.count > 0) {
    push(
      'ata_crc_history',
      'connection',
      crcValue.count >= 100 ? 'warning' : 'observe',
      'ata_smart_attributes.199',
      crcValue.count,
      'verified',
    );
  }
  // Repeated logged ATA UNC events provide media evidence even if pending
  // sectors have since been reallocated or no longer appear. Log time may
  // wrap, so neither recency nor irreparable hardware damage is claimed.
  const log = ataErrorLog(raw);
  const logRows = Array.isArray(log?.table) ? log.table : [];
  const unc = logRows.filter((row) => /\bUNC\b/.test(String(row?.error_description || ''))).length;
  if (unc > 0) {
    push('ata_unc_history', 'media', 'warning', 'ata_smart_error_log', unc, 'generic');
  }

  for (const finding of findings) {
    if (!finding || !['ssdReserveLow', 'ssdEnduranceUsed'].includes(finding.code)) continue;
    push(
      finding.code,
      'media',
      'warning',
      finding.code === 'ssdReserveLow'
        ? 'spare_available.current_percent'
        : 'endurance_used.current_percent',
      finding.values?.spare ?? finding.values?.used,
      'verified',
    );
  }

  const nv = raw?.nvme_smart_health_information_log;
  if (nv && typeof nv === 'object') {
    const warning = number(nv.critical_warning);
    if (warning !== null && warning <= 255) {
      // 0..4 are defined by the NVMe SMART/Health log. The remaining bits are
      // not silently interpreted as a proven media failure.
      for (const [bit, severity, code] of [
        [0, 'critical', 'nvme_spare_low'],
        [1, 'critical', 'nvme_temperature_warning'],
        [2, 'critical', 'nvme_reliability_degraded'],
        [3, 'defective', 'nvme_read_only'],
        [4, 'critical', 'nvme_volatile_backup_failure'],
      ]) {
        if (!(warning & (2 ** bit))) continue;
        push(
          code,
          bit === 1 ? 'thermal' : 'media',
          severity,
          'nvme_smart_health_information_log.critical_warning',
          warning,
          'verified',
        );
      }
      const unknown = warning & ~31;
      if (unknown)
        push(
          'nvme_unknown_warning_bits',
          'media',
          'warning',
          'nvme_smart_health_information_log.critical_warning',
          unknown,
          'unknown',
        );
    }
    if (warning !== null && warning > 255)
      push(
        'nvme_invalid_warning_mask',
        'media',
        'warning',
        'nvme_smart_health_information_log.critical_warning',
        warning,
        'unknown',
      );
    const spare = number(nv.available_spare);
    const threshold = number(nv.available_spare_threshold);
    if (spare !== null && threshold !== null && spare <= threshold) {
      push(
        'nvme_spare_threshold',
        'media',
        'critical',
        'nvme_smart_health_information_log.available_spare',
        spare,
        'verified',
      );
    }
    const used = number(nv.percentage_used);
    if (used !== null && used >= 60) {
      push(
        'nvme_endurance_used',
        'media',
        used >= 100 ? 'warning' : used >= 80 ? 'warning' : 'observe',
        'nvme_smart_health_information_log.percentage_used',
        used,
        'verified',
      );
    }
  }
  // Only manufacturer-reported current operating limits are suitable for an
  // actionable thermal classification. Historic maxima are not current heat.
  const temp = raw?.temperature;
  const currentTemp =
    typeof temp?.current === 'number' &&
    Number.isFinite(temp.current) &&
    temp.current >= -40 &&
    temp.current <= 150
      ? temp.current
      : null;
  const operatingMax =
    typeof temp?.op_limit_max === 'number' &&
    Number.isFinite(temp.op_limit_max) &&
    temp.op_limit_max >= 20 &&
    temp.op_limit_max <= 120
      ? temp.op_limit_max
      : null;
  const criticalMax =
    typeof temp?.critical_limit_max === 'number' &&
    Number.isFinite(temp.critical_limit_max) &&
    temp.critical_limit_max >= 20 &&
    temp.critical_limit_max <= 120
      ? temp.critical_limit_max
      : null;
  if (currentTemp !== null) {
    if (criticalMax !== null && currentTemp >= criticalMax)
      push(
        'temperature_critical_limit',
        'thermal',
        'critical',
        'temperature.critical_limit_max',
        currentTemp,
        'verified',
      );
    else if (operatingMax !== null && currentTemp >= operatingMax)
      push(
        'temperature_operating_limit',
        'thermal',
        'warning',
        'temperature.op_limit_max',
        currentTemp,
        'verified',
      );
    else if (operatingMax !== null && currentTemp >= operatingMax - 5)
      push(
        'temperature_near_operating_limit',
        'thermal',
        'observe',
        'temperature.op_limit_max',
        currentTemp,
        'verified',
      );
  }
  const unresolvedWarning = evidence.some((e) =>
    ['nvme_unknown_warning_bits', 'nvme_invalid_warning_mask'].includes(e.ruleId),
  );
  if (
    coverage.assessment === 'complete' &&
    !(exitCode & 3) &&
    !unresolvedWarning &&
    domains.media === null
  )
    domains.media = 'ok';
  // A connection/thermal warning does not establish a healthy medium.
  const scored = VALID_DOMAINS.map((name) => domains[name]).filter(Boolean);
  const overallAlert = scored.length
    ? scored.reduce((current, next) => (SCORES[next] > SCORES[current] ? next : current))
    : null;
  const canAssessMedia = domains.media !== null;
  const assessment =
    coverage.assessment === 'complete' && !(exitCode & 3) && !unresolvedWarning
      ? 'complete'
      : coverage.assessment === 'unassessable' && !canAssessMedia
        ? 'unassessable'
        : 'partial';
  const recommendedActionCodes = [];
  if (domains.media === 'defective' || domains.media === 'critical')
    recommendedActionCodes.push('prioritize_backup_or_imaging', 'stop_unnecessary_tests');
  else if (domains.media === 'warning') recommendedActionCodes.push('verify_backup');
  if (domains.connection === 'observe' || domains.connection === 'warning')
    recommendedActionCodes.push('inspect_connection_and_trend');
  if (assessment !== 'complete') recommendedActionCodes.push('improve_smart_readout');
  return {
    algorithmVersion: '1.0.0',
    assessment,
    protocol: coverage.protocol,
    coverage: { available: coverage.available, missing: coverage.missing },
    domains,
    overallAlert,
    evidence,
    recommendedActionCodes,
  };
}
module.exports = { assessHealth, LEVELS };
