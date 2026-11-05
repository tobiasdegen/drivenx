import { formatAtaBytes } from '../../shared/diagnostic-metrics.mjs';
import { samsung860Metrics } from '../../shared/ata-ssd-metrics.mjs';
import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Clock3,
  Gauge,
  Info,
  Power,
  Thermometer,
  XCircle,
} from 'lucide-react';
import type { Detail, Device, Finding } from '../types';
import { labels, findingText, translate, type Locale } from '../i18n.mts';
import { temperatureAssessment, operatingTime } from '../drive-helpers';
import { diagnosisAdvice } from '../diagnosis-advice';
import { attributeInfo } from '../attribute-info';
import { overviewMetrics, formatNvmeDataUnits } from '../../shared/overview-metrics.mjs';
import DeviceInformation from './DeviceInformation';
import { extendedMetrics, formatSectors } from '../extended-metrics.mjs';
import { visibleDiagnosisStatus, visibleDiagnosisFindings } from '../../shared/diagnosis-model.mjs';

/** Compact summary inside the Overview tab. Health rules remain in electron/diagnostics/health.js. */
export default function DriveOverview({
  detail,
  device,
  name,
  time,
  locale,
}: {
  detail: Detail;
  device: Device;
  name: string;
  time: string;
  locale: Locale;
}) {
  const [expanded, setExpanded] = useState(false);
  const { raw, health } = detail;
  const t = labels[locale];
  const tr = (key: string) => translate(locale, 'smartView', key);
  // The main process owns normalizing the snapshot; fallback supports older
  // test fixtures and imported reports without the additive IPC field.
  const metrics = detail.metrics ?? overviewMetrics(raw);
  const ataMetrics = metrics.kind === 'ata' ? extendedMetrics(raw, null) : null;
  const wearSources = samsung860Metrics(raw);
  const wearConflict = wearSources?.inconsistent === true;
  const showWear =
    metrics.kind === 'nvme' || (metrics.kind === 'ata' && metrics.wearPercent !== null);
  const readVolume = ataMetrics
    ? formatSectors(ataMetrics.readSectors, ataMetrics.sectorBytes, locale)
    : null;
  const writtenVolume = ataMetrics
    ? (formatSectors(ataMetrics.writtenSectors, ataMetrics.sectorBytes, locale) ??
      formatAtaBytes(metrics.ataWrittenBytes, locale))
    : null;
  const number = (value: number | null) =>
    value === null ? tr('overviewUnavailable') : value.toLocaleString(locale);
  const temp = raw.temperature?.current;
  const temperature = temperatureAssessment(
    temp,
    raw.rotation_rate,
    metrics.kind === 'nvme',
    raw.nvme_composite_temperature_threshold,
  );
  const shownTemp =
    typeof temp === 'number' && temp > 0 && temp <= 150 ? `${temp} °C` : tr('overviewUnavailable');
  const diagnosticStatus = visibleDiagnosisStatus(health);
  const findings = visibleDiagnosisFindings(health).filter((finding) => finding.code !== 'ok');
  const important = findings.filter(
    (finding) => finding.level === 'warnung' || finding.level === 'kritisch',
  );
  const shownFindings = expanded ? findings : findings.slice(0, 3);
  const hasWarnings = important.length > 0;

  const kpi = (label: string, value: string, icon: ReactNode, hint?: string, context?: string) => (
    <div className="overview-kpi" key={label} title={hint}>
      <span className="overview-kpi-label">
        {icon}
        {label}
      </span>
      <strong className="overview-kpi-value">{value}</strong>
      {context && <span className="overview-kpi-context">{context}</span>}
    </div>
  );
  const findingLabel = (finding: Finding) => {
    const original = findingText(finding, locale);
    if (!['vendorRaw', 'packedUnclear', 'unknownRaw'].includes(finding.code)) return original;
    const id = Number(finding.values?.id);
    const source = raw.ata_smart_attributes?.table?.find((item) => item.id === id);
    const label = source ? attributeInfo(id, source.name, locale).label : '';
    return label && label !== source?.name
      ? `${label} (SMART ${id}): ${tr('unknownRaw')}`
      : original;
  };
  const findingIcon = (finding: Finding) =>
    finding.level === 'kritisch' ? (
      <XCircle size={15} />
    ) : finding.level === 'warnung' ? (
      <AlertTriangle size={15} />
    ) : (
      <Info size={15} />
    );

  return (
    <div className="overview-dashboard">
      <div
        className={`overview-kpis overview-kpis--${showWear ? 'four' : 'three'}`}
        aria-label={tr('overviewCoreValues')}
      >
        {kpi(
          t.temp,
          shownTemp,
          <Thermometer size={16} />,
          temperature.level !== 'unknown'
            ? temperature.label[locale]
            : tr('overviewTemperatureHint'),
          typeof raw.nvme_composite_temperature_threshold?.warning === 'number' &&
            raw.nvme_composite_temperature_threshold.warning > 0
            ? `${tr('overviewTemperatureWarningThreshold')}: ${raw.nvme_composite_temperature_threshold.warning} °C`
            : temperature.level !== 'unknown'
              ? temperature.label[locale]
              : undefined,
        )}
        {kpi(
          t.hours,
          metrics.powerOnHours === null
            ? tr('overviewUnavailable')
            : `${number(metrics.powerOnHours)} h`,
          <Clock3 size={16} />,
          operatingTime(metrics.powerOnHours, locale),
          metrics.powerOnHours !== null ? operatingTime(metrics.powerOnHours, locale) : undefined,
        )}
        {kpi(tr('overviewCycles'), number(metrics.powerCycles), <Power size={16} />)}
        {showWear &&
          kpi(
            tr('overviewWear'),
            metrics.wearPercent === null
              ? tr('overviewUnavailable')
              : `${number(metrics.wearPercent)} %`,
            <Gauge size={16} />,
            tr('overviewWearHint'),
            wearConflict
              ? tr('overviewWearConflict')
                  .replace('{reported}', String(wearSources?.reportedUsedPercent))
                  .replace('{inferred}', String(wearSources?.normalizedUsedPercent))
              : tr('overviewWearContext'),
          )}
      </div>

      <section
        className={`panel overview-assessment ${['critical', 'defective', 'kritisch'].includes(diagnosticStatus) ? 'has-critical' : hasWarnings ? 'has-warnings' : ''}`}
        aria-label={tr('overviewFindings')}
      >
        <h3 className="overview-panel-heading">
          {['critical', 'defective', 'warning', 'kritisch', 'warnung'].includes(
            diagnosticStatus,
          ) ? (
            <AlertTriangle size={17} />
          ) : diagnosticStatus === 'unassessable' ? (
            <Info size={17} />
          ) : (
            <CheckCircle2 size={17} />
          )}
          {tr('overviewFindings')}
        </h3>
        {health.diagnosis && (
          <div className="diagnosis-domains">
            <span>
              {translate(locale, 'diagnosis', 'media')}:{' '}
              {translate(locale, 'diagnosis', health.diagnosis.domains.media ?? 'unassessable')}
            </span>
            {health.diagnosis.domains.connection && (
              <span>
                {translate(locale, 'diagnosis', 'connection')}:{' '}
                {translate(locale, 'diagnosis', health.diagnosis.domains.connection)}
              </span>
            )}
            {health.diagnosis.domains.thermal && (
              <span>
                {translate(locale, 'diagnosis', 'thermal')}:{' '}
                {translate(locale, 'diagnosis', health.diagnosis.domains.thermal)}
              </span>
            )}
          </div>
        )}
        {findings.length > 0 ? (
          <ul className="overview-finding-list">
            {shownFindings.map((finding, index) => (
              <li key={`${finding.code}-${index}`} className={`finding-${finding.level}`}>
                {findingIcon(finding)}
                <span className="overview-finding-copy">
                  {(() => {
                    const message = findingLabel(finding);
                    const divider = message.indexOf(':');
                    return divider > 4 && divider < 65 ? (
                      <>
                        <strong>{message.slice(0, divider)}</strong>
                        <span>{message.slice(divider + 1).trim()}</span>
                      </>
                    ) : (
                      <span>{message}</span>
                    );
                  })()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="overview-assessment-result">
            {diagnosticStatus === 'ok'
              ? tr('overviewNoFindings')
              : tr('overviewNoReliableAssessment')}
          </p>
        )}
        {findings.length > 3 && (
          <button
            type="button"
            className="overview-more-button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? tr('overviewShowLess')
              : tr('overviewShowMore').replace('{count}', String(findings.length - 3))}
          </button>
        )}
        <div className="overview-advice">
          <strong>{tr('recommendation')}</strong>
          <p>{diagnosisAdvice(health, locale)}</p>
        </div>
      </section>

      <div
        className={`overview-content-grid${metrics.kind !== 'nvme' && !readVolume && !writtenVolume && metrics.errorCounters.length === 0 ? ' overview-content-grid--single' : ''}`}
      >
        <DeviceInformation
          device={device}
          raw={raw}
          name={name}
          time={time}
          locale={locale}
          compact
        />
        <div className="overview-side-panels">
          {(metrics.kind === 'nvme' || readVolume || writtenVolume) && (
            <section className="panel overview-io-panel" aria-label={tr('overviewLifetime')}>
              <h3 className="overview-panel-heading">{tr('overviewLifetime')}</h3>
              <div className="overview-io-grid">
                <div title={tr('overviewNvmeDataHint')}>
                  <span>
                    <ArrowUpFromLine size={15} />
                    {tr('overviewRead')}
                  </span>
                  <strong>
                    {metrics.kind === 'nvme'
                      ? formatNvmeDataUnits(metrics.readUnits, locale)
                      : readVolume || '–'}
                  </strong>
                </div>
                <div title={tr('overviewNvmeDataHint')}>
                  <span>
                    <ArrowDownToLine size={15} />
                    {tr('overviewWritten')}
                  </span>
                  <strong>
                    {metrics.kind === 'nvme'
                      ? formatNvmeDataUnits(metrics.writtenUnits, locale)
                      : writtenVolume || '–'}
                  </strong>
                </div>
              </div>
            </section>
          )}
          {metrics.errorCounters.length > 0 && (
            <section className="panel overview-counters-panel" aria-label={tr('overviewCounters')}>
              <h3 className="overview-panel-heading">{tr('overviewCounters')}</h3>
              <dl className="overview-counter-list">
                {metrics.errorCounters.map((counter) => (
                  <div
                    key={counter.key}
                    title={
                      counter.informational
                        ? tr('overviewHistoricalCounter')
                        : counter.raw
                          ? tr('overviewVendorRaw')
                          : undefined
                    }
                  >
                    <dt>{tr('overview_' + counter.key)}</dt>
                    <dd
                      title={counter.value === null ? tr('overviewUnavailable') : undefined}
                      aria-label={counter.value === null ? tr('overviewUnavailable') : undefined}
                    >
                      {counter.value === null
                        ? '–'
                        : `${number(counter.value)}${counter.unit ? ' ' + counter.unit : ''}`}
                    </dd>
                  </div>
                ))}
              </dl>
              {metrics.errorCounters.some((counter) => counter.informational) && (
                <p className="overview-counter-note">{tr('overviewHistoricalCounter')}</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
