import type { SmartctlReport } from '../src/smartctl-types';
export type OverviewCounter = {
  key: string;
  value: number | null;
  informational?: boolean;
  unit?: string;
  raw?: string;
};
export type OverviewData = {
  kind: 'nvme' | 'ata' | 'scsi' | 'unknown';
  powerCycles: number | null;
  powerOnHours: number | null;
  wearPercent: number | null;
  ataWrittenBytes: string | null;
  ataWearSource: 'smartctl-endurance' | 'samsung-860-normalized-177' | null;
  readUnits: number | null;
  writtenUnits: number | null;
  readCommands: number | null;
  writeCommands: number | null;
  errorCounters: OverviewCounter[];
};
export function overviewMetrics(raw: SmartctlReport | null | undefined): OverviewData;
export function safeCounter(value: unknown): number | null;
export function plainAtaCounter(attribute: unknown): number | null;
export function formatNvmeDataUnits(value: unknown, locale?: 'de-DE' | 'en-US'): string;
