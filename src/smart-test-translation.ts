import de from '../locales/de-DE.json';
import en from '../locales/en-US.json';
import type { Locale } from './i18n.mts';

export function translateTest(
  value: unknown,
  locale: Locale,
  field: 'type' | 'status' = 'status',
): string {
  const raw =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && 'string' in value && typeof value.string === 'string'
        ? value.string
        : '';
  if (!raw) return '–';
  const text = raw.toLowerCase();
  let key = '';
  if (field === 'type') {
    if (/extended|long/.test(text)) key = 'extended';
    else if (/short/.test(text)) key = 'short';
    else if (/conveyance/.test(text)) key = 'conveyance';
    else if (/selective/.test(text)) key = 'selective';
    return key
      ? (locale === 'de-DE' ? de : en).smartTest.types[key as keyof typeof de.smartTest.types]
      : raw;
  }
  if (/read failure|read test element/.test(text)) key = 'readFailure';
  else if (/completed without error|completed successfully/.test(text)) key = 'completed';
  else if (/aborted/.test(text)) key = 'aborted';
  else if (/interrupted/.test(text)) key = 'interrupted';
  else if (/in progress/.test(text)) key = 'inProgress';
  return key
    ? (locale === 'de-DE' ? de : en).smartTest.statuses[key as keyof typeof de.smartTest.statuses]
    : raw;
}
