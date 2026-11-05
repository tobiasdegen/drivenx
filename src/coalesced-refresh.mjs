/**
 * Refresh live data without starting overlapping IPC reads. If another update
 * arrives while one is pending, discard the outdated response and perform
 * exactly one trailing read. Disposal stops updates after unmount.
 */
/**
 * @template T
 * @param {() => Promise<T>} read
 * @param {(value: T) => void} publish
 * @param {(error: unknown) => void} reportError
 * @returns {{refresh: () => Promise<void>, dispose: () => void}}
 */
export function createCoalescedRefresh(read, publish, reportError) {
  let active = true;
  let queued = false;
  let running = null;
  function refresh() {
    if (!active) return Promise.resolve();
    queued = true;
    if (running) return running;
    const job = (async () => {
      while (active && queued) {
        queued = false;
        try {
          const value = await read();
          if (active && !queued) publish(value);
        } catch (error) {
          if (active && !queued) reportError(error);
        }
      }
    })();
    running = job.finally(() => {
      running = null;
      // A refresh may be requested after the final loop check, but before
      // this completion callback runs. Never lose that last notification.
      if (active && queued) return refresh();
    });
    return running;
  }
  return {
    refresh,
    dispose() {
      active = false;
      queued = false;
    },
  };
}
