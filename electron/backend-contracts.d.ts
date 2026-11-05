import type { DiagnosticResult } from '../shared/diagnosis-model.mjs';
/** Checked boundaries for discovery, diagnosis and persistence (Main process). */
export interface Device {
  name: string;
  type: string;
  info_name?: string;
  requiresUsbChoice?: boolean;
  capacityBytes?: number;
  osMetadata?: unknown;
  transport?: string | null;
  internal?: boolean | null;
  connection?: unknown;
}
export interface SmartRaw {
  [key: string]: unknown;
  smart_status?: { passed?: boolean };
  device?: { protocol?: string };
  smartctl?: { messages?: Array<{ severity?: string; string?: string }> };
  nvme_namespaces?: Array<{ id?: number }>;
  nvme_namespace_id?: number;
  nvme_smart_health_information_log?: Record<string, unknown>;
  scsi_error_counter_log?: {
    read?: { total_uncorrected_errors?: unknown };
    write?: { total_uncorrected_errors?: unknown };
    verify?: { total_uncorrected_errors?: unknown };
  };
  ata_smart_attributes?: {
    table?: Array<{ id: number; name?: string; raw?: { string?: string; value?: unknown } }>;
  };
}
export interface Health {
  diagnosis: DiagnosticResult;
  findings: Array<{
    level: 'info' | 'warnung' | 'kritisch';
    code: string;
    values?: Record<string, number | string>;
    message?: string;
  }>;
  readout: {
    status: 'vollstaendig' | 'eingeschraenkt' | 'fehlgeschlagen';
    issues: Array<{ code: string; values?: Record<string, number | string> }>;
  };
}
export interface Report {
  raw: SmartRaw;
  exitCode: number;
  health: Health;
  metrics: {
    powerOnHours?: number | null;
    powerCycles?: number | null;
    wearPercent?: number | null;
    ataWrittenBytes?: string | null;
    [name: string]: unknown;
  };
  device: Device;
  capturedAt: string;
  reportId: string;
}
export interface HistoryRecord {
  capturedAt: string;
  status: 'ok' | 'observe' | 'warning' | 'critical' | 'defective' | 'unassessable';
  metrics: Record<string, number | null>;
}
export interface HistoryEntry extends HistoryRecord {
  id: string;
}
export interface HistoryRecordInput extends Omit<HistoryRecord, 'metrics'> {
  metrics: Record<string, number | null>;
}
export interface ScanResult {
  devices: Device[];
  message: string[];
  generation: number;
  metadataPending: boolean;
  aliasCheckPending: boolean;
}
export interface WindowsInventoryResult {
  inventory: unknown;
  warning?: string | null;
  durationMs?: number;
}
export interface ScanDependencies {
  getLocale?: () => string;
  platform: NodeJS.Platform;
  scanDevices: (mode: string) => Promise<{ devices: Device[]; warnings: string[] }>;
  safeDevice: (value: unknown) => Device;
  deviceKey: (device: Device) => string;
  startWindowsInventory: () => Promise<WindowsInventoryResult>;
  parseWindowsInventory: (inventory: unknown, device: Device) => Partial<Device>;
  possibleWindowsAliases: (devices: Device[]) => Device[];
  findWindowsNvmeAliases: (
    devices: Device[],
    identify: (device: Device) => Promise<SmartRaw>,
  ) => Promise<unknown[]>;
  runSmart: (args: string[], timeout: number) => Promise<{ json: SmartRaw }>;
  operations: { run: <T>(path: string, job: () => Promise<T> | T) => Promise<T> };
  reports: { reset: () => void; invalidate: (key: string) => void };
  logStartup: (tag: string, value: string | number) => void;
  isTestPending: () => boolean;
}
export interface DiagnosticDependencies {
  validateDevice: (device: unknown) => Device;
  assertDevice: (device: Device) => Device;
  deviceKey: (device: Device) => string;
  reports: {
    invalidate: (key: string) => void;
    get: (key: string) => Report | undefined;
    load: (key: string, loader: () => Promise<Report>) => Promise<Report>;
  };
  operations: ScanDependencies['operations'];
  smartAccess: { detail: (device: Device) => Promise<{ json: SmartRaw; exitCode: number }> };
  evaluate: (raw: SmartRaw, exitCode: number) => Health;
  history: {
    identity: (raw: SmartRaw) => string | null;
    save: (
      directory: string,
      report: Report,
      canWrite: () => boolean,
      autoBackup?: boolean,
    ) => Promise<unknown>;
  };
  getSettings: () => { autoSaveHistory: boolean; autoBackupHistory?: boolean };
  getUserDataPath: () => string;
  scanGeneration: () => number;
  isScanning: () => boolean;
  createId: () => string;
  logSaveError: (error: unknown) => void;
}

export interface HistoryIpcResults {
  'diagnostics:history': {
    available: boolean;
    records: HistoryRecord[];
    backupAvailable?: boolean;
    backupWarning?: boolean;
  };
  'diagnostics:restoreLocalHistory': { records: HistoryRecord[] };
  'diagnostics:saveHistory': HistoryRecord[];
  'diagnostics:exportHistory': { canceled: boolean };
  'diagnostics:importHistory': { canceled: boolean; records?: HistoryRecord[] };
}

export interface HistoryIpcDependencies {
  register: <K extends keyof HistoryIpcResults>(
    channel: K,
    handler: (device: unknown, reportId: unknown) => Promise<HistoryIpcResults[K]>,
  ) => void;
  currentReport: (device: unknown) => Report | undefined;
  history: {
    identity: (raw: SmartRaw) => string | null;
    read: (dir: string, id: string) => Promise<HistoryRecord[]>;
    save: (
      dir: string,
      report: Report,
      canWrite?: () => boolean,
      autoBackup?: boolean,
    ) => Promise<HistoryRecord[]>;
    importBackup: (
      dir: string,
      id: string,
      backup: unknown,
      canWrite?: () => boolean,
    ) => Promise<HistoryRecord[]>;
    exportBackup: (id: string, records: HistoryRecord[]) => unknown;
    hasLocalBackup?: (dir: string, id: string) => Promise<boolean>;
    restoreLocalBackup: (
      dir: string,
      id: string,
      canWrite?: () => boolean,
    ) => Promise<HistoryRecord[]>;
  };
  getUserDataPath: () => string;
  ipcValidate: { reportIdToken: (token: unknown) => string };
  showSaveDialog: (
    window: unknown,
    options: object,
  ) => Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog: (
    window: unknown,
    options: object,
  ) => Promise<{ canceled: boolean; filePaths?: string[] }>;
  getMainWindow: () => unknown;
  getSettings: () => { locale: 'de-DE' | 'en-US'; autoBackupHistory?: boolean };
  readLimitedJson: (path: string, limit: number) => Promise<unknown>;
  writeFile?: typeof import('node:fs/promises').writeFile;
  renameFile?: typeof import('node:fs/promises').rename;
  removeFile?: typeof import('node:fs/promises').rm;
}

/** Typed contracts for additional Electron Main services (kept in CommonJS). */
export interface SmartResult {
  json: SmartRaw;
  exitCode: number;
}
export interface SmartAccessDependencies {
  runSmart: (args: string[], timeoutMs: number) => Promise<SmartResult>;
  assertDevice: (input: unknown) => Device;
}
export interface SelfTestDependencies {
  operations: ScanDependencies['operations'];
  reports: {
    get: (key: string) => Report | undefined;
    invalidate: (key: string) => void;
  };
  smartAccess: {
    detail: (device: Device) => Promise<SmartResult>;
    startTest: (device: Device, kind: 'short' | 'long') => Promise<SmartResult>;
  };
  assertDevice: (input: unknown) => Device;
  deviceKey: (device: Device) => string;
  isScanning: () => boolean;
  scanGeneration: () => number;
}
export interface ReportExportDependencies {
  validateRequest: (
    device: unknown,
    format: unknown,
    locale: unknown,
    reportId: unknown,
  ) => {
    device: Device;
    format: 'json' | 'html' | 'pdf';
    locale: 'de-DE' | 'en-US';
    reportId: string;
  };
  assertDevice: (input: unknown) => Device;
  reports: { get: (key: string) => Report | undefined };
  deviceKey: (device: Device) => string;
  showSaveDialog: (options: object) => Promise<{ canceled: boolean; filePath?: string }>;
  createPdfWindow: () => {
    loadURL: (url: string) => Promise<unknown>;
    webContents: { printToPDF: (options: object) => Promise<Uint8Array> };
    isDestroyed: () => boolean;
    destroy: () => void;
  };
  writeFile?: typeof import('node:fs/promises').writeFile;
  renameFile?: typeof import('node:fs/promises').rename;
  removeFile?: typeof import('node:fs/promises').rm;
  generateHTML: (report: Report, locale: 'de-DE' | 'en-US', settings: object) => string;
  getSettings: () => object;
}
export interface QueryLogIpcResults {
  'diagnostics:queryLogAppearance': { locale: 'de-DE' | 'en-US'; theme: string };
  'diagnostics:queryLog': unknown[];
  'diagnostics:queryLogResult': unknown;
  'diagnostics:saveQueryLogResult': { canceled: boolean };
  'diagnostics:clearQueryLog': boolean;
  'diagnostics:exportQueryLog': { canceled: boolean };
}
export interface QueryLogIpcDependencies {
  register: <K extends keyof QueryLogIpcResults>(
    channel: K,
    handler: (...args: unknown[]) => Promise<QueryLogIpcResults[K]>,
  ) => void;
  queryLog: {
    entries: () => unknown[];
    result: (id: unknown) => unknown;
    clear: () => void;
    clearRevision?: () => number;
    exportEntries: (includeRaw: boolean) => unknown[];
  };
  exportIndividual: (
    log: QueryLogIpcDependencies['queryLog'],
    id: unknown,
  ) => { filename: string; body: string } | null;
  getSettings: () => { locale: 'de-DE' | 'en-US'; theme: string };
  getDialogOwner: () => unknown;
  showSaveDialog: (
    owner: unknown,
    options: object,
  ) => Promise<{ canceled: boolean; filePath?: string }>;
  writeFile?: typeof import('node:fs/promises').writeFile;
  renameFile?: typeof import('node:fs/promises').rename;
  removeFile?: typeof import('node:fs/promises').rm;
}
