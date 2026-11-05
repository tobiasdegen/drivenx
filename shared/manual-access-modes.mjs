/** Explicit, bounded smartctl -d choices for discovered devices only.
 * Never accept arbitrary -d strings from IPC or infer a bridge mode from VID/PID.
 * Some modes can cause buggy USB bridges to hang; only user initiated changes.
 */
/** @type {readonly string[]} */
export const MANUAL_ACCESS_MODES = Object.freeze([
  'auto',
  'scsi',
  'ata',
  'nvme',
  'sat',
  'sat,12',
  'sat,16',
  'sntjmicron',
  'sntjmicron/sat',
  'sntasmedia',
  'sntasmedia/sat',
  'sntrealtek',
  'sntrealtek/sat',
  'usbjmicron',
  'usbprolific',
  'usbcypress',
  'usbsunplus',
  'usbcyber',
]);
/** @param {unknown} mode @returns {mode is string} */
export function allowedManualAccessMode(mode) {
  return typeof mode === 'string' && MANUAL_ACCESS_MODES.includes(mode);
}
