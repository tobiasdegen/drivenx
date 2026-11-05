import type { Health } from './types';
import { translate, type Locale } from './i18n.mts';
import { recommendationPlan } from '../shared/recommendation-rules.mjs';

/** User advice uses the same assessment plan as the PDF, with a shorter message. */
export function diagnosisAdvice(health: Health, locale: Locale): string {
  const key = recommendationPlan(health).primary;
  return translate(locale, 'recommendations', 'ui' + key[0].toUpperCase() + key.slice(1));
}
