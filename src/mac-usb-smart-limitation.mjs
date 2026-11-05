/** A missing SMART response is a transport limitation, not a defective drive. */
/**
 * @param {import('./types').Device | undefined} device
 * @param {string | undefined} platform
 * @param {import('./types').Health['readout']['status'] | undefined} readout
 * @param {boolean} [readError]
 * @returns {boolean}
 */
export function macUsbScsiSmartLimitation(device, platform, readout, readError = false) {
  if (platform !== 'darwin' || String(device?.transport || '').toLowerCase() !== 'usb')
    return false;
  const connection = device.connection;
  if (!connection?.verified || connection.usbDriver !== 'uasp') return false;
  // Do not claim a working or partially readable ATA/NVMe diagnostic is unsupported.
  return readError || readout === 'fehlgeschlagen';
}
