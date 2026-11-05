import type { Device, Detail } from './types';
import type { RequestTracker } from './request-tracker.mjs';
import type { DiagnosticsBridge, ScanResult } from './ipc-contract';

export function scanWarnings(messages: unknown): string[];
export function chooseScannedDevice(
  devices: Device[],
  selectedKey: string,
  previousName: string | undefined,
): Device | undefined;

export function scheduleScanFollowups(options: {
  result: ScanResult;
  epoch: number;
  tracker: RequestTracker;
  api: Pick<DiagnosticsBridge, 'scanMetadata' | 'scanAliases'>;
  deviceRef: { current: Device[] };
  aliasGroupsRef: { current: Pick<Device, 'name' | 'type'>[][] };
  selectedRef: { current: string };
  onDevices(devices: Device[]): void;
  onNotice(message: string): void;
}): Promise<void>;

export function startBackgroundReads(options: {
  devices: Device[];
  selectedKey: string;
  epoch: number;
  tracker: RequestTracker;
  // Background reads only request a device. They never send the optional
  // `fresh` flag used by the full IPC bridge / explicit refresh path.
  api: { detail(device: Device): Promise<Detail> };
  isDeviceCurrent?: (key: string) => boolean;
  onDetail(key: string, detail: Detail): void;
  onError(key: string): void;
}): Promise<void[]>;
