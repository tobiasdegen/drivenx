import type { SmartctlReport } from './smartctl-types';
import { display } from './drive-display';
import { attributeInfo } from './attribute-info';
import type { Locale } from './i18n.mts';

export type SmartAttribute = {
  id: number | string;
  name: string;
  current?: number | string;
  worst?: number | string;
  threshold?: number | string;
  raw: string;
};

/** Transform the protocol-specific smartctl fields into the shared attribute table. */
export function buildSmartAttributes(raw: SmartctlReport | null | undefined): SmartAttribute[] {
  if (!raw) return [];

  const ata = raw.ata_smart_attributes?.table;
  if (Array.isArray(ata)) {
    return ata.map((entry) => ({
      id: entry.id,
      name: entry.name,
      current: entry.value,
      worst: entry.worst,
      threshold: entry.thresh,
      raw: display(entry.raw?.string ?? entry.raw?.value),
    }));
  }

  const nvme = raw.nvme_smart_health_information_log;
  if (nvme) {
    const base = Object.entries(nvme).flatMap(([name, value]) => {
      // An NVMe temperature sensor array is a collection of individual °C
      // measurements, not a comma-separated opaque string or a single sensor.
      if (name === 'temperature_sensors' && Array.isArray(value))
        return value.flatMap((temperature, index) =>
          typeof temperature === 'number' && Number.isFinite(temperature) && temperature !== 0
            ? [simpleAttribute(`temperature_sensor_${index + 1}`, temperature)]
            : [],
        );
      // nsid=-1 and opaque objects are protocol internals, not health metrics.
      if (name === 'nsid' || value === null || typeof value === 'object') return [];
      return [simpleAttribute(name, value)];
    });
    const threshold = raw.nvme_composite_temperature_threshold;
    if (typeof threshold?.warning === 'number')
      base.push(simpleAttribute('composite_temperature_warning', threshold.warning));
    if (typeof threshold?.critical === 'number')
      base.push(simpleAttribute('composite_temperature_critical', threshold.critical));
    return base;
  }

  const scsi = raw.scsi_error_counter_log;
  if (!scsi) return [];
  return Object.entries(scsi).flatMap(([groupName, counters]) => {
    if (!counters || typeof counters !== 'object') return [];
    return Object.entries(counters).map(([key, value]) =>
      simpleAttribute(`${groupName} / ${key}`, value),
    );
  });
}

function simpleAttribute(name: string, value: unknown): SmartAttribute {
  return {
    id: '–',
    name,
    current: '–',
    worst: '–',
    threshold: '–',
    raw: display(value),
  };
}

export function filterSmartAttributes<T extends SmartAttribute>(
  attributes: T[],
  query: string,
  locale: Locale,
  extraSearchText?: (entry: T) => string,
): T[] {
  const search = query.trim().toLowerCase();
  if (!search) return attributes;
  return attributes.filter((entry) => {
    const information = attributeInfo(entry.id, entry.name, locale);
    return `${entry.id} ${entry.name} ${information.label} ${information.description} ${information.interpretation} ${entry.raw} ${extraSearchText?.(entry) ?? ''}`
      .toLowerCase()
      .includes(search);
  });
}
