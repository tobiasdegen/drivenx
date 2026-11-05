/**
 * Only the capability fields are needed here. A partial smartctl response must
 * remain compatible with the backend's permissive SmartRaw type.
 * @typedef {{
 *   device?: {protocol?: string},
 *   nvme_smart_health_information_log?: unknown,
 *   nvme_optional_admin_commands?: {self_test?: boolean},
 *   ata_smart_data?: {capabilities?: {self_tests_supported?: boolean}}
 * }} SelfTestCapabilityReport
 */
/** @typedef {import('../src/smartctl-types.ts').SmartctlSelfTestRow} SmartctlSelfTestRow */
/** @typedef {'supported' | 'unsupported' | 'unknown'} SelfTestSupport */
/** @typedef {'passed' | 'failed' | 'interrupted' | 'running' | 'unknown'} SelfTestResult */

/** One protocol-aware classification shared by SMART health, test commands and UI.
 * Missing capability information is *unknown*, never proof of support.
 */
/** @param {SmartctlSelfTestRow} row */
const wording = (row) =>
  String(typeof row?.status === 'string' ? row.status : row?.status?.string || '');
/**
 * @param {SelfTestCapabilityReport | null | undefined} raw
 * @returns {SelfTestSupport}
 */
export function selfTestSupport(raw) {
  if (!raw || typeof raw !== 'object') return 'unknown';
  if (raw.device?.protocol === 'NVMe' || raw.nvme_smart_health_information_log) {
    const flag = raw.nvme_optional_admin_commands?.self_test;
    return flag === true ? 'supported' : flag === false ? 'unsupported' : 'unknown';
  }
  const flag = raw.ata_smart_data?.capabilities?.self_tests_supported;
  if (flag === true) return 'supported';
  if (flag === false) return 'unsupported';
  // Some SCSI devices declare this capability explicitly. Mere presence of
  // historical log entries does not guarantee a new test can be initiated.
  return 'unknown';
}
/**
 * @param {SmartctlSelfTestRow} row
 * @returns {SelfTestResult}
 */
export function selfTestResult(row) {
  const s = wording(row);
  if (/aborted by (?:host|user)|interrupted.*(?:host|reset)|reset.*interrupted/i.test(s))
    return 'interrupted';
  if (/in progress|self.test in progress|testing in progress/i.test(s)) return 'running';
  if (/without error|completed successfully|successfully completed/i.test(s)) return 'passed';
  if (
    /read failure|completed.*failure|completed.*error|fatal|failed|electrical failure|servo failure/i.test(
      s,
    )
  )
    return 'failed';
  const status = typeof row?.status === 'object' ? row.status : null;
  if (status?.passed === false) return 'failed';
  if (status?.passed === true || status?.value === 0) return 'passed';
  return 'unknown';
}
