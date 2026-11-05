/** Reuse concurrent SMART reads of the same device within one scan. */
/**
 * @param {(device: import('./types').Device, fresh: boolean) => Promise<import('./types').Detail>} readDetail
 * @returns {{
 * read(device: import('./types').Device, options?: {fresh?: boolean}): Promise<import('./types').Detail>,
 * invalidate(key: string): void,
 * clear(): void
 * }}
 */
export function createDetailRequests(readDetail) {
  const pending = new Map();

  function invalidate(key) {
    // Existing promise subscribers finish, but future reads must start a new
    // device request. An older completion cannot remove the new entry.
    pending.delete(key);
  }

  function read(device, { fresh = false } = {}) {
    const key = `${device.name}\u0000${device.type}`;
    if (fresh) invalidate(key);
    const existing = pending.get(key);
    if (existing) return existing;

    // Resolve in a microtask so synchronous bridge failures are handled like rejections.
    const request = Promise.resolve().then(() => readDetail(device, fresh));
    pending.set(key, request);
    const release = () => {
      // An older scan must never erase a new scan's pending request.
      if (pending.get(key) === request) pending.delete(key);
    };
    request.then(release, release);
    return request;
  }

  return { read, invalidate, clear: () => pending.clear() };
}
