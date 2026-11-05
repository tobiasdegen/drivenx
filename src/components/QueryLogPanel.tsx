import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Trash2,
  RefreshCw,
  Search,
  Copy,
  Eye,
  X,
  WrapText,
  AlignLeft,
} from 'lucide-react';
import type { QueryLogEntry, QueryResult } from '../ipc-contract';
import { translate, translateParams, type Locale } from '../i18n.mts';
import { createCoalescedRefresh } from '../coalesced-refresh.mjs';

const descriptionKeys: Record<QueryLogEntry['mode'], string> = {
  'scan-open': 'modeScanOpen',
  scan: 'modeScan',
  version: 'modeVersion',
  'self-test': 'modeSelfTest',
  extended: 'modeExtended',
  standard: 'modeStandard',
  identify: 'modeIdentify',
  other: 'modeOther',
  'windows-inventory': 'modeWindowsInventory',
  'windows-privilege': 'modeWindowsPrivilege',
  'diskutil-list': 'modeDiskutilList',
  'diskutil-list-text': 'modeDiskutilListText',
  'diskutil-info': 'modeDiskutilInfo',
  'ioreg-usb': 'modeIoregUsb',
  'mac-host-io': 'modeMacHostIo',
  'system-profiler-usb': 'modeSystemProfilerUsb',
};
/** smartctl reports independent process failures and historical SMART evidence in one bitmask. */
function exitHint(code: number | null, locale: Locale): string | null {
  if (code === null || code === 0) return null;
  const keys: [number, string][] = [
    [1, 'exitInvalidInvocation'],
    [2, 'exitDeviceOpen'],
    [4, 'exitCommandFailed'],
    [8, 'exitSmartOverall'],
    [16, 'exitPrefail'],
    [32, 'exitHistoricalThreshold'],
    [64, 'exitLogRecords'],
    [128, 'exitSelfTestErrors'],
  ];
  return (
    keys
      .filter(([bit]) => (code & bit) !== 0)
      .map(([, key]) => translate(locale, 'queryLog', key))
      .join(' · ') || null
  );
}

export default function QueryLogPanel({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<QueryLogEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [includeRaw, setIncludeRaw] = useState(false);
  const [opened, setOpened] = useState<number | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [wrapLines, setWrapLines] = useState(true);
  const closeButton = useRef<HTMLButtonElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const selectedRead = useRef(0);
  const [copyMessage, setCopyMessage] = useState('');
  const [individualError, setIndividualError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refreshHandle = useRef<ReturnType<typeof createCoalescedRefresh<QueryLogEntry[]>> | null>(
    null,
  );
  const refresh = useCallback(() => refreshHandle.current?.refresh() ?? Promise.resolve(), []);
  useEffect(() => {
    const updater = createCoalescedRefresh(
      () => window.diagnostics.queryLog(),
      (entries) => {
        setItems(entries);
        setError('');
      },
      (reason) => setError(String(reason)),
    );
    refreshHandle.current = updater;
    const unsubscribe = window.diagnostics.onQueryLogChanged(() => {
      void updater.refresh();
    });
    void updater.refresh();
    return () => {
      updater.dispose();
      refreshHandle.current = null;
      ++selectedRead.current;
      unsubscribe();
    };
  }, []);
  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return items.filter((item) => {
      if (
        onlyIssues &&
        item.status !== 'finding' &&
        item.status !== 'partial' &&
        item.status !== 'error'
      )
        return false;
      return (
        !term ||
        [
          item.command,
          item.device,
          translate(locale, 'queryLog', descriptionKeys[item.mode]),
          item.errorCode,
        ].some((value) => value?.toLowerCase().includes(term))
      );
    });
  }, [items, onlyIssues, filter, locale]);
  const closeResult = useCallback(() => {
    ++selectedRead.current;
    setOpened(null);
    setResult(null);
    setResultLoading(false);
    lastTrigger.current?.focus();
  }, []);
  useEffect(() => {
    if (opened === null) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeResult();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls =
        inspector.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [opened, closeResult]);
  // Entries can disappear in another window while their raw output is open.
  // Never retain the inspector or accept its in-flight response after removal.
  useEffect(() => {
    if (opened !== null && !items.some((item) => item.id === opened && item.hasResult))
      closeResult();
  }, [items, opened, closeResult]);
  async function toggleResult(id: number, trigger: HTMLButtonElement) {
    const read = ++selectedRead.current;
    if (opened === id) {
      closeResult();
      return;
    }
    lastTrigger.current = trigger;
    setOpened(id);
    setResult(null);
    setResultLoading(true);
    setCopyMessage('');
    setIndividualError('');
    try {
      const next = await window.diagnostics.queryLogResult(id);
      if (selectedRead.current === read) setResult(next);
    } catch (e) {
      if (selectedRead.current === read) setError(String(e));
    } finally {
      if (selectedRead.current === read) setResultLoading(false);
    }
  }
  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopyMessage(translate(locale, 'queryLog', 'copied'));
    } catch (e) {
      setIndividualError(String(e));
    }
  }
  async function saveIndividualResult() {
    if (opened === null || !result || resultLoading || busy) return;
    try {
      setBusy(true);
      setIndividualError('');
      await window.diagnostics.saveQueryLogResult(opened);
    } catch (e) {
      setIndividualError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    if (!window.confirm(translate(locale, 'queryLog', 'clearTheSessionLog'))) return;
    try {
      setBusy(true);
      await window.diagnostics.clearQueryLog();
      closeResult();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    try {
      setBusy(true);
      if (
        includeRaw &&
        !window.confirm(translate(locale, 'queryLog', 'rawOutputsMayIncludeSerial'))
      )
        return;
      await window.diagnostics.exportQueryLog(includeRaw);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="query-log-view" aria-label={translate(locale, 'queryLog', 'aria')}>
      <div className="query-log-heading">
        <h2>{translate(locale, 'queryLog', 'title')}</h2>
        <div className="query-log-buttons">
          <button
            className="button secondary"
            onClick={() => void refresh()}
            title={translate(locale, 'queryLog', 'refresh')}
          >
            <RefreshCw size={15} />
            {translate(locale, 'queryLog', 'refresh')}
          </button>
          <button
            className="button secondary"
            onClick={() => void save()}
            disabled={busy || items.length === 0}
          >
            <Download size={15} />
            {translate(locale, 'queryLog', 'saveJson')}
          </button>
          <button
            className="button secondary"
            onClick={() => void clear()}
            disabled={busy || items.length === 0}
          >
            <Trash2 size={15} />
            {translate(locale, 'queryLog', 'clear')}
          </button>
        </div>
      </div>
      <div className="query-log-toolbar">
        <label className="query-log-search">
          <Search size={16} />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={translate(locale, 'queryLog', 'searchDeviceCommandOrType')}
            aria-label={translate(locale, 'queryLog', 'searchAria')}
          />
        </label>
        <div className="query-log-toolbar-side">
          <label className="query-log-toggle">
            <input
              type="checkbox"
              checked={onlyIssues}
              onChange={(event) => setOnlyIssues(event.target.checked)}
            />
            {translate(locale, 'queryLog', 'onlyIssues')}
          </label>
          <label className="query-log-toggle query-log-toggle--muted">
            <input
              type="checkbox"
              checked={includeRaw}
              onChange={(event) => setIncludeRaw(event.target.checked)}
            />
            {translate(locale, 'queryLog', 'includeRawOutputInJSON')}
          </label>
          <span className="query-log-count" aria-live="polite">
            {shown.length} / {items.length}
          </span>
        </div>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {shown.length === 0 ? (
        <div className="query-log-empty">{translate(locale, 'queryLog', 'noMatchingQueries')}</div>
      ) : (
        <div className="query-log-scroll">
          <table className="query-log-table">
            <thead>
              <tr>
                <th>{translate(locale, 'queryLog', 'time')}</th>
                <th>{translate(locale, 'queryLog', 'queryType')}</th>
                <th>{translate(locale, 'queryLog', 'device')}</th>
                <th>{translate(locale, 'queryLog', 'result')}</th>
                <th>{translate(locale, 'queryLog', 'duration')}</th>
                <th>{translate(locale, 'queryLog', 'output')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.id} className={opened === item.id ? 'query-log-selected' : undefined}>
                  <td>{new Date(item.startedAt).toLocaleTimeString(locale)}</td>
                  <td className="query-log-operation">
                    <strong>
                      {translate(locale, 'queryLog', descriptionKeys[item.mode])}
                      {item.mode === 'self-test' && item.kind ? ` (${item.kind})` : ''}
                    </strong>
                    <code title={item.command}>{item.command}</code>
                  </td>
                  <td className="query-log-device">{item.device || '–'}</td>
                  <td>
                    <span className={`query-log-status query-log-status--${item.status}`}>
                      {item.status === 'running'
                        ? translate(locale, 'queryLog', 'running')
                        : item.status === 'ok'
                          ? 'OK'
                          : item.status === 'finding'
                            ? translate(locale, 'queryLog', 'finding')
                            : item.status === 'partial'
                              ? translate(locale, 'queryLog', 'partial')
                              : translate(locale, 'queryLog', 'error')}
                    </span>
                    {item.exitCode !== null && (
                      <small>
                        {translateParams(locale, 'queryLog', 'exitCodeLabel', {
                          code: item.exitCode,
                        })}
                      </small>
                    )}
                    {item.status === 'partial' &&
                      item.exitCode !== null &&
                      (item.exitCode & 0xf8) !== 0 && (
                        <span className="query-log-status query-log-status--finding query-log-additional-finding">
                          {translate(locale, 'queryLog', 'additionalFinding')}
                        </span>
                      )}
                    {item.errorCode && <small>{item.errorCode}</small>}
                    {exitHint(item.exitCode, locale) && (
                      <small title={exitHint(item.exitCode, locale) || undefined}>
                        {exitHint(item.exitCode, locale)}
                      </small>
                    )}
                  </td>
                  <td>
                    {item.durationMs === null
                      ? '–'
                      : `${item.durationMs.toLocaleString(locale)} ms`}
                  </td>
                  <td>
                    <button
                      className="button secondary query-log-show"
                      type="button"
                      disabled={!item.hasResult}
                      onClick={(event) => void toggleResult(item.id, event.currentTarget)}
                      aria-haspopup="dialog"
                      aria-label={`${translate(locale, 'queryLog', 'openOutput')}: ${translate(locale, 'queryLog', descriptionKeys[item.mode])}`}
                    >
                      <Eye size={15} />
                      {item.hasResult ? translate(locale, 'queryLog', 'view') : '–'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {opened !== null && (
        <div
          className="query-log-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeResult();
          }}
        >
          <section
            ref={inspector}
            className="query-log-inspector"
            role="dialog"
            aria-modal="true"
            aria-labelledby="query-log-inspector-title"
          >
            <header className="query-log-inspector-header">
              <div className="query-log-inspector-title">
                <strong id="query-log-inspector-title">
                  {translate(locale, 'queryLog', 'resultTitle')}
                </strong>
                <span>{items.find((item) => item.id === opened)?.command || '–'}</span>
              </div>
              <button
                ref={closeButton}
                className="button secondary query-log-inspector-close"
                type="button"
                onClick={closeResult}
                aria-label={translate(locale, 'queryLog', 'closeOutput')}
                title={translate(locale, 'queryLog', 'closeEsc')}
              >
                <X size={18} />
                {translate(locale, 'queryLog', 'close')}
              </button>
            </header>
            <div className="query-log-inspector-toolbar">
              <button
                className="button secondary"
                type="button"
                aria-pressed={wrapLines}
                onClick={() => setWrapLines((value) => !value)}
              >
                {wrapLines ? <WrapText size={15} /> : <AlignLeft size={15} />}
                {translate(locale, 'queryLog', 'lineWrapping')}:{' '}
                {wrapLines
                  ? translate(locale, 'queryLog', 'on')
                  : translate(locale, 'queryLog', 'off')}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={!result}
                onClick={() => void copyResult()}
              >
                <Copy size={15} />
                {translate(locale, 'queryLog', 'copy')}
              </button>
              <button
                className="button primary"
                type="button"
                disabled={!result || busy || resultLoading}
                onClick={() => void saveIndividualResult()}
              >
                <Download size={15} />
                {translate(locale, 'queryLog', 'saveJson')}
              </button>
              {copyMessage && <small role="status">{copyMessage}</small>}
            </div>
            {individualError && (
              <p className="query-log-result-note" role="alert">
                {individualError}
              </p>
            )}
            {resultLoading ? (
              <p className="query-log-inspector-message">
                {translate(locale, 'queryLog', 'loadingOutput')}
              </p>
            ) : result ? (
              <>
                {result.format === 'text' && (
                  <p className="query-log-result-note query-log-result-note--neutral">
                    {translate(locale, 'queryLog', 'textOutputIsSavedInside')}
                  </p>
                )}
                {result.truncated && (
                  <p className="query-log-result-note">
                    {translate(locale, 'queryLog', 'outputTruncatedDueToMemory')}
                  </p>
                )}
                <div className="query-log-output-scroll">
                  <pre
                    className={`query-log-result-text${wrapLines ? ' query-log-result-text--wrapped' : ''}`}
                  >
                    {result.text}
                  </pre>
                </div>
              </>
            ) : (
              <p className="query-log-inspector-message">
                {translate(locale, 'queryLog', 'resultUnavailable')}
              </p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
