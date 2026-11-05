// @ts-check
'use strict';
const { backendError } = require('../security/user-errors.js');
// Serialize command execution per OS device key, without slowing unrelated disks.
// A rejected task must never poison the queue of subsequent operations.
function createDeviceOperations() {
  /** @type {Map<string, Promise<void>>} */
  const tails = new Map();
  const quarantined = new Set();
  /**
   * @template T
   * @param {string} key
   * @param {() => T | Promise<T>} operation
   * @returns {Promise<T>}
   */
  async function run(key, operation) {
    const previous = tails.get(key) || Promise.resolve();
    const task = previous.then(async () => {
      if (quarantined.has(key)) throw backendError('smartctlProcessUnconfirmed');
      try {
        return await operation();
      } catch (error) {
        // Never start a second command on the same OS path while a killed
        // process may still be accessing the disk. Restart clears the state.
        if (
          error !== null &&
          typeof error === 'object' &&
          'processCloseUnconfirmed' in error &&
          error.processCloseUnconfirmed === true
        )
          quarantined.add(key);
        throw error;
      }
    });
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    try {
      return await task;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  }
  return { run };
}
module.exports = { createDeviceOperations };
