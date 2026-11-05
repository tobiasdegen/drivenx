import { MANUAL_ACCESS_MODES } from './manual-access-modes.mjs';

/**
 * `smartctl --scan` supplies a candidate -d selector, not proof of the medium
 * installed behind a USB bridge. Decide by the *selector class*, never a
 * vendor/product ID, model name or a private copy of the drive database.
 *
 * `snt*` denotes a USB-to-NVMe bridge driver. Some such bridges also accept
 * SATA drives. On Windows, defer all opening/identity reads until a person
 * has chosen, even when the scan suggests a concrete NVMe driver.
 *
 * Driver options offered to the user are limited to the smartctl selectors
 * already explicitly supported by the application. Do not synthesize new
 * -d arguments for unknown drivers.
 */
const supportedModes = new Set(MANUAL_ACCESS_MODES);

function candidateUsbNvmeDriver(type) {
  if (typeof type !== 'string') return null;
  const driver = type.endsWith('/sat') ? type.slice(0, -4) : type;
  return /^snt[a-z][a-z0-9]*$/.test(driver) ? driver : null;
}

/** The returned object describes options, not an automatically selected type. */
/** @typedef {'sata' | 'nvme' | 'unknown'} UsbMediaKind */
/**
 * @param {unknown} type
 * @returns {{sata: 'sat', nvme: string | null, unknown: string | null} | null}
 */
export function usbMediaOptions(type) {
  const bridge = candidateUsbNvmeDriver(type);
  if (!bridge) return null;
  return {
    sata: 'sat',
    nvme: supportedModes.has(bridge) ? bridge : null,
    // smartctl 7.5 tries NVMe first. Offer only if the explicit combined
    // selector is known to be supported; never silently attempt it.
    unknown: supportedModes.has(`${bridge}/sat`) ? `${bridge}/sat` : null,
  };
}

/**
 * @param {{type?: string} | null | undefined} device
 * @param {string} platform
 * @returns {boolean}
 */
export function needsUsbMediaChoice(device, platform) {
  return platform === 'win32' && usbMediaOptions(device?.type) !== null;
}

/**
 * @param {UsbMediaKind} kind
 * @param {string} currentType
 * @returns {string | null}
 */
export function usbMediaAccessMode(kind, currentType) {
  const options = usbMediaOptions(currentType);
  return options && Object.hasOwn(options, kind) ? options[kind] : null;
}
