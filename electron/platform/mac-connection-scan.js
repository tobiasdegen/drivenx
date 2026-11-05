'use strict';
const { parseUsbProfiler, parseIoregTree } = require('../devices/connection.js');
const { macDisplayName } = require('./mac-display-name.js');

// Probe physical transport concurrently. Expensive USB inventories are only
// requested when diskutil actually identifies at least one USB disk.
async function resolveMacConnections(devices, { getInfo, readIoreg, readProfiler, parseInfo }) {
  // Distinct smartctl access modes can refer to the same BSD disk. Query its
  // OS metadata once rather than launching redundant diskutil processes.
  const byName = new Map();
  const entries = await Promise.all(
    devices.map(async (device) => {
      if (!/^\/dev\/disk\d+$/.test(device.name)) return { device, basic: {} };
      if (!byName.has(device.name))
        byName.set(
          device.name,
          Promise.resolve()
            .then(() => getInfo(device.name))
            .then(parseInfo)
            .catch(() => ({})),
        );
      return { device, basic: await byName.get(device.name) };
    }),
  );
  const usb = entries.filter(({ basic }) => basic.transport?.toLowerCase() === 'usb');
  const usbByName = new Map(usb.map((entry) => [entry.device.name, entry.device]));
  if (!usbByName.size)
    return entries.map(({ device, basic }) => {
      const name = macDisplayName(device, basic, null);
      return {
        ...device,
        ...basic,
        ...(name !== device.name || device.info_name ? { info_name: name } : {}),
      };
    });
  let ioTree = null;
  try {
    ioTree = await readIoreg();
  } catch {
    /* optional inventory */
  }
  const known = new Map();
  if (ioTree)
    for (const device of usbByName.values()) {
      const hit = parseIoregTree(ioTree, device.name);
      if (hit) known.set(device.name, hit);
    }
  // Older Macs may expose a device through system_profiler but not IORegistry.
  if (known.size !== usbByName.size) {
    try {
      const profiler = await readProfiler();
      for (const device of usbByName.values())
        if (!known.has(device.name)) {
          const hit = parseUsbProfiler(profiler, device.name);
          if (hit) known.set(device.name, hit);
        }
    } catch {
      /* physical USB bus is still known */
    }
  }
  return entries.map(({ device, basic }) => {
    const name = macDisplayName(device, basic, known.get(device.name) || null);
    return {
      ...device,
      ...basic,
      ...(name !== device.name || device.info_name ? { info_name: name } : {}),
      ...(basic.transport?.toLowerCase() === 'usb'
        ? { connection: known.get(device.name) || null }
        : {}),
    };
  });
}
module.exports = { resolveMacConnections };
