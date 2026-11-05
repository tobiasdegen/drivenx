// @ts-check
'use strict';
/** @typedef {import('../backend-contracts').DiagnosticDependencies} DiagnosticDependencies */
/** @typedef {import('../backend-contracts').Report} Report */
const { backendError } = require('../security/user-errors.js');
const { errorCode } = require('../security/process-error-details.js');
const { overviewMetrics } = require('../../shared/overview-metrics.mjs');

/**
 * Owns the lifecycle of an individual SMART snapshot. An older scan or a
 * superseded device read must never become a current result or history entry.
 * Hardware access and persistence remain injected for isolated tests.
 */
/** @param {DiagnosticDependencies} dependencies */
function createDiagnosticService({
  validateDevice,
  assertDevice,
  deviceKey,
  reports,
  operations,
  smartAccess,
  evaluate,
  history,
  getSettings,
  getUserDataPath,
  scanGeneration,
  isScanning,
  createId,
  logSaveError,
}) {
  // Concurrent IPC subscribers may share one read, but persistence is a
  // snapshot side effect and must run only once for that report object.
  /** @type {WeakMap<Report, Promise<unknown>>} */
  const historyJobs = new WeakMap();
  /** @param {unknown} device @param {boolean} [fresh] @returns {Promise<Report>} */
  async function detail(device, fresh = false) {
    if (typeof fresh !== 'boolean') throw new TypeError('Invalid refresh flag');
    if (isScanning()) throw backendError('scanInProgress');
    const authorized = assertDevice(validateDevice(device));
    const key = deviceKey(authorized);
    const generation = scanGeneration();
    // A user-initiated refresh must not reuse an older in-flight smartctl
    // command for the same access path. The old result becomes stale and
    // the new command runs through the existing per-device operation queue.
    if (fresh) reports.invalidate(key);
    const report = await reports.load(key, () =>
      operations.run(authorized.name, async () => {
        // The device queue may be busy with another mode or a self-test.
        // A rescan while waiting must not trigger a stale hardware read.
        if (isScanning() || scanGeneration() !== generation)
          throw backendError('scanChangedDuringDetail');
        assertDevice(authorized);
        const result = await smartAccess.detail(authorized);
        return {
          raw: result.json,
          exitCode: result.exitCode,
          health: evaluate(result.json, result.exitCode),
          metrics: overviewMetrics(result.json),
          device: authorized,
          capturedAt: new Date().toISOString(),
          reportId: createId(),
        };
      }),
    );
    const isCurrent = () =>
      !isScanning() && scanGeneration() === generation && reports.get(key) === report;
    if (!isCurrent()) throw backendError('scanChangedDuringDetail');

    if (
      getSettings().autoSaveHistory &&
      report.health.readout.status !== 'fehlgeschlagen' &&
      history.identity(report.raw)
    ) {
      // There is no await between this validation and beginning the serialized
      // history write. A newer scan cannot interleave before the write begins.
      if (!isCurrent()) throw backendError('staleDiagnosis');
      if (!historyJobs.has(report)) {
        const job = Promise.resolve().then(() =>
          history.save(
            getUserDataPath(),
            report,
            isCurrent,
            getSettings().autoBackupHistory === true,
          ),
        );
        historyJobs.set(report, job);
      }
      try {
        await historyJobs.get(report);
      } catch (error) {
        if (errorCode(error) !== 'STALE_DIAGNOSIS') logSaveError(error);
      }
    }
    // While persistence was pending another scan may have started. Never return
    // a report that no longer belongs to the currently authorized device list.
    if (!isCurrent()) throw backendError('scanChangedDuringDetail');
    return report;
  }
  return { detail };
}
module.exports = { createDiagnosticService };
