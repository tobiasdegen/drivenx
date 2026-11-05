'use strict';
const { sortFindings } = require('./finding-order.js');
const { healthCoverage } = require('./health-coverage.js');
const { assessHealth } = require('./health-assessment.js');
const { firstDecimal, ataDefectEvidence } = require('./ata-raw.js');
const { hasSmartctlAccessDenied } = require('../devices/smart-errors.js');
const { ataErrorLog, ataTestLog } = require('./ata-logs.js');
const { ssdFindings } = require('./ssd-health.js');
const { selfTestSupport, selfTestResult } = require('../../shared/self-test-assessment.mjs');
// SMART health and readout completeness are independent dimensions.
const attr = (r, id) =>
  Array.isArray(r?.ata_smart_attributes?.table)
    ? r.ata_smart_attributes.table.find((a) => a?.id === id)
    : null;
const number = (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const testRows = (r) => {
  for (const rows of [
    ataTestLog(r)?.table,
    r?.nvme_self_test_log?.table,
    r?.scsi_self_test_log?.standard?.table,
  ]) {
    if (Array.isArray(rows)) return rows;
  }
  return [];
};
const testInterrupted = (row) => selfTestResult(row) === 'interrupted';
const testFailed = (row) => selfTestResult(row) === 'failed';
// smartctl places newest self-test entries first. A later successful long
// test supersedes an older failed test for current health assessment, but
// the old failure remains visible as history. Do not compare lifetime hours:
// the legacy ATA self-test timestamp wraps after 65536 hours.
function testHistory(rows) {
  const newerPassedLongIndex = rows.findIndex((row) => {
    const type = String(row?.type?.string || '');
    const status = row?.status;
    return (
      /extended|long/i.test(type) &&
      (status?.passed === true || (status?.value === 0 && status?.passed !== false))
    );
  });
  let failed = 0;
  let historical = 0;
  let interrupted = 0;
  rows.forEach((row, index) => {
    if (testInterrupted(row)) interrupted++;
    else if (testFailed(row)) {
      if (newerPassedLongIndex !== -1 && index > newerPassedLongIndex) historical++;
      else failed++;
    }
  });
  return { failed, historical, interrupted };
}
function nvmeErrorSummary(r) {
  const log = r?.nvme_error_information_log;
  const entries = Array.isArray(log?.table) ? log.table : [];
  let command = 0,
    media = 0,
    other = 0;
  for (const entry of entries) {
    const sf = entry?.status_field || {},
      type = sf.status_code_type,
      code = sf.status_code;
    if ((type === 0 && [1, 2].includes(code)) || (type === 1 && code === 9)) command++;
    else if (type === 2) media++;
    else other++;
  }
  const cumulative = number(r?.nvme_smart_health_information_log?.num_err_log_entries);
  const unread = number(log?.unread);
  // NVMe error log is a rolling partial sample. Never infer all cumulative entries from it.
  return {
    command,
    media,
    other,
    entries: entries.length,
    cumulative,
    unread,
    partial:
      (cumulative !== null && cumulative > entries.length) || (unread !== null && unread > 0),
  };
}
function supportsSelfTest(r) {
  const support = selfTestSupport(r);
  return support === 'unknown' ? null : support === 'supported';
}
// Device-specific presentation is provided by smartctl/DriveDB. Only universal
// defect indicators are assessed here. Packed ATA raw values are opaque.
const ATA_DEFECT_INDICATORS = Object.freeze({
  5: 'reallocated',
  187: 'uncorrectable',
  197: 'pending',
  198: 'offlineUncorrectable',
});
function evaluate(r, exitCode = r?.smartctl?.exit_status ?? 0) {
  const findings = [],
    readoutIssues = [];
  const add = (level, code, values = {}) => findings.push({ level, code, values });
  const issue = (code, values = {}) => readoutIssues.push({ code, values });
  const nv = r?.nvme_smart_health_information_log;
  const sc = r?.scsi_error_counter_log;
  const ata = r?.ata_smart_attributes?.table;
  const coverage = healthCoverage(r);
  const evidence = coverage.assessment !== 'unassessable';
  const sufficient = coverage.assessment === 'complete';
  if (r?.smart_status?.passed === false) add('kritisch', 'smartFailed');
  const testResults = testHistory(testRows(r));
  if (testResults.failed) add('kritisch', 'testsFailed', { count: testResults.failed });
  if (testResults.historical) add('warnung', 'testsHistorical', { count: testResults.historical });
  if (testResults.interrupted) add('info', 'testsInterrupted', { count: testResults.interrupted });
  const ataErrors = number(ataErrorLog(r)?.count);
  // The ATA error counter is cumulative. Its size alone does not prove a
  // current drive defect; actual failing tests, sectors and thresholds do.
  if (ataErrors > 0) add('warnung', 'ataErrors', { count: ataErrors });
  for (const [idText, code] of Object.entries(ATA_DEFECT_INDICATORS)) {
    const id = Number(idText),
      a = attr(r, id);
    if (!a) continue;
    const evidence = ataDefectEvidence(a);
    if (evidence.kind === 'unknown') issue('unknownRaw', { id });
    else if (evidence.kind === 'vendor' && evidence.nonzero)
      add('warnung', 'vendorRaw', { id, name: String(a.name || `SMART ${id}`) });
    else if (evidence.kind === 'count' && evidence.count > 0)
      add(id === 197 || id === 198 ? 'kritisch' : 'warnung', code, { id, count: evidence.count });
  }
  // SMART 199 is a lifetime interface CRC counter, not a bad-sector counter.
  // A nonzero historic value alone cannot establish a currently faulty cable.
  const crcEvidence = ataDefectEvidence(attr(r, 199));
  if (crcEvidence.kind === 'count' && crcEvidence.count > 0)
    add('info', 'ataCrcHistory', { count: crcEvidence.count });
  for (const finding of ssdFindings(r)) add(finding.level, finding.code, finding.values);
  // ATA 196 records reallocation *events*, not a count of bad sectors.
  // Only assess a plain decimal value. Packed vendor fields remain opaque.
  const reallocationEvent = attr(r, 196);
  if (reallocationEvent) {
    const eventEvidence = ataDefectEvidence(reallocationEvent);
    if (eventEvidence.kind === 'count' && eventEvidence.count > 0)
      add('warnung', 'reallocationEvents', { count: eventEvidence.count });
  }
  if (Array.isArray(ata))
    for (const a of ata) {
      // A failure IN_THE_PAST is not a current threshold breach.
      if (!a || typeof a !== 'object') continue;
      const when = String(a.when_failed || '')
        .trim()
        .toLowerCase();
      const currentBreach =
        typeof a.thresh === 'number' &&
        a.thresh > 0 &&
        typeof a.value === 'number' &&
        a.value <= a.thresh;
      if (currentBreach || when === 'now' || when === 'failing_now')
        add('kritisch', 'thresholdFailed', { id: a.id });
      else if (when === 'in_the_past' || when === 'past')
        add('warnung', 'thresholdPast', { id: a.id });
    }
  if (nv) {
    const log = nvmeErrorSummary(r);
    if (log.media > 0) add('warnung', 'nvmeLogMedia', { count: log.media });
    if (log.command > 0) add('info', 'nvmeCommandErrors', { count: log.command });
    if (log.other > 0) add('info', 'nvmeOtherErrors', { count: log.other });
    if (log.partial && log.cumulative > 0)
      add('info', 'nvmeLogPartial', { count: log.entries, total: log.cumulative });
    if (number(nv.critical_warning) > 0) add('kritisch', 'nvCritical');
    if (number(nv.media_errors) > 0) add('warnung', 'nvMedia', { count: nv.media_errors });
    if (
      number(nv.available_spare) !== null &&
      number(nv.available_spare_threshold) !== null &&
      nv.available_spare < nv.available_spare_threshold
    )
      add('kritisch', 'nvSpare');
    if (number(nv.percentage_used) !== null && nv.percentage_used >= 100)
      add('warnung', 'nvWear', { count: nv.percentage_used });
  }
  if (sc) {
    // Summing individually safe counters can overflow Number.MAX_SAFE_INTEGER.
    const uncorrected = ['read', 'write', 'verify'].reduce(
      (total, key) => total + BigInt(number(sc[key]?.total_uncorrected_errors) ?? 0),
      0n,
    );
    if (uncorrected > 0n)
      add('kritisch', 'scsiUncorrected', {
        count:
          uncorrected <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(uncorrected)
            : uncorrected.toString(),
      });
  }
  if (exitCode & 8) add('kritisch', 'exitSmart');
  if (exitCode & 16) add('kritisch', 'exitPrefail');
  if (
    exitCode & 32 &&
    !findings.some((f) =>
      [
        'reallocated',
        'uncorrectable',
        'pending',
        'offlineUncorrectable',
        'thresholdFailed',
      ].includes(f.code),
    )
  )
    add('warnung', 'exitAttributes');
  if (exitCode & 64 && ataErrors === null && !(nv && number(nv.num_err_log_entries) !== null))
    add('warnung', 'exitLog');
  if (exitCode & 128 && !testResults.failed && !testResults.historical)
    add('warnung', 'exitSelfTest');
  if (hasSmartctlAccessDenied(r)) issue('permissionDenied');
  if (exitCode & 1) issue('commandFailure');
  if (exitCode & 2) issue('deviceOpenFailure');
  if (exitCode & 4) issue('partialRead');
  if (!evidence) issue('noHealthData');
  else if (!sufficient) issue('partialRead');
  const sortedFindings = sortFindings(findings);
  const diagnosis = assessHealth(r, exitCode, coverage, sortedFindings);
  if (findings.length === 0)
    add(
      'info',
      diagnosis.domains.media === 'ok' && diagnosis.overallAlert === 'ok' ? 'noIssues' : 'noData',
    );
  return {
    findings: sortFindings(findings),
    diagnosis,
    readout: {
      status: !evidence
        ? 'fehlgeschlagen'
        : readoutIssues.length
          ? 'eingeschraenkt'
          : 'vollstaendig',
      issues: readoutIssues,
    },
  };
}
module.exports = {
  evaluate,
  firstDecimal,
  testRows,
  testFailed,
  testInterrupted,
  testHistory,
  nvmeErrorSummary,
  supportsSelfTest,
  ataDefectEvidence,
  ATA_DEFECT_INDICATORS,
};
