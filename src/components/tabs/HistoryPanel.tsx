import { plausibilityHints } from '../../drive-plausibility.mjs';
import { analyzeHistory } from '../../history-intelligence.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createAsyncViewGuard } from '../../async-view-guard.mjs';
import type { Device, HistoryRecord } from '../../types';
import { translate, translateNested, type Locale } from '../../i18n.mts';
import {
  formatHistoryMetricValue,
  formatHistoryMetricDifference,
} from '../../../shared/diagnostic-metrics.mjs';
import { assessmentLabel } from '../../drive-protocol';
import HistoryChart from '../HistoryChart';
import { buildHistoryTrends, historyMetricKeys, type HistoryTrend } from '../../history-trends.mjs';

function isDataVolume(key: string): boolean {
  return key === 'nvmeReadUnits' || key === 'nvmeWrittenUnits' || key === 'ataWrittenBytes';
}
function formatValue(key: string, value: number | null | undefined, locale: Locale): string {
  return formatHistoryMetricValue(key, value, locale);
}

function formatChange(trend: HistoryTrend, locale: Locale, resetLabel: string): string {
  if (trend.reset) return resetLabel;
  const unit = !isDataVolume(trend.key) && trend.unit ? ` ${trend.unit}` : '';
  return `${formatHistoryMetricDifference(trend.key, trend.difference, locale)}${unit}`;
}

/** History data belongs to this tab, not to the navigation component. */
export default function HistoryPanel({
  active,
  reportId,
  locale,
}: {
  active: Device;
  reportId: string;
  locale: Locale;
}) {
  const tr = (key: string) => translate(locale, 'smartView', key);
  const [historyRows, setHistoryRows] = useState<HistoryRecord[]>([]);
  const [historyAvailable, setHistoryAvailable] = useState(false);
  const [backupAvailable, setBackupAvailable] = useState(false);
  const [backupWarning, setBackupWarning] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [savingHistory, setSavingHistory] = useState(false);
  const [importingHistory, setImportingHistory] = useState(false);
  const [exportingHistory, setExportingHistory] = useState(false);
  // All history operations belong to one device/report view. An action cannot
  // overtake another action (or its initial read), even on a double-click.
  const requests = useRef(createAsyncViewGuard());
  useEffect(() => {
    const guard = requests.current;
    guard.invalidate();
    const ticket = guard.begin('load');
    setHistoryRows([]);
    setHistoryAvailable(false);
    setBackupAvailable(false);
    setBackupWarning(false);
    setRestorePending(false);
    setHistoryLoading(true);
    setHistoryError('');
    setSavingHistory(false);
    setImportingHistory(false);
    setExportingHistory(false);
    void window.diagnostics
      .history(active, reportId)
      .then((result) => {
        if (guard.isCurrent(ticket)) {
          setHistoryRows(result.records);
          setHistoryAvailable(result.available);
          setBackupAvailable(result.backupAvailable === true);
          setBackupWarning(result.backupWarning === true);
        }
      })
      .catch((error) => {
        if (guard.isCurrent(ticket)) setHistoryError(String(error));
      })
      .finally(() => {
        if (guard.isCurrent(ticket)) setHistoryLoading(false);
        guard.finish(ticket);
      });
    return () => guard.invalidate();
  }, [active.name, active.type, reportId]);

  async function saveMeasurement() {
    if (!historyAvailable || historyLoading) return;
    const guard = requests.current;
    const ticket = guard.begin('save', { exclusive: true });
    if (!ticket) return;
    setSavingHistory(true);
    setHistoryError('');
    try {
      const rows = await window.diagnostics.saveHistory(active, reportId);
      if (guard.isCurrent(ticket)) {
        setHistoryRows(rows);
        const response = await window.diagnostics.history(active, reportId);
        if (guard.isCurrent(ticket)) {
          setBackupAvailable(response.backupAvailable === true);
          setBackupWarning(response.backupWarning === true);
        }
      }
    } catch (error) {
      if (guard.isCurrent(ticket)) setHistoryError(String(error));
    } finally {
      if (guard.isCurrent(ticket)) setSavingHistory(false);
      guard.finish(ticket);
    }
  }

  async function importMeasurements() {
    if (!historyAvailable || historyLoading) return;
    const guard = requests.current;
    const ticket = guard.begin('import', { exclusive: true });
    if (!ticket) return;
    setImportingHistory(true);
    setHistoryError('');
    try {
      const response = await window.diagnostics.importHistory(active, reportId);
      if (guard.isCurrent(ticket) && !response.canceled && response.records) {
        setHistoryRows(response.records);
        setHistoryError('');
      }
    } catch (error) {
      if (guard.isCurrent(ticket)) setHistoryError(String(error));
    } finally {
      if (guard.isCurrent(ticket)) setImportingHistory(false);
      guard.finish(ticket);
    }
  }

  async function restoreLocal() {
    if (!historyAvailable || historyLoading || !backupAvailable || !restorePending) return;
    const guard = requests.current;
    const ticket = guard.begin('restore', { exclusive: true });
    if (!ticket) return;
    setImportingHistory(true);
    setRestorePending(false);
    setHistoryError('');
    try {
      const response = await window.diagnostics.restoreLocalHistory(active, reportId);
      if (guard.isCurrent(ticket)) setHistoryRows(response.records);
    } catch (error) {
      if (guard.isCurrent(ticket)) setHistoryError(String(error));
    } finally {
      if (guard.isCurrent(ticket)) setImportingHistory(false);
      guard.finish(ticket);
    }
  }

  async function exportMeasurements() {
    if (!historyAvailable || historyLoading) return;
    const guard = requests.current;
    const ticket = guard.begin('export', { exclusive: true });
    if (!ticket) return;
    setExportingHistory(true);
    setHistoryError('');
    try {
      await window.diagnostics.exportHistory(active, reportId);
    } catch (error) {
      if (guard.isCurrent(ticket)) setHistoryError(String(error));
    } finally {
      if (guard.isCurrent(ticket)) setExportingHistory(false);
      guard.finish(ticket);
    }
  }
  const metricLabel = (key: string) => translateNested(locale, 'historyMetrics', key);
  // History is immutable between loads/imports/saves. Button/loading/error
  // changes must not re-sort and re-analyze the entire measurement series.
  const trend = useMemo(() => buildHistoryTrends(historyRows), [historyRows]);
  const plausibility = useMemo(() => plausibilityHints(historyRows), [historyRows]);
  const intelligence = useMemo(
    () =>
      analyzeHistory(historyRows)
        .filter(
          (item) =>
            item.current > 0 || (item.delta !== null && item.delta !== 0) || item.resets > 0,
        )
        .sort((a, b) => {
          const order: Record<string, number> = {
            increased: 0,
            reset: 1,
            decreased: 2,
            previousIncrease: 3,
            unchanged: 4,
            insufficient: 5,
          };
          return (order[a.trend] ?? 9) - (order[b.trend] ?? 9);
        })
        .slice(0, 8),
    [historyRows],
  );
  const metricKeys = useMemo(() => historyMetricKeys(historyRows), [historyRows]);
  const historyBusy = historyLoading || savingHistory || importingHistory || exportingHistory;
  return (
    <section className="panel history-panel">
      <div className="table-head">
        <h3>{tr('measurementHistory')}</h3>
        <div className="header-actions">
          <button
            className="button secondary"
            disabled={!historyAvailable || historyBusy}
            onClick={() => void exportMeasurements()}
          >
            {exportingHistory ? tr('historyExporting') : tr('historyExport')}
          </button>
          <button
            className="button secondary"
            disabled={!historyAvailable || historyBusy}
            onClick={() => void importMeasurements()}
          >
            {tr('historyImport')}
          </button>
          {backupAvailable && (
            <button
              className="button secondary"
              disabled={historyBusy || !historyAvailable}
              onClick={() => {
                if (restorePending) void restoreLocal();
                else setRestorePending(true);
              }}
            >
              {restorePending ? tr('historyRestoreConfirmAction') : tr('historyRestoreLocal')}
            </button>
          )}
          {restorePending && (
            <button className="button secondary" onClick={() => setRestorePending(false)}>
              ×
            </button>
          )}
          <button
            className="button secondary"
            disabled={historyBusy || !historyAvailable}
            onClick={() => void saveMeasurement()}
          >
            {savingHistory ? tr('historySaving') : tr('historySave')}
          </button>
        </div>
      </div>
      <p className="panel-description">{tr('historyDescription')}</p>
      {historyError && <p className="history-error">{historyError}</p>}
      {backupWarning && <p className="history-error">{tr('historyBackupDamaged')}</p>}
      {restorePending && <p className="history-note">{tr('historyRestoreConfirmNote')}</p>}
      {historyLoading && <p className="panel-description">{tr('historyLoading')}</p>}
      {!historyLoading && !historyAvailable && <p>{tr('historyIdentityMissing')}</p>}
      {historyAvailable && !historyLoading && historyRows.length === 0 && (
        <p className="panel-description">{tr('historyEmpty')}</p>
      )}
      {historyRows.length > 0 && (
        <>
          {plausibility.length > 0 && (
            <div className="history-plausibility">
              <h4>{tr('plausibilityTitle')}</h4>
              <p className="history-note">{tr('plausibilityNote')}</p>
              <ul>
                {plausibility.map((hint, index) => (
                  <li key={`${hint.code}-${index}`}>
                    {tr(`plausibility_${hint.code}`)}
                    {'metric' in hint && typeof hint.metric === 'string'
                      ? `: ${metricLabel(hint.metric)}`
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {intelligence.length > 0 && (
            <div className="history-trends">
              <h4>{tr('historyInsightTitle')}</h4>
              <p className="history-note">{tr('historyInsightNote')}</p>
              <div className="history-trend-grid">
                {intelligence.map((item) => (
                  <div className="history-trend-card" key={item.key}>
                    <span>{metricLabel(item.key)}</span>
                    <strong className={item.trend === 'reset' ? 'history-reset' : ''}>
                      {tr(`historyTrend_${item.trend}`)}
                    </strong>
                    <small>
                      {formatValue(item.key, item.baseline, locale)} →{' '}
                      {formatValue(item.key, item.current, locale)}
                    </small>
                    <small>{tr('historySamples').replace('{count}', String(item.samples))}</small>
                    {item.stableDays !== null && item.stableDays > 0 && (
                      <small>
                        {tr('historyStableDays').replace('{days}', String(item.stableDays))}
                      </small>
                    )}
                    {item.action && <small>{tr(`historyAction_${item.action}`)}</small>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <HistoryChart records={historyRows} locale={locale} />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{tr('historyCaptured')}</th>
                  <th>{tr('historyAssessment')}</th>
                  {metricKeys.map((key) => (
                    <th key={key}>{metricLabel(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {historyRows.map((entry, i) => (
                  <tr key={`${entry.capturedAt}-${i}`}>
                    <td>{new Date(entry.capturedAt).toLocaleString(locale)}</td>
                    <td>{assessmentLabel(entry.status, locale)}</td>
                    {metricKeys.map((key) => (
                      <td key={key}>{formatValue(key, entry.metrics[key], locale)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {trend.length > 0 && (
            <div className="history-trends">
              <h4>{tr('historyChanges')}</h4>
              <div className="history-trend-grid">
                {trend.map((item) => (
                  <div className="history-trend-card" key={item.key}>
                    <span>{metricLabel(item.key)}</span>
                    <strong className={item.reset ? 'history-reset' : ''}>
                      {formatChange(item, locale, tr('historyReset'))}
                    </strong>
                    <small>
                      {formatValue(item.key, item.before, locale)} →{' '}
                      {formatValue(item.key, item.after, locale)}
                    </small>
                    {item.lastChangedAt && (
                      <small>
                        {tr('historyLastChange')}:{' '}
                        {new Date(item.lastChangedAt).toLocaleString(locale)}
                      </small>
                    )}
                  </div>
                ))}
              </div>
              <p className="history-note">{tr('historyNote')}</p>
            </div>
          )}
          {historyRows.length >= 2 && (
            <p className="history-note history-note-secondary">{tr('historyRawNote')}</p>
          )}
        </>
      )}
    </section>
  );
}
