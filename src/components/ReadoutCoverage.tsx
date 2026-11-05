import { Info } from 'lucide-react';
import type { Health } from '../types';
import type { SmartctlReport } from '../smartctl-types';
import { translate, type Locale } from '../i18n.mts';
import deReadout from '../../locales/de-DE.json';
import enReadout from '../../locales/en-US.json';

/** One source of truth for readout completeness. Optional log failures are not media alarms. */
export default function ReadoutCoverage({
  health,
  raw,
  locale,
}: {
  health: Health;
  raw: SmartctlReport;
  locale: Locale;
}) {
  const t = (key: string) => translate(locale, 'smartView', key);
  const coverage = health.diagnosis.coverage;
  const completeCore = health.diagnosis.assessment === 'complete';
  const full = completeCore && health.readout.status === 'vollstaendig';
  const localized = (key: string) => {
    const label = (
      (locale === 'de-DE' ? deReadout : enReadout).readoutMetrics as Record<string, string>
    )[key];
    if (label) return label;
    if (/^ata\.smart\.\d+$/.test(key)) return `SMART ${key.split('.').at(-1)}`;
    return key;
  };
  const blockingReadoutIssue = health.readout.issues.some((issue) =>
    ['permissionDenied', 'commandFailure', 'deviceOpenFailure'].includes(issue.code),
  );
  const failedOptional = completeCore && !full && !blockingReadoutIssue;
  const nvmeLogUnavailable =
    health.diagnosis.protocol === 'nvme' &&
    raw.smartctl?.messages?.some(
      (item) =>
        typeof item.string === 'string' &&
        /getlogpage failed|error information log failed|error log.*unavailable/i.test(item.string),
    );
  return (
    <details
      className={`readout-coverage ${completeCore && !blockingReadoutIssue ? 'is-informational' : 'is-incomplete'}`}
    >
      <summary>
        <Info size={14} aria-hidden="true" />
        {full
          ? t('coverageComplete')
          : failedOptional
            ? nvmeLogUnavailable
              ? t('coverageNvmeErrorLog')
              : t('coverageOptional')
            : t('coverageIncomplete')}
      </summary>
      <div className="readout-coverage-content">
        <p>
          {full
            ? t('coverageCompleteHelp')
            : failedOptional
              ? t('coverageOptionalHelp')
              : t('coverageIncompleteHelp')}
        </p>
        <p>
          {t('coverageAvailable')}: {coverage.available.length} · {t('coverageMissing')}:{' '}
          {coverage.missing.length}
        </p>
        {coverage.missing.length > 0 && (
          <ul>
            {coverage.missing.map((key) => (
              <li key={key}>{localized(key)}</li>
            ))}
          </ul>
        )}
        {health.readout.issues.length > 0 && (
          <p>
            {t('coverageReadoutIssues')}:{' '}
            {health.readout.issues
              .map((issue) => translate(locale, 'smartView', `coverageIssue_${issue.code}`))
              .join(', ')}
          </p>
        )}
      </div>
    </details>
  );
}
