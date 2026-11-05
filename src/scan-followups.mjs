import { mergeAliasMetadata, collapseScanAliases } from './scan-metadata.mjs';

export function scanWarnings(messages) {
  return Array.isArray(messages) ? messages.filter((message) => typeof message === 'string') : [];
}

/** Preserve a previous selection across smartctl access-type changes. */
export function chooseScannedDevice(devices, selectedKey, previousName) {
  return (
    devices.find((device) => `${device.name}\u0000${device.type}` === selectedKey) ||
    (previousName && devices.find((device) => device.name === previousName)) ||
    devices[0]
  );
}

/** OS enrichment never blocks the first device list. A verified alias check
 * does gate *optional background SMART reads*: they must use the final visible
 * access paths, or aliases could produce duplicate history measurements.
 * The selected drive can still be diagnosed immediately.
 */
export function scheduleScanFollowups(context) {
  const { result } = context;
  if (typeof result.generation !== 'number') return Promise.resolve();
  if (result.metadataPending) void readScanMetadata(context);
  return result.aliasCheckPending ? readScanAliases(context) : Promise.resolve();
}

async function readScanMetadata({
  result,
  epoch,
  tracker,
  api,
  deviceRef,
  aliasGroupsRef,
  onDevices,
  onNotice,
}) {
  try {
    const metadata = await api.scanMetadata(result.generation);
    if (!tracker.isScanCurrent(epoch)) return;
    const devices = mergeAliasMetadata(deviceRef.current, metadata.devices, aliasGroupsRef.current);
    deviceRef.current = devices;
    onDevices(devices);
    const warnings = scanWarnings(metadata.message);
    if (warnings.length) onNotice(warnings.join(' · '));
  } catch (error) {
    if (tracker.isScanCurrent(epoch)) onNotice(String(error));
  }
}

async function readScanAliases({
  result,
  epoch,
  tracker,
  api,
  deviceRef,
  aliasGroupsRef,
  selectedRef,
  onDevices,
}) {
  try {
    const aliases = await api.scanAliases(result.generation);
    if (!tracker.isScanCurrent(epoch)) return;
    aliasGroupsRef.current = Array.isArray(aliases.groups) ? aliases.groups : [];
    const devices = collapseScanAliases(
      deviceRef.current,
      aliasGroupsRef.current,
      selectedRef.current,
    );
    deviceRef.current = devices;
    onDevices(devices);
  } catch {
    // Without verified identity, keep both access paths visible.
  }
}

/** Read optional sidebar details with no more than two concurrent readers. */
export function startBackgroundReads({
  devices,
  selectedKey,
  epoch,
  tracker,
  api,
  onDetail,
  onError,
  isDeviceCurrent = () => true,
}) {
  const remaining = devices.filter(
    (device) => `${device.name}\u0000${device.type}` !== selectedKey,
  );
  async function worker(offset) {
    for (let index = offset; index < remaining.length; index += 2) {
      if (!tracker.isScanCurrent(epoch)) return;
      const device = remaining[index];
      const key = `${device.name}\u0000${device.type}`;
      // The user may have selected this disk since the background queue was built.
      // Foreground requests take precedence over optional sidebar reads.
      if (tracker.isCurrentSelection(key) || !isDeviceCurrent(key)) continue;
      const ticket = tracker.beginDetail(key, false);
      try {
        const detail = await api.detail(device);
        if (
          tracker.isDetailCurrent(ticket) &&
          isDeviceCurrent(key) &&
          !tracker.isCurrentSelection(key)
        )
          onDetail(key, detail);
      } catch {
        if (
          tracker.isDetailCurrent(ticket) &&
          isDeviceCurrent(key) &&
          !tracker.isCurrentSelection(key)
        )
          onError(key);
      }
    }
  }
  return Promise.all(Array.from({ length: Math.min(2, remaining.length) }, (_, i) => worker(i)));
}
