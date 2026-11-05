import { translate, translateParams, type Locale } from './i18n.mts';
export type DisplayLanguage = Locale;
/** Calendar-independent durations; operating hours are not calendar age. */
export function operatingTime(hours: unknown, lang: DisplayLanguage): string {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0)
    return translate(lang, 'smartView', 'autoUnavailable');
  const days = Math.floor(hours / 24);
  const years = Math.floor(days / 365);
  const remainderDays = days % 365;
  const remHours = Math.floor(hours % 24);
  return translateParams(lang, 'smartView', 'operatingTimeSummary', {
    years,
    days: remainderDays,
    hours: remHours,
    yearsUnit: translate(lang, 'smartView', years === 1 ? 'timeYear' : 'timeYears'),
    daysUnit: translate(lang, 'smartView', remainderDays === 1 ? 'timeDay' : 'timeDays'),
    hoursUnit: translate(lang, 'smartView', remHours === 1 ? 'timeHour' : 'timeHours'),
  });
}
export type TemperatureLevel = 'unknown' | 'low' | 'normal' | 'elevated' | 'high';
/** General orientation ONLY. Never supersedes device-specific thermal limits or SMART health. */
export function temperatureAssessment(
  value: unknown,
  rpm: unknown,
  isNvme: boolean,
  limits?: { warning?: number; critical?: number },
): { level: TemperatureLevel; label: Record<DisplayLanguage, string> } {
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 150)
    return {
      level: 'unknown',
      label: {
        'de-DE': translate('de-DE', 'smartView', 'autoUnavailable'),
        'en-US': translate('en-US', 'smartView', 'autoUnavailable'),
      },
    };
  // broad pragmatic bands, not validated per drive model. NVMe controllers often tolerate higher temperatures.
  const isHdd = typeof rpm === 'number' && rpm > 0;
  const low = n < 10 && isHdd;
  const elevatedAt = isHdd ? 45 : isNvme ? 60 : 50;
  const highAt = isHdd ? 55 : isNvme ? 70 : 65;
  const supportedWarning = limits?.warning;
  const supportedCritical = limits?.critical;
  const thresholdsValid =
    isNvme &&
    Number.isFinite(supportedWarning) &&
    Number.isFinite(supportedCritical) &&
    (supportedWarning as number) > 0 &&
    (supportedCritical as number) > (supportedWarning as number);
  const effectiveElevated = thresholdsValid ? supportedWarning! : elevatedAt;
  const effectiveHigh = thresholdsValid ? supportedCritical! : highAt;
  const level: TemperatureLevel = low
    ? 'low'
    : n >= effectiveHigh
      ? 'high'
      : n >= effectiveElevated
        ? 'elevated'
        : 'normal';
  const labelKey = {
    normal: 'tempTypical',
    elevated: 'tempElevated',
    high: 'tempHigh',
    low: 'tempLow',
  }[level];
  const labels = {
    'de-DE': translate('de-DE', 'smartView', labelKey),
    'en-US': translate('en-US', 'smartView', labelKey),
  };
  return { level, label: labels };
}
