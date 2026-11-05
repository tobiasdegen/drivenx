import de from '../locales/de-DE.json' with { type: 'json' };
import en from '../locales/en-US.json' with { type: 'json' };

export const labels = {
  'de-DE': { ...de.ui, findings: de.findings },
  'en-US': { ...en.ui, findings: en.findings },
};
export type Locale = keyof typeof labels;
export const DEFAULT_LOCALE: Locale = 'en-US';

/** Map system languages to the two available UI catalogs without storing unsupported variants. */
export function localeForLanguage(language: string | null | undefined): Locale {
  return /^de(?:-|$)/i.test(language?.trim() ?? '') ? 'de-DE' : DEFAULT_LOCALE;
}

export function initialLocale(): Locale {
  const stored = localStorage.getItem('locale');
  if (stored === 'de-DE' || stored === 'en-US') return stored;
  return localeForLanguage(navigator.language);
}
export function findingText(
  f: { code: string; values?: Record<string, number | string>; message?: string },
  locale: Locale,
) {
  const dict = labels[locale].findings as Record<string, string>;
  let s = dict[f.code] || f.message || f.code;
  for (const [k, v] of Object.entries(f.values || {}))
    s = s.replaceAll(`{${k}}`, typeof v === 'number' ? v.toLocaleString(locale) : v);
  return s.replace(/\{([a-zA-Z]+)\}/g, (_, key) =>
    key === 'count' ? translate(locale, 'smartView', 'findingUnambiguous') : '–',
  );
}

/** Shared translated UI strings. Unknown keys are a development error. */
export function translate(
  locale: Locale,
  section:
    | 'deviceDetails'
    | 'diagnosis'
    | 'preferences'
    | 'smartView'
    | 'usbConnection'
    | 'queryLog'
    | 'recommendations'
    | 'readoutMetrics'
    | 'driveProtocol',
  key: string,
): string {
  const catalog = locale === 'de-DE' ? de : en;
  const entry = (catalog[section] as Record<string, string>)[key];
  if (typeof entry !== 'string')
    throw new Error(`Missing translation: ${locale}.${section}.${key}`);
  return entry;
}

/** Interpolate localized text with escaped values for plain React text nodes.
 * React performs HTML escaping at render time; this helper does not emit HTML.
 */
export function translateParams(
  locale: Locale,
  section: 'smartView' | 'usbConnection' | 'queryLog' | 'recommendations' | 'deviceDetails',
  key: string,
  values: Record<string, string | number>,
): string {
  return translate(locale, section, key).replace(
    /\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
    (_, name: string) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : '–',
  );
}

/** Named, readonly translation of a protocol-specific metric / history key. */
export function translateNested(
  locale: Locale,
  section: 'nvmeMetrics' | 'historyMetrics',
  key: string,
  field: 'label' | 'description' = 'label',
): string | undefined {
  const catalog = locale === 'de-DE' ? de : en;
  const row = (catalog[section] as Record<string, string | { label: string; description: string }>)[
    key
  ];
  return typeof row === 'string' ? row : row?.[field];
}
