import type { Device } from './types';
import type { Locale, ExportFormat, SelfTestKind, ExportResult } from './ipc-contract';
import type { RequestTracker } from './request-tracker.mjs';

export function exportSelectedReport(options: {
  device: Device;
  format: ExportFormat;
  locale: Locale;
  reportId: string;
  selectedKey: string;
  tracker: RequestTracker;
  exportReport: (
    device: Device,
    format: ExportFormat,
    locale: Locale,
    reportId: string,
  ) => Promise<ExportResult>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}): Promise<void>;

export function runSelectedSelfTest(options: {
  device: Device;
  kind: SelfTestKind;
  reportId: string;
  selectedKey: string;
  tracker: RequestTracker;
  pendingTests: Set<string>;
  scanRunning: () => boolean;
  confirm: () => boolean;
  execute: (device: Device, kind: SelfTestKind, reportId: string) => Promise<unknown>;
  invalidate: (targetKey: string, scanGeneration: number) => void;
  reload: (device: Device) => Promise<void>;
  onRunning: (running: boolean) => void;
  onNotice: () => void;
  onError: (message: string) => void;
  onShowTests: () => void;
}): Promise<void>;
