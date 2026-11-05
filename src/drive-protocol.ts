import type { SmartctlReport } from './smartctl-types';
import { translate } from './i18n.mts';

/** SMART command protocol is distinct from the OS connection/transport (USB, PCIe, SATA). */
export type SmartProtocol = 'nvme' | 'ata' | 'scsi' | 'unknown';
export function smartProtocol(raw: SmartctlReport): SmartProtocol {
  const protocol = String(raw.device?.protocol ?? '').toUpperCase();
  if (protocol === 'NVME' || raw.nvme_smart_health_information_log) return 'nvme';
  if (protocol === 'ATA' || raw.ata_smart_attributes || raw.ata_smart_error_log) return 'ata';
  if (protocol === 'SCSI' || raw.scsi_error_counter_log) return 'scsi';
  return 'unknown';
}
export function emptyErrorMessage(protocol: SmartProtocol, locale: 'de-DE' | 'en-US'): string {
  return translate(
    locale,
    'driveProtocol',
    `empty${protocol[0].toUpperCase()}${protocol.slice(1)}`,
  );
}
export function assessmentLabel(status: string, locale: 'de-DE' | 'en-US'): string {
  if (['ok', 'warnung', 'kritisch', 'unbekannt'].includes(status))
    return translate(locale, 'driveProtocol', status);
  return status;
}
