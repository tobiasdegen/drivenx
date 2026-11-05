/** Start a new renderer discovery epoch before any asynchronous scan work.
 * Neither a visible device nor an old selection may remain authorized in the
 * UI while the main process has already revoked its previous device list.
 * Keep the former selection as an immutable hint for the new discovery only.
 */
/**
 * @param {import('./request-tracker.mjs').RequestTracker} tracker
 * @param {{current: import('./types').Device[]}} deviceRef
 * @param {{current: string}} selectedRef
 * @returns {{epoch: number, previousKey: string, previousName: string | undefined}}
 */
export function beginScanSession(tracker, deviceRef, selectedRef) {
  const previousKey = selectedRef.current;
  const previousName = deviceRef.current.find(
    (device) => `${device.name}\u0000${device.type}` === previousKey,
  )?.name;
  const epoch = tracker.beginScan();
  tracker.select('');
  deviceRef.current = [];
  selectedRef.current = '';
  return { epoch, previousKey, previousName };
}

/** Removing an identity-verified alias must remove its orphaned cached state.
 * This is deliberately a pure operation, shared by detail and error maps.
 */
/**
 * @template T
 * @param {Record<string, T>} entries
 * @param {import('./types').Device[]} devices
 * @returns {Record<string, T>}
 */
export function keepVisibleDriveEntries(entries, devices) {
  const visible = new Set(devices.map((device) => `${device.name}\u0000${device.type}`));
  return Object.fromEntries(Object.entries(entries).filter(([key]) => visible.has(key)));
}
