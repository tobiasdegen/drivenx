// @ts-check
'use strict';
/** @typedef {import('../backend-contracts').SelfTestDependencies} SelfTestDependencies */
const { backendError } = require('../security/user-errors.js');
const { selfTestRunning } = require('./test-state.js');
const { assertSameDevice } = require('./device-identity.js');
const { selfTestSupport } = require('../../shared/self-test-assessment.mjs');

// The request's reportId identifies exactly the SMART reading visible in the UI.
// This controller checks it again, reads the physical device, and serializes
// subsequent test commands with detail reads for the same device.
/** @param {SelfTestDependencies} dependencies */
function createSelfTestController({
  operations,
  reports,
  smartAccess,
  assertDevice,
  deviceKey,
  isScanning,
  scanGeneration,
}) {
  /** @type {Set<string>} */
  const pending = new Set();
  function isPending() {
    return pending.size > 0;
  }
  /** @param {{device: unknown; kind: unknown; reportId: unknown}} request */
  async function start({ device, kind, reportId }) {
    if ((kind !== 'short' && kind !== 'long') || typeof reportId !== 'string')
      throw backendError('badSelfTestRequest');
    if (isScanning()) throw backendError('scanInProgress');
    const d = assertDevice(device);
    const key = deviceKey(d);
    // Different -d selectors for the same OS path must not start concurrent
    // self-tests. The report cache still uses the more precise (path,type) key.
    const pendingKey = d.name;
    if (pending.has(pendingKey)) throw backendError('selfTestStartPending');
    pending.add(pendingKey);
    const generation = scanGeneration();
    try {
      return await operations.run(d.name, async () => {
        // Avoid starting even the control read when the job went stale in the queue.
        if (generation !== scanGeneration() || isScanning())
          throw backendError('scanChangedDuringDetail');
        const authorized = assertDevice(d);
        if (deviceKey(authorized) !== key) throw backendError('scanChangedDuringDetail');
        const displayed = reports.get(key);
        if (!displayed || displayed.reportId !== reportId)
          throw backendError('staleDiagnosisReload');
        const current = await smartAccess.detail(d);
        // Do not issue a potentially destructive command after a failed
        // identity probe, even if the partial JSON still has the old serial.
        const messages = current?.json?.smartctl?.messages;
        const exitCode = current?.exitCode;
        if (
          !current?.json ||
          !Number.isInteger(exitCode) ||
          (exitCode & 7) !== 0 ||
          (Array.isArray(messages) && messages.some((m) => m?.severity === 'error'))
        )
          throw backendError('controlReadFailed');
        assertSameDevice(displayed.raw, current.json);
        const capability = selfTestSupport(current.json);
        if (capability !== 'supported')
          throw backendError(
            capability === 'unsupported' ? 'selfTestUnsupported' : 'selfTestUnknown',
          );
        if (generation !== scanGeneration() || isScanning())
          throw backendError('scanChangedDuringDetail');
        if (selfTestRunning(current.json)) throw backendError('selfTestAlreadyRunning');
        // The command may have started even if smartctl times out or reports an error.
        // Never preserve the pre-test reading as an exportable current snapshot.
        let attempted = false;
        try {
          attempted = true;
          const result = await smartAccess.startTest(d, kind);
          const messages = Array.isArray(result.json?.smartctl?.messages)
            ? result.json.smartctl.messages
            : [];
          if (
            !Number.isInteger(result.exitCode) ||
            (result.exitCode & 7) !== 0 ||
            messages.some((m) => m?.severity === 'error')
          )
            throw new Error(
              `SMART-Test konnte nicht gestartet werden: ${JSON.stringify(messages)}`,
            );
          // The UI owns the translated success copy; the privileged layer
          // returns only whether the command actually passed its checks.
          return true;
        } finally {
          if (attempted) reports.invalidate(key);
        }
      });
    } finally {
      pending.delete(pendingKey);
    }
  }
  return { start, isPending };
}
module.exports = { createSelfTestController };
