import type { Locale } from './i18n.mts';
import type { DiagnosticResult } from '../shared/diagnosis-model.mjs';
import type { SmartctlReport } from './smartctl-types';
import type { OverviewData } from '../shared/overview-metrics.mjs';
export type ConnectionNode = {
  category: string;
  name: string | null;
  manufacturer: string | null;
  vendorId: string | null;
  productId: string | null;
  speed: string | null;
  locationId: string | null;
  serial: string | null;
  usbIdNames?: {
    vendorName: string;
    productName: string | null;
    source: 'usb.ids';
    version: string;
  };
};
export type Connection = {
  verified: boolean;
  source: string;
  usbDriver?: 'uasp' | 'usb-storage' | null;
  chain: ConnectionNode[];
  adapter?: unknown;
};
export type Device = {
  name: string;
  type: string;
  info_name?: string;
  requiresUsbChoice?: boolean;
  capacityBytes?: number;
  osMetadata?: {
    source: string;
    logicalBlockSize?: number;
    physicalBlockSize?: number;
    identifier?: string;
    mediaName?: string;
    solidState?: boolean;
    removable?: boolean;
    ejectable?: boolean;
  };
  transport?: string | null;
  internal?: boolean | null;
  connection?: Connection | null;
};
export type Severity = 'info' | 'warnung' | 'kritisch';
export type Finding = {
  level: Severity;
  code: string;
  values?: Record<string, number | string>;
  message?: string;
};
export type Readout = {
  status: 'vollstaendig' | 'eingeschraenkt' | 'fehlgeschlagen';
  issues: { code: string; values?: Record<string, number | string> }[];
};
export type Health = {
  diagnosis: DiagnosticResult;
  findings: Finding[];
  readout: Readout;
};
export type HistoryRecord = {
  capturedAt: string;
  status: 'ok' | 'observe' | 'warning' | 'critical' | 'defective' | 'unassessable';
  metrics: Record<string, number | null>;
};
export type HistoryResponse = {
  available: boolean;
  records: HistoryRecord[];
  backupAvailable?: boolean;
  backupWarning?: boolean;
};
export type Detail = {
  reportId: string;
  raw: SmartctlReport;
  health: Health;
  /** Normalized by the main process. Optional on restricted readouts. */
  metrics?: OverviewData;
  device: Device;
  exitCode: number;
  capturedAt: string;
};
export type Preferences = {
  backgroundDetails: boolean;
  autoSaveHistory: boolean;
  autoBackupHistory: boolean;
  binary: string;
  locale: Locale;
  theme: 'light' | 'dark' | 'system';
  attributeMode: 'friendly' | 'technical';
  companyName: string;
  companyAddress: string;
  companyContact: string;
  companyLogo: string;
};
export type Environment = {
  platform: string;
  elevated: boolean | null;
};
// The runtime declarations for window.diagnostics live in ipc-contract.ts.
