import type {
  Device,
  Detail,
  Environment,
  Preferences,
  HistoryRecord,
  HistoryResponse,
} from './types';

export type { Locale } from './i18n.mts';
import type { Locale } from './i18n.mts';
/** Only these fields authorize hardware operations; OS metadata stays in the renderer. */
export type DeviceReference = Pick<Device, 'name' | 'type'>;
export type SelfTestKind = 'short' | 'long';
export type ExportFormat = 'json' | 'pdf' | 'html';
export type MenuCommand =
  | 'scan'
  | 'pdf'
  | 'json'
  | 'html'
  | 'overview'
  | 'hardware'
  | 'history'
  | 'attributes'
  | 'tests'
  | 'errors';
export type EditablePreferences = Omit<Preferences, 'binary'>;
export interface ScanResult {
  devices: Device[];
  message?: string[];
  generation: number;
  metadataPending?: boolean;
  aliasCheckPending?: boolean;
}
export interface ScanMetadataResult {
  devices: Device[];
  message: string[];
}
export interface ScanAliasResult {
  groups: Pick<Device, 'name' | 'type'>[][];
}
export interface ExportResult {
  path?: string;
  canceled: boolean;
}
export interface VersionResult {
  binary: string;
  details: { versionText?: string; version?: number[] };
}

export type QueryMode =
  | 'scan-open'
  | 'scan'
  | 'version'
  | 'self-test'
  | 'extended'
  | 'standard'
  | 'identify'
  | 'other'
  | 'windows-inventory'
  | 'windows-privilege'
  | 'diskutil-list'
  | 'diskutil-list-text'
  | 'diskutil-info'
  | 'ioreg-usb'
  | 'mac-host-io'
  | 'system-profiler-usb';
export type QueryStatus = 'running' | 'ok' | 'finding' | 'partial' | 'error';
export interface QueryLogEntry {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  mode: QueryMode;
  device: string | null;
  kind: string | null;
  command: string;
  status: QueryStatus;
  exitCode: number | null;
  errorCode: string | null;
  hasResult: boolean;
  resultTruncated: boolean;
}
export interface QueryResult {
  text: string;
  format: 'text' | 'json';
  truncated: boolean;
}
/** Methods exposed by the context-isolated Electron preload bridge. */
export interface DiagnosticsBridge {
  onQueryLogChanged(callback: () => void): () => void;
  onQueryLogAppearanceChanged(
    callback: (value: { locale: Locale; theme: 'dark' | 'light' | 'system' }) => void,
  ): () => void;
  queryLogAppearance(): Promise<{ locale: Locale; theme: 'dark' | 'light' | 'system' }>;
  queryLog(): Promise<QueryLogEntry[]>;
  queryLogResult(id: number): Promise<QueryResult | null>;
  saveQueryLogResult(id: number): Promise<{ canceled: boolean }>;
  clearQueryLog(): Promise<boolean>;
  exportQueryLog(includeRaw?: boolean): Promise<{ canceled: boolean }>;
  openPreferences(): Promise<boolean>;
  onMenuCommand(callback: (command: MenuCommand) => void): () => void;
  onPreferencesChanged(callback: (value: Preferences) => void): () => void;
  environment(): Promise<Environment>;
  settings(): Promise<Preferences>;
  saveSettings(value: EditablePreferences): Promise<Preferences>;
  chooseLogo(): Promise<string | null>;
  version(): Promise<VersionResult>;
  scan(preferredUsbMode?: import('../shared/scan-usb-mode.mjs').ScanUsbMode): Promise<ScanResult>;
  scanMetadata(generation: number): Promise<ScanMetadataResult>;
  scanAliases(generation: number): Promise<ScanAliasResult>;
  detail(device: DeviceReference, fresh?: boolean): Promise<Detail>;
  selectAccessMode(
    device: DeviceReference,
    mode: string,
    generation: number,
  ): Promise<DeviceReference>;
  history(device: DeviceReference, reportId: string): Promise<HistoryResponse>;
  macHostIo(
    device: DeviceReference,
    reportId: string,
  ): Promise<Partial<
    Record<
      | 'bytesRead'
      | 'bytesWritten'
      | 'operationsRead'
      | 'operationsWrite'
      | 'errorsRead'
      | 'errorsWrite'
      | 'retriesRead'
      | 'retriesWrite',
      number
    >
  > | null>;
  windowsTrim(): Promise<{
    supported: boolean;
    ntfs: 'enabled' | 'disabled' | null;
    refs: 'enabled' | 'disabled' | null;
  }>;
  saveHistory(device: DeviceReference, reportId: string): Promise<HistoryRecord[]>;
  restoreLocalHistory(
    device: DeviceReference,
    reportId: string,
  ): Promise<{ records: HistoryRecord[] }>;
  exportHistory(device: DeviceReference, reportId: string): Promise<ExportResult>;
  importHistory(
    device: DeviceReference,
    reportId: string,
  ): Promise<ExportResult & { records?: HistoryRecord[] }>;
  test(device: DeviceReference, kind: SelfTestKind, reportId: string): Promise<{ message: string }>;
  exportReport(
    device: DeviceReference,
    format: ExportFormat,
    locale: Locale,
    reportId: string,
  ): Promise<ExportResult>;
}

declare global {
  interface Window {
    diagnostics: DiagnosticsBridge;
  }
}
