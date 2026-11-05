/** Standardized presentation texts live in the shared translation catalogs. */
import de from '../locales/de-DE.json';
import en from '../locales/en-US.json';
import { metricName, metricDescription } from './smart-metrics';
import { translate } from './i18n.mts';

type Entry = {
  de: string;
  en: string;
  helpDe: string;
  helpEn: string;
  interpretDe: string;
  interpretEn: string;
};
function makeEntries(prefix: 'ata' | 'nvme'): Record<string, Entry> {
  const result: Record<string, Entry> = {};
  const deGlossary = de.attributeGlossary as Record<
    string,
    { label: string; description: string; interpretation: string }
  >;
  const enGlossary = en.attributeGlossary as typeof deGlossary;
  for (const key of Object.keys(enGlossary)) {
    if (!key.startsWith(`${prefix}.`)) continue;
    const local = deGlossary[key];
    const source = enGlossary[key];
    if (!local || !source) throw new Error(`Missing attribute translation: ${key}`);
    result[key.slice(prefix.length + 1)] = {
      de: local.label,
      en: source.label,
      helpDe: local.description,
      helpEn: source.description,
      interpretDe: local.interpretation,
      interpretEn: source.interpretation,
    };
  }
  return result;
}
const ATA: Record<string, Entry> = makeEntries('ata');
const NVME: Record<string, Entry> = makeEntries('nvme');
export type AttributeDetails = {
  label: string;
  description: string;
  interpretation: string;
  known: boolean;
  profile: string;
};
export function attributeInfo(
  id: number | string,
  name: string,
  locale: 'de-DE' | 'en-US',
): AttributeDetails {
  const isAta = typeof id === 'number';
  const key = name.split(' / ').at(-1) || name;
  // The glossary is the single source for both table and detail dialog.
  // For NVMe fields not in the glossary, reuse the existing metric catalog.
  // SCSI counters have their own protocol semantics and must not be mistaken for NVMe.
  if (!isAta && name.includes(' / ')) {
    const match = /^(read|write|verify) \/ total_uncorrected_errors$/.exec(name);
    const label = match
      ? (locale === 'de-DE' ? de : en).smartView[
          `scsi${match[1][0].toUpperCase()}${match[1].slice(1)}` as
            'scsiRead' | 'scsiWrite' | 'scsiVerify'
        ]
      : name.replaceAll('_', ' ');
    return {
      label,
      description: match ? translate(locale, 'smartView', 'scsiLifetimeErrors') : '',
      interpretation: (locale === 'de-DE' ? de : en).smartView.scsiCounterExplanation,
      known: Boolean(match),
      profile: 'SCSI / SAS',
    };
  }
  const candidate = isAta ? ATA[id] : NVME[key];
  // Never let an ID-specific description override an unknown vendor name with a different meaning.
  const recognized =
    !isAta ||
    (candidate &&
      (!name ||
        name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .includes(
            (
              {
                5: 'reallocated',
                9: 'poweron',
                12: 'powercycle',
                177: 'wear',
                179: 'rsvd',
                181: 'program',
                182: 'erase',
                187: 'uncorrect',
                188: 'timeout',
                190: 'temperature',
                193: 'load',
                196: 'reallocated',
                197: 'pending',
                198: 'uncorrect',
                199: 'crc',
                241: 'written',
                242: 'read',
              } as Record<number, string>
            )[id] || '',
          )));
  const item = recognized ? candidate : undefined;
  if (!isAta && !item) {
    const label = metricName(key, locale);
    const description = metricDescription(key, locale);
    const generic = (locale === 'de-DE' ? de : en).smartView.nvmeUnclassifiedMetric;
    return {
      label,
      description: description === generic ? '' : description,
      interpretation: (locale === 'de-DE' ? de : en).smartView.attributeInterpretationNote,
      known: description !== generic,
      profile: 'NVMe',
    };
  }
  const profile = isAta ? translate(locale, 'smartView', 'ataRawProfile') : 'NVMe';
  if (!item)
    return {
      label: name.replaceAll('_', ' '),
      description: '',
      interpretation: translate(locale, 'smartView', 'noModelInterpretation'),
      known: false,
      profile,
    };
  return {
    label: isAta ? item[locale === 'de-DE' ? 'de' : 'en'] : metricName(key, locale),
    description: item[locale === 'de-DE' ? 'helpDe' : 'helpEn'],
    interpretation: item[locale === 'de-DE' ? 'interpretDe' : 'interpretEn'],
    known: true,
    profile,
  };
}
