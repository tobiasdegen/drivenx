import type { SmartctlReport } from './smartctl-types';
export type ExtendedMetrics = {
  readSectors: number | null;
  writtenSectors: number | null;
  sectorBytes: number | null;
  uncorrectable: number | null;
  commandResets: number | null;
  hardwareResets: number | null;
  interfaceCrc: number | null;
  phyLinkTransitions: number | null;
  phyComresets: number | null;
  maxTemperature: number | null;
  minTemperature: number | null;
  wearExtended: number | null;
  wearStandard: number | null;
  wearDifferent: boolean;
  extendedErrorCount: number | null;
  extendedSelfTestCount: number | null;
  extendedSelfTestErrors: number | null;
};
export function extendedMetrics(
  extended: SmartctlReport | null,
  standard: SmartctlReport | null,
): ExtendedMetrics | null;
export function formatSectors(
  sectors: number | null,
  sectorBytes: number | null,
  locale?: 'de-DE' | 'en-US',
): string | null;
