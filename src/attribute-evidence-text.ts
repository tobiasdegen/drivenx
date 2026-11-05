import { findingText, translate, type Locale } from './i18n.mts';
import type { DiagnosticEvidence } from '../shared/diagnosis-model.mjs';

export function attributeFindingReason(evidence: DiagnosticEvidence, locale: Locale): string {
  const match = /ata_smart_attributes\.(\d+)$/.exec(evidence.source);
  const count = evidence.actualValue;
  const values: Record<string, number | string> = {};
  if (count !== undefined) values.count = count;
  if (match) values.id = Number(match[1]);
  // Raw source may contain a bitmask, not an error counter; use translations
  // for the verified rule instead of guessing meaning from the raw number.
  const translated = findingText({ code: evidence.ruleId, values }, locale);
  return translated === evidence.ruleId
    ? translate(locale, 'smartView', 'attributeDiagnosisReasonUnknown')
    : translated;
}
