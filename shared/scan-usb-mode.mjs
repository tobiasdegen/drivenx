import { usbMediaOptions } from './usb-media-choice.mjs';

/** A deliberately small, session-scoped preference for USB-only batch checks.
 * Never changes internal ATA/NVMe drives, RAID selectors or arbitrary SCSI
 * devices. `auto` preserves the verified smartctl --scan-open strategy.
 */
/** @typedef {'auto' | 'sat' | 'sntjmicron' | 'sntjmicron/sat' | 'sntasmedia' | 'sntasmedia/sat' | 'sntrealtek' | 'sntrealtek/sat'} ScanUsbMode */
/** @type {readonly ScanUsbMode[]} */
export const SCAN_USB_MODES = Object.freeze([
  'auto',
  'sat',
  'sntjmicron',
  'sntjmicron/sat',
  'sntasmedia',
  'sntasmedia/sat',
  'sntrealtek',
  'sntrealtek/sat',
]);
/** @param {unknown} mode @returns {mode is ScanUsbMode} */
export function validScanUsbMode(mode) {
  return typeof mode === 'string' && SCAN_USB_MODES.includes(mode);
}

/**
 * @template {{type: string, info_name?: string, transport?: string, name: string}} T
 * @param {T} device
 * @param {ScanUsbMode} mode
 * @returns {T}
 */
export function applyScanUsbMode(device, mode) {
  if (!validScanUsbMode(mode)) throw new TypeError('Invalid USB scan access mode');
  if (mode === 'auto') return device;
  const current = String(device.type || '');
  const info = String(device.info_name || '');
  // Recognize the selector class rather than individual USB product IDs.
  // Generic SCSI only qualifies if
  // smartctl explicitly reports a USB bridge, never from its path alone.
  const vendorUsb =
    usbMediaOptions(current) !== null ||
    /^usb(?:jmicron|prolific|cypress|sunplus|cyber)$/.test(current);
  const statedUsb = /\bUSB\b/i.test(info) && /^(?:scsi|sat(?:,12|,16)?|auto)$/.test(current);
  return vendorUsb || statedUsb
    ? { ...device, type: mode, transport: device.transport || 'USB' }
    : device;
}

function isUsbBridgeSelector(type) {
  return usbMediaOptions(type) !== null || /^usb\w+$/.test(type);
}

/** --scan-open is a verified type; --scan is an unverified USB-ID guess.
 * A USB-to-NVMe bridge may also expose SATA under the SAME VID:PID.
 * Prefer the opened mode for this USB path, not both entries.
 * Do not collapse RAID selectors on the basis of their path alone.
 */
/**
 * @template {{name: string, type: string, info_name?: string, transport?: string}} T
 * @param {T[]} opened
 * @param {T[]} listed
 * @returns {T[]}
 */
export function mergeOpenedAndListed(opened, listed) {
  const result = opened.map((device) => ({ ...device }));
  for (const device of listed) {
    const identical = result.find(
      (prior) => prior.name === device.name && prior.type === device.type,
    );
    if (identical) {
      if (!identical.transport && /\bUSB\b/i.test(String(device.info_name || '')))
        identical.transport = 'USB';
      continue;
    }
    // An unopened generic SCSI placeholder is not a second disk when the
    // same path was already opened successfully as SAT.
    if (
      device.type === 'scsi' &&
      result.some((prior) => prior.name === device.name && /^sat(?:,12|,16)?$/.test(prior.type))
    )
      continue;
    const openedUsb = opened.some(
      (prior) =>
        prior.name === device.name &&
        (/^(?:sat(?:,12|,16)?)$/.test(prior.type) ||
          isUsbBridgeSelector(prior.type) ||
          /\bUSB\b/i.test(String(prior.info_name || ''))),
    );
    const listedUsb =
      isUsbBridgeSelector(device.type) || /\bUSB\b/i.test(String(device.info_name || ''));
    if (openedUsb && listedUsb) {
      // A verified SAT path and an unverified USB-NVMe scan hint identify the
      // physical USB transport, even when Windows CIM details are late.
      if (isUsbBridgeSelector(device.type) || /\bUSB\b/i.test(String(device.info_name || ''))) {
        const matched = result.find((entry) => entry.name === device.name);
        if (matched && !matched.transport) matched.transport = 'USB';
      }
      continue;
    }
    result.push(device);
  }
  return result;
}
