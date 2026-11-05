// @ts-check
'use strict';
const { getCatalogSection } = require('../ui/translator.js');
const DEFAULT_MESSAGES = getCatalogSection('de-DE', 'smartFailures');

// Only diagnose permission errors when the OS or smartctl says so explicitly.
// Windows smartctl may report CreateFile's ERROR_ACCESS_DENIED as "Open failed, Error=5"
// in valid JSON rather than as an exception. Never treat exit status 2 alone as permissions.
/** @param {unknown} value */
function isDeviceAccessDeniedText(value) {
  return /(?:\baccess (?:is )?denied\b|\bpermission denied\b|\boperation not permitted\b|\bnot permitted to open\b|\binsufficient privileges\b|\badministrator privileges\b|\bmust be root\b|\bnot authorized\b|\bauthorization (?:failed|canceled|cancelled)\b|\bopen failed[,\s:]*error\s*=\s*5\b)/i.test(
    String(value || ''),
  );
}
/** @param {unknown} report */
function hasSmartctlAccessDenied(report) {
  if (!report || typeof report !== 'object' || !('smartctl' in report)) return false;
  const smartctl = report.smartctl;
  if (!smartctl || typeof smartctl !== 'object' || !('messages' in smartctl)) return false;
  const messages = smartctl.messages;
  return (
    Array.isArray(messages) &&
    messages.some(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        'severity' in entry &&
        ['error', 'warning'].includes(String(entry.severity)) &&
        'string' in entry &&
        isDeviceAccessDeniedText(entry.string),
    )
  );
}
// SMART exit bits 2-7 indicate device/health issues, not necessarily permissions.
/**
 * @typedef {'permission'|'missing_binary'|'executable_blocked'|'timeout'|'device'|'other'} SmartFailureCode
 * @typedef {Error & {code: SmartFailureCode; processCloseUnconfirmed?: boolean; smartFailureKey?: string}} SmartProcessError
 * @typedef {{code?: string | number; stderr?: string; stdout?: string; message?: string; platform?: string}} FailureContext
 * @param {FailureContext} [context]
 * @returns {{code: SmartFailureCode; message: string | null}}
 */
function classifySmartFailure({
  code,
  stderr = '',
  stdout = '',
  message = '',
  platform = process.platform,
} = {}) {
  const content = `${stderr}\n${stdout}\n${message}`.slice(0, 8192);
  // A spawn EACCES is about executing the smartctl binary. Its message may
  // also contain "permission denied", but that is NOT disk access denial.
  if (code === 'EACCES_EXEC')
    return {
      code: 'executable_blocked',
      message: DEFAULT_MESSAGES.executableBlocked,
    };
  if (code === 'EACCES' || code === 'EPERM' || isDeviceAccessDeniedText(content)) {
    return {
      code: 'permission',
      message:
        platform === 'win32'
          ? DEFAULT_MESSAGES.permissionWin
          : platform === 'linux'
            ? DEFAULT_MESSAGES.permissionLinux
            : DEFAULT_MESSAGES.permissionOther,
    };
  }
  if (code === 'ENOENT')
    return {
      code: 'missing_binary',
      message: DEFAULT_MESSAGES.missingBinary,
    };
  if (code === 'ETIMEDOUT')
    return {
      code: 'timeout',
      message: DEFAULT_MESSAGES.timeout,
    };
  if (
    /(?:no such device|device not found|cannot open device|unknown usb bridge|unsupported device)/i.test(
      content,
    )
  ) {
    return {
      code: 'device',
      message: DEFAULT_MESSAGES.device,
    };
  }
  return { code: 'other', message: null };
}
/** @param {string} detail @param {FailureContext} [options] @returns {SmartProcessError} */
function smartProcessError(detail, options = {}) {
  const classified = classifySmartFailure({ ...options, message: detail });
  /** @type {SmartProcessError} */
  const error = Object.assign(new Error(classified.message || detail), { code: classified.code });
  if (classified.message) {
    /** @type {Partial<Record<SmartFailureCode, string>>} */
    const keyByCode = {
      executable_blocked: 'executableBlocked',
      missing_binary: 'missingBinary',
      timeout: 'timeout',
      device: 'device',
    };
    const platform = options.platform || process.platform;
    error.smartFailureKey =
      classified.code === 'permission'
        ? platform === 'win32'
          ? 'permissionWin'
          : platform === 'linux'
            ? 'permissionLinux'
            : 'permissionOther'
        : keyByCode[classified.code];
  }
  return error;
}
module.exports = {
  classifySmartFailure,
  smartProcessError,
  isDeviceAccessDeniedText,
  hasSmartctlAccessDenied,
};
