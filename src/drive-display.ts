import type { Device } from './types';
import type { SmartctlReport, SmartctlSelfTestRow } from './smartctl-types';
import { translate, type Locale } from './i18n.mts';
import { selfTestResult, selfTestSupport } from '../shared/self-test-assessment.mjs';
import { errorLogCount } from './error-log-view.mjs';
export const k = (d: Device) => `${d.name}\u0000${d.type}`;
export const busName = (d?: Device, locale: Locale = 'de-DE') => {
  if (!d) return '–';
  const bus = d.transport?.trim();
  if (bus) return bus.toUpperCase() === 'USB' ? 'USB' : bus;
  if (d.internal === true) return translate(locale, 'smartView', 'busInternal');
  if (d.internal === false) return translate(locale, 'smartView', 'busExternalUnknown');
  return translate(locale, 'smartView', 'busUnknown');
};
// Transport and diagnostic protocol are independent. SCSI vendor USB is
// positive device evidence when host storage metadata is unavailable.
export const resolvedBusName = (
  d: Device | undefined,
  raw: SmartctlReport | null | undefined,
  locale: Locale = 'de-DE',
) => {
  if (d?.transport?.trim()) return busName(d, locale);
  if (
    String(raw?.scsi_vendor || '')
      .trim()
      .toUpperCase() === 'USB'
  )
    return 'USB';
  return busName(d, locale);
};
/** Classify the storage medium, not the physical transport (USB / PCIe). */
export function diskKind(raw: SmartctlReport | null | undefined, locale: Locale): string {
  if (raw?.nvme_smart_health_information_log) return 'NVMe-SSD';

  if (typeof raw?.rotation_rate === 'number' && raw.rotation_rate > 0) {
    return `HDD · ${raw.rotation_rate} rpm`;
  }

  if (raw?.rotation_rate === 0) {
    if (raw.device?.protocol === 'ATA') return raw.sata_version ? 'SATA-SSD' : 'ATA-SSD';
    if (raw.device?.protocol === 'SCSI') return 'SCSI-SSD';
    return 'SSD';
  }

  if (raw?.device?.protocol === 'SCSI' && raw.smart_support?.available === false) {
    return translate(locale, 'smartView', 'usbScsiDevice');
  }
  if (raw?.device?.protocol === 'ATA') return translate(locale, 'smartView', 'diskAtaDrive');
  return translate(locale, 'smartView', 'unknown');
}

/** macOS can identify the physical media type even when smartctl is unavailable. */
export function diskKindWithOs(
  raw: SmartctlReport | null | undefined,
  device: Device | undefined,
  locale: Locale,
): string {
  if (
    raw &&
    (raw.rotation_rate !== undefined ||
      raw.nvme_smart_health_information_log ||
      raw.device?.protocol === 'ATA')
  )
    return diskKind(raw, locale);
  if (device?.osMetadata?.solidState === true)
    return translate(locale, 'smartView', 'osIdentifiedSSD');
  return diskKind(raw, locale);
}

export const bytes = (v: unknown, locale: Locale) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0
    ? `${(v / 1e9).toLocaleString(locale, { maximumFractionDigits: 2 })} GB`
    : '–';
export const display = (v: unknown) => (v === undefined || v === null ? '–' : String(v));
export const attribute = (raw: SmartctlReport | null | undefined, id: number) =>
  raw?.ata_smart_attributes?.table?.find((a) => a.id === id);
export const attrValue = (raw: SmartctlReport | null | undefined, id: number) => {
  const value = attribute(raw, id)?.raw;
  // This is a raw-value display, not a sector counter. Keep all fields visible;
  // the authoritative interpretation is made by health.js.
  return display(value?.string ?? value?.value);
};
export const tests = (r: SmartctlReport | null | undefined): SmartctlSelfTestRow[] =>
  r?.ata_smart_self_test_log?.extended?.table ||
  r?.ata_smart_self_test_log?.standard?.table ||
  r?.nvme_self_test_log?.table ||
  r?.scsi_self_test_log?.standard?.table ||
  [];
export const failed = (t: SmartctlSelfTestRow) => selfTestResult(t) === 'failed';
export const testAvailable = (raw: SmartctlReport | null | undefined) =>
  selfTestSupport(raw) === 'supported';

/** Display count: a historical log counter is not a count of broken sectors. */
export const countDriveErrors = errorLogCount;
