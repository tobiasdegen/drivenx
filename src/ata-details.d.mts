import type { SmartctlReport } from './smartctl-types';
export type StatisticGroup = {
  number: number;
  name: string;
  rows: {
    offset: number;
    name: string;
    value: number | null;
    valid: boolean;
    monitored: boolean;
    normalized: boolean;
  }[];
};
export type PhyEvent = { id: number; name: string; value: number | null; overflow: boolean };
export type LogEntry = {
  address: number;
  name: string;
  read: boolean;
  write: boolean;
  gpSectors: number | null;
  smartSectors: number | null;
};
export type TemperatureHistory = {
  values: (number | null)[];
  index: number | null;
  slots: number | null;
  sampleMinutes: number | null;
  logMinutes: number | null;
  missing: number;
};
export function statistics(raw: SmartctlReport): StatisticGroup[];
export function phyEvents(raw: SmartctlReport): PhyEvent[];
export function logDirectory(raw: SmartctlReport): LogEntry[];
export function temperatureHistory(raw: SmartctlReport): TemperatureHistory | null;
export type TemperatureBand = { min: number; max: number; label: string; count: number };
export type SelectiveSpan = { lba_min?: number; lba_max?: number; status?: { string?: string } };
export function configuredSelectiveSpans(raw: SmartctlReport): SelectiveSpan[];
export function temperatureBands(history: TemperatureHistory | null): TemperatureBand[];
