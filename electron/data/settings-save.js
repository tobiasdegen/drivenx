// @ts-check
'use strict';

/**
 * Saving preferences includes post-write work (menu updates, settings-change
 * notifications). Serialize the whole operation, not just the file rename,
 * so an older IPC call cannot publish its result after a newer save.
 *
 * Validation and the snapshot happen on invocation, before any await. A
 * failed save must not prevent the next request from being processed.
 *
 * @template T, R
 * @param {{
 *   validate: (value: unknown) => T;
 *   persist: (value: T) => Promise<void>;
 *   apply: (value: T) => void;
 *   publish: (value: T) => Promise<R>;
 * }} options
 * @returns {(value: unknown) => Promise<R>}
 */
function createSettingsSaver({ validate, persist, apply, publish }) {
  /** @type {Promise<void>} */
  let previous = Promise.resolve();
  return (input) => {
    const next = validate(input);
    const job = previous.then(async () => {
      await persist(next);
      apply(next);
      return publish(next);
    });
    previous = job.then(
      () => {},
      () => {},
    );
    return job;
  };
}

module.exports = { createSettingsSaver };
