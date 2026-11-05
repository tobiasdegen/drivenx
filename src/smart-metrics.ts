import { formatNvmeDataUnits } from '../shared/overview-metrics.mjs';
import { translateNested, translate, type Locale } from './i18n.mts';
export const metricName = (name: string, locale: Locale) =>
  translateNested(locale, 'nvmeMetrics', name, 'label') ||
  (name.match(/^temperature_sensor_(\d+)$/)
    ? `${translate(locale, 'smartView', 'nvmeTemperatureSensor')} ${name.match(/\d+$/)?.[0]}`
    : name.replaceAll('_', ' '));
export const metricDescription = (name: string, locale: Locale) =>
  translateNested(locale, 'nvmeMetrics', name, 'description') ||
  translate(locale, 'smartView', 'nvmeUnclassifiedMetric');
/** Only format unambiguous decimal integers. Keep packed ATA/raw vendor formats intact.
 * Avoid Number() conversions because SMART counters can exceed MAX_SAFE_INTEGER. */
export function formatSmartInteger(value: string, locale: Locale): string {
  if (!/^(?:0|[1-9]\d*)$/.test(value) || value.length < 4) return value;
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, locale === 'de-DE' ? '.' : ',');
}
export const formatMetric = (name: string, value: unknown, locale: Locale) => {
  if (name === 'data_units_read' || name === 'data_units_written')
    return formatNvmeDataUnits(value, locale);
  const displayValue =
    typeof value === 'number' && Number.isFinite(value)
      ? value.toLocaleString(locale)
      : typeof value === 'string' && /^\d{4,}$/.test(value)
        ? formatSmartInteger(value, locale)
        : String(value ?? '–');
  return (
    displayValue +
    (['available_spare', 'available_spare_threshold', 'percentage_used'].includes(name)
      ? ' %'
      : ['temperature', 'composite_temperature_warning', 'composite_temperature_critical'].includes(
            name,
          ) || name.startsWith('temperature_sensor_')
        ? ' °C'
        : name === 'controller_busy_time'
          ? ' min'
          : '')
  );
};
