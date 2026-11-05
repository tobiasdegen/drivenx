// @ts-check
'use strict';
/** @typedef {import('../backend-contracts').SmartAccessDependencies} SmartAccessDependencies */
const { backendError } = require('../security/user-errors.js');
const { hasSmartctlAccessDenied, isDeviceAccessDeniedText } = require('./smart-errors.js');
const { errorMessage, errorCode } = require('../security/process-error-details.js');
/**
 * Narrow, process-local SMART access boundary.
 *
 * SECURITY: This module is NOT a privileged helper. It runs with the same OS
 * token as the Electron main process. Its purpose is to centralize device
 * authorization and forbid arbitrary smartctl flags crossing the IPC boundary.
 * A future OS-specific helper can implement this same two-operation contract.
 */
/** @param {import('../backend-contracts').SmartRaw | undefined} report */
function hasHealthData(report) {
  return (
    typeof report?.smart_status?.passed === 'boolean' ||
    (Array.isArray(report?.ata_smart_attributes?.table) &&
      report.ata_smart_attributes.table.length > 0) ||
    !!report?.nvme_smart_health_information_log ||
    !!report?.scsi_error_counter_log
  );
}

/** @param {import('../backend-contracts').SmartRaw | undefined} report @param {string} requestedType */
function hasRecoveredAtaHealthData(report, requestedType) {
  const attributes = report?.ata_smart_attributes?.table;
  if (Array.isArray(attributes) && attributes.length > 0) return true;
  // Autodetection must not mistake SCSI health from the USB bridge itself
  // for ATA health from the disk. An explicit SAT mode is ATA by definition.
  return (
    typeof report?.smart_status?.passed === 'boolean' &&
    (requestedType === 'sat,12' || report?.device?.protocol === 'ATA')
  );
}

/** @param {SmartAccessDependencies} dependencies */
function createSmartAccess({ runSmart, assertDevice }) {
  if (typeof runSmart !== 'function' || typeof assertDevice !== 'function') {
    throw new TypeError('SMART-Zugriff benötigt Ausführung und Geräteautorisation');
  }
  const timeoutMs = 25000;
  // smartctl 7.5's experimental /sat fallback first tries NVMe Identify.
  // A SATA drive can wait for the bridge's command timeout before SAT starts.
  // Keep this bounded, but allow extra time for a selected or unverified scan-discovered hybrid.
  const hybridTimeoutMs = 65000;
  /** @param {string} type */
  const isHybrid = (type) => /^snt(?:jmicron|asmedia|realtek)\/sat$/.test(type);
  /** @param {unknown} input */
  function checkedDevice(input) {
    const device = assertDevice(input);
    if (!device || typeof device.name !== 'string' || typeof device.type !== 'string') {
      throw backendError('invalidAuthorizedDevice');
    }
    return device;
  }
  /** @param {import('../backend-contracts').Device} device @param {string} type
   * @param {string} [mode] @param {number} [timeout] */
  async function readWithType(device, type, mode = '-a', timeout = timeoutMs) {
    return runSmart(
      [mode, '-j', '-d', type, device.name],
      isHybrid(type) ? hybridTimeoutMs : mode === '-x' ? 45000 : timeout,
    );
  }
  /** @param {import('../backend-contracts').Device} device */
  async function readDetail(device) {
    // NVMe's -a and -x cover the same logs. For ATA/SCSI, -x includes
    // 48-bit error/self-test logs and additional device statistics.
    const mode = device.type.toLowerCase().startsWith('nvme') ? '-a' : '-x';
    let firstResult;
    /** @type {unknown} */
    let firstError;
    try {
      firstResult = await readWithType(device, device.type, mode);
    } catch (error) {
      firstError = error;
    }
    // A bridge may return the bare SMART PASS status but omit the ATA
    // attributes when an optional -x log request fails. Recover the fuller
    // -a snapshot without treating SMART PASS alone as a complete readout.
    const ataWithoutAttributes =
      mode === '-x' &&
      firstResult?.json?.device?.protocol === 'ATA' &&
      firstResult.json.smart_status?.passed === true &&
      !firstResult.json.ata_smart_attributes?.table?.length;
    if (hasHealthData(firstResult?.json) && !ataWithoutAttributes) return firstResult;
    // smartctl can return a valid JSON report with exit bit 1 (device open
    // failure), including Windows ERROR_ACCESS_DENIED (Error=5). This is not
    // a bridge-command failure: alternative SAT modes cannot grant access.
    if (
      hasSmartctlAccessDenied(firstResult?.json) ||
      isDeviceAccessDeniedText(firstError ? errorMessage(firstError) : undefined)
    ) {
      if (firstError) throw firstError;
      return firstResult;
    }
    // If extended logs are unsupported, preserve the established -a readout.
    // This fallback uses the *same* authorized path and access mode.
    if (
      mode === '-x' &&
      ((firstResult?.exitCode ?? 0) & 0xf8) === 0 &&
      !['permission', 'timeout', 'missing_binary', 'executable_blocked'].includes(
        errorCode(firstError) || '',
      )
    ) {
      try {
        const standard = await readWithType(device, device.type);
        const standardAttributes = standard?.json?.ata_smart_attributes?.table;
        const recovered =
          !ataWithoutAttributes ||
          (Array.isArray(standardAttributes) && standardAttributes.length > 0) ||
          standard?.json?.smart_status?.passed === false;
        if (recovered && hasHealthData(standard?.json)) return standard;
      } catch {
        // Preserve the original failure if the standard command also fails.
      }
    }
    // Never retry permissions, timeouts, executable errors or confirmed
    // health failures with another device type. Only standard SAT bridge
    // variants are eligible; vendor-specific modes must not be guessed.
    const blockedCodes = ['permission', 'timeout', 'missing_binary', 'executable_blocked'];
    if (
      !['sat', 'sat,16'].includes(device.type) ||
      blockedCodes.includes(errorCode(firstError) || '') ||
      ((firstResult?.exitCode ?? 0) & 0xf8) !== 0
    ) {
      if (firstError) throw firstError;
      return firstResult;
    }
    // A bridge that rejects SAT's default 16-byte command may support the
    // autodetected type or the standards-defined 12-byte SAT command.
    // These are read-only probes of the already authorized device path.
    for (const type of ['auto', 'sat,12']) {
      try {
        const candidate = await readWithType(device, type, '-a', 15000);
        if (hasRecoveredAtaHealthData(candidate.json, type)) return candidate;
      } catch {
        // Preserve the initial result/error if no fallback succeeds.
      }
    }
    if (firstError) throw firstError;
    return firstResult;
  }
  return Object.freeze({
    /** @param {unknown} input */
    detail(input) {
      return readDetail(checkedDevice(input));
    },
    /** @param {unknown} input @param {unknown} kind */
    startTest(input, kind) {
      const device = checkedDevice(input);
      if (kind !== 'short' && kind !== 'long') {
        throw backendError('invalidSelfTestKind');
      }
      return runSmart(
        ['-t', kind, '-j', '-d', device.type, device.name],
        isHybrid(device.type) ? hybridTimeoutMs : timeoutMs,
      );
    },
  });
}
module.exports = { createSmartAccess, hasHealthData, hasRecoveredAtaHealthData };
