import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, Search } from 'lucide-react';
import type { SmartctlReport } from '../../smartctl-types';
import type { Health } from '../../types';
import { labels, translate, translateParams, type Locale } from '../../i18n.mts';
import { attributeFindingReason } from '../../attribute-evidence-text';
import { attributeInfo } from '../../attribute-info';
import { buildSmartAttributes, filterSmartAttributes } from '../../smart-attributes';
import {
  attributeRowsWithStatus,
  sortAttributeRows,
  unlinkedEvidence,
} from '../../smart-attribute-status.mjs';
import { formatMetric, formatSmartInteger } from '../../smart-metrics';
import type { DiagnosticEvidence, DiagnosticLevel } from '../../../shared/diagnosis-model.mjs';
import type { SmartAttribute } from './types';
import AttributeDetailsDialog from './AttributeDetailsDialog';
import AtaStatisticsPanel from './AtaStatisticsPanel';

/** Absence of evidence is neutral, not an error and not proof of health. */
function AttributeStatus({ level, locale }: { level: DiagnosticLevel | null; locale: Locale }) {
  if (!level)
    return (
      <span
        className="smart-attribute-no-finding"
        title={translate(locale, 'smartView', 'attributeNoIndividualFinding')}
      >
        –
      </span>
    );
  return (
    <span className={`smart-attribute-status is-${level}`}>
      {level === 'critical' || level === 'defective' ? (
        <AlertCircle size={14} aria-hidden="true" />
      ) : level === 'warning' || level === 'observe' ? (
        <AlertTriangle size={14} aria-hidden="true" />
      ) : null}
      {translate(locale, 'diagnosis', level)}
    </span>
  );
}

export default function AttributesPanel({
  raw,
  health,
  locale,
  attributeMode,
  setAttributeMode,
  query,
  setQuery,
}: {
  raw: SmartctlReport;
  health: Health;
  locale: Locale;
  attributeMode: 'friendly' | 'technical';
  setAttributeMode: (value: 'friendly' | 'technical') => void;
  query: string;
  setQuery: (value: string) => void;
}) {
  const [onlyFindings, setOnlyFindings] = useState(false);
  const [selectedAttribute, setSelectedAttribute] = useState<{
    attribute: SmartAttribute;
    evidence: DiagnosticEvidence[];
    severity: DiagnosticLevel | null;
  } | null>(null);
  const attrs = useMemo(() => buildSmartAttributes(raw), [raw]);
  const rows = useMemo(
    () => attributeRowsWithStatus(attrs, health.diagnosis),
    [attrs, health.diagnosis],
  );
  const highlighted = useMemo(
    () => sortAttributeRows(rows.filter((row) => row.severity && row.severity !== 'ok')),
    [rows],
  );
  const selectedRows = useMemo(
    () => sortAttributeRows(onlyFindings ? highlighted : rows),
    [onlyFindings, highlighted, rows],
  );
  const filtered = useMemo(
    () =>
      filterSmartAttributes(
        selectedRows,
        query,
        locale,
        (row) => `${row.evidence.map((item) => attributeFindingReason(item, locale)).join(' ')}`,
      ),
    [selectedRows, query, locale],
  );
  const unlinked = useMemo(
    () => unlinkedEvidence(rows, health.diagnosis),
    [rows, health.diagnosis],
  );
  const t = labels[locale];
  const tr = (key: string) => translate(locale, 'smartView', key);
  const nvme = raw.nvme_smart_health_information_log;
  const scsi = raw.scsi_error_counter_log;
  const ata = Boolean(raw.ata_smart_attributes?.table);
  const shownAttributes = useMemo(
    () =>
      filtered.map((entry) => ({
        ...entry,
        explanation: attributeInfo(entry.id, entry.name, locale),
      })),
    [filtered, locale],
  );
  return (
    <>
      <section className="panel smart-attribute-panel">
        <div className="table-head">
          <h3>
            {nvme ? tr('nvmeAttributesTitle') : scsi ? tr('scsiAttributesTitle') : t.attributes} (
            {attrs.length})
          </h3>
          <div className="attribute-tools">
            <label className="attribute-switch">
              <input
                type="checkbox"
                checked={attributeMode === 'technical'}
                onChange={(e) => setAttributeMode(e.target.checked ? 'technical' : 'friendly')}
              />
              {tr('technicalNames')}
            </label>
            <label className="search">
              <Search size={15} />
              <input
                placeholder={t.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="smart-attribute-summary" role="status">
          <strong>
            {translateParams(locale, 'smartView', 'attributeFindingsCount', {
              count: highlighted.length,
            })}
          </strong>
          <span>{tr('attributeStatusExplanation')}</span>
          <label className="attribute-switch smart-attribute-only-findings">
            <input
              type="checkbox"
              checked={onlyFindings}
              onChange={(e) => setOnlyFindings(e.target.checked)}
            />
            {tr('attributeOnlyFindings')}
          </label>
        </div>
        {health.diagnosis.assessment !== 'complete' && (
          <p className="smart-attribute-limitation">
            <Info size={15} aria-hidden="true" />
            {tr('attributeLimitedReadout')}
          </p>
        )}
        {unlinked.length > 0 && (
          <p className="smart-attribute-unlinked">
            <Info size={15} aria-hidden="true" />
            {tr('attributeUnlinkedFindings')}
          </p>
        )}
        <div
          className={`table-scroll attribute-table-scroll${filtered.length === 0 ? ' attribute-table-empty' : ''}`}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{tr('metric')}</th>
                <th scope="col" className="smart-attribute-value">
                  {tr('value')}
                </th>
                <th scope="col" className="smart-attribute-assessment">
                  {tr('attributeStatus')}
                </th>
              </tr>
            </thead>
            <tbody>
              {shownAttributes.map((a) => {
                const name = attributeMode === 'technical' ? a.name : a.explanation.label;
                const value = nvme
                  ? formatMetric(a.name, a.raw, locale)
                  : formatSmartInteger(a.raw, locale);
                return (
                  <tr
                    key={`${String(a.id)}-${a.name}-${a.originalIndex}`}
                    className={`smart-attribute-row is-${a.severity ?? 'none'}`}
                  >
                    <td>
                      <div className="smart-attribute-heading">
                        {ata && (
                          <span className="smart-attribute-id mono" aria-label={`SMART ID ${a.id}`}>
                            {a.id}
                          </span>
                        )}
                        <button
                          type="button"
                          className="smart-attribute-name"
                          onClick={() =>
                            setSelectedAttribute({
                              attribute: a,
                              evidence: a.evidence,
                              severity: a.severity,
                            })
                          }
                          aria-label={`${name} – ${tr('explain')}`}
                        >
                          {name}
                        </button>
                      </div>
                      {a.evidence.length > 0 && (
                        <span className="smart-attribute-finding">
                          {attributeFindingReason(a.evidence[0], locale)}
                        </span>
                      )}
                    </td>
                    <td className="mono smart-attribute-value" title={a.raw}>
                      {value}
                    </td>
                    <td className="smart-attribute-assessment">
                      <AttributeStatus level={a.severity} locale={locale} />
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={3}>
                    {onlyFindings && !query.trim() ? tr('attributeNoFindings') : t.noResults}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <AtaStatisticsPanel raw={raw} locale={locale} />
      {selectedAttribute && (
        <AttributeDetailsDialog
          attribute={selectedAttribute.attribute}
          evidence={selectedAttribute.evidence}
          severity={selectedAttribute.severity}
          locale={locale}
          onClose={() => setSelectedAttribute(null)}
        />
      )}
    </>
  );
}
