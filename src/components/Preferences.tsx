import { useEffect, useRef, useState } from 'react';
import {
  Settings2,
  HardDrive,
  Palette,
  FileText,
  Database,
  ImagePlus,
  Trash2,
  Check,
  ChevronDown,
} from 'lucide-react';
import type { Preferences } from '../types';
import { DEFAULT_LOCALE, translate } from '../i18n.mts';
import { watchSystemTheme } from '../system-theme.mjs';

// The DOM returns arbitrary strings; narrow them before updating typed preferences.
function isLocale(value: string): value is Preferences['locale'] {
  return value === 'de-DE' || value === 'en-US';
}
function isTheme(value: string): value is Preferences['theme'] {
  return value === 'system' || value === 'light' || value === 'dark';
}
function isAttributeMode(value: string): value is Preferences['attributeMode'] {
  return value === 'friendly' || value === 'technical';
}

export default function PreferencesWindow() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const original = useRef<Preferences | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const versionRequested = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const savePending = useRef(false);
  const logoPending = useRef(false);
  const [choosingLogo, setChoosingLogo] = useState(false);

  useEffect(() => {
    let active = true;
    void window.diagnostics
      .settings()
      .then((value) => {
        if (!active) return;
        original.current = value;
        setPrefs(value);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!prefs) return;
    return watchSystemTheme(
      prefs.theme,
      (theme: 'dark' | 'light') => {
        document.documentElement.dataset.theme = theme;
      },
      window.matchMedia.bind(window),
    );
  }, [prefs?.theme]);

  const locale = prefs?.locale ?? DEFAULT_LOCALE;
  const tr = (key: string) => translate(locale, 'preferences', key);
  const macVersion = version?.match(
    /^smartctl\s+(\S+)\s+\S+\s+(r\d+)\s+\[Darwin\s+(\S+)\s+arm64\]/,
  );
  const bundledMac = Boolean(
    macVersion && prefs?.binary.endsWith('/smartmontools/darwin/smartctl'),
  );
  const update = (patch: Partial<Preferences>) =>
    setPrefs((previous) => (previous ? { ...previous, ...patch } : previous));
  // All preference fields are primitives. Comparing by field avoids repeatedly
  // serializing a potentially large base64 logo on every keystroke.
  const modified =
    prefs !== null &&
    (original.current === null ||
      (Object.keys(prefs) as (keyof Preferences)[]).some(
        (field) => prefs[field] !== original.current?.[field],
      ));

  async function loadVersion() {
    if (versionRequested.current) return;
    versionRequested.current = true;
    try {
      const response = await window.diagnostics.version();
      setVersion(response.details.versionText || '–');
    } catch {
      setVersion(tr('unavailable'));
    }
  }

  async function save() {
    if (!prefs || savePending.current || logoPending.current || !modified) return;
    savePending.current = true;
    setBusy(true);
    setError('');
    try {
      await window.diagnostics.saveSettings(prefs);
      window.close();
    } catch (reason) {
      setError(String(reason));
    } finally {
      savePending.current = false;
      setBusy(false);
    }
  }

  async function chooseLogo() {
    if (logoPending.current || savePending.current) return;
    logoPending.current = true;
    setChoosingLogo(true);
    setError('');
    try {
      const logo = await window.diagnostics.chooseLogo();
      if (logo) update({ companyLogo: logo });
    } catch (reason) {
      setError(String(reason));
    } finally {
      logoPending.current = false;
      setChoosingLogo(false);
    }
  }

  if (!prefs)
    return (
      <div className="preferences-window">
        <p className="pref-loading" role={error ? 'alert' : 'status'}>
          {error || tr('loading')}
        </p>
      </div>
    );
  return (
    <div className="preferences-window" data-locale={prefs.locale}>
      <header className="preferences-header">
        <Settings2 size={21} aria-hidden="true" />
        <h1>{tr('title')}</h1>
      </header>
      <main className="preferences-content" inert={busy}>
        <section className="preferences-group" aria-labelledby="preferences-appearance">
          <h2 id="preferences-appearance">
            <Palette size={17} />
            {tr('appearance')}
          </h2>
          <div className="pref-row">
            <label htmlFor="language">{tr('language')}</label>
            <div className="pref-select">
              <select
                id="language"
                value={prefs.locale}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (isLocale(value)) update({ locale: value });
                }}
              >
                <option value="de-DE">Deutsch</option>
                <option value="en-US">English</option>
              </select>
              <ChevronDown size={16} className="pref-select-chevron" aria-hidden="true" />
            </div>
          </div>
          <div className="pref-row">
            <label htmlFor="theme">{tr('theme')}</label>
            <div className="pref-select">
              <select
                id="theme"
                value={prefs.theme}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (isTheme(value)) update({ theme: value });
                }}
              >
                <option value="system">{tr('system')}</option>
                <option value="dark">{tr('dark')}</option>
                <option value="light">{tr('light')}</option>
              </select>
              <ChevronDown size={16} className="pref-select-chevron" aria-hidden="true" />
            </div>
          </div>
          <div className="pref-row">
            <label htmlFor="names">{tr('smartNames')}</label>
            <div className="pref-select">
              <select
                id="names"
                value={prefs.attributeMode}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (isAttributeMode(value)) update({ attributeMode: value });
                }}
              >
                <option value="friendly">{tr('friendly')}</option>
                <option value="technical">{tr('technical')}</option>
              </select>
              <ChevronDown size={16} className="pref-select-chevron" aria-hidden="true" />
            </div>
          </div>
        </section>
        <section className="preferences-group" aria-labelledby="preferences-queries">
          <h2 id="preferences-queries">
            <Database size={17} />
            {tr('driveQueries')}
          </h2>
          <label className="pref-switch-row" htmlFor="backgroundDetails">
            <span className="pref-switch-copy">
              <strong>{tr('autoRead')}</strong>
              <small>{tr('autoReadNotice')}</small>
            </span>
            <input
              id="backgroundDetails"
              type="checkbox"
              role="switch"
              checked={prefs.backgroundDetails === true}
              onChange={(event) => update({ backgroundDetails: event.target.checked })}
            />
            <span className="pref-switch-track" aria-hidden="true" />
          </label>
          <label className="pref-switch-row" htmlFor="autoSaveHistory">
            <span className="pref-switch-copy">
              <strong>{tr('autoHistory')}</strong>
              <small>{tr('autoHistoryNotice')}</small>
            </span>
            <input
              id="autoSaveHistory"
              type="checkbox"
              role="switch"
              checked={prefs.autoSaveHistory === true}
              onChange={(event) => update({ autoSaveHistory: event.target.checked })}
            />
            <span className="pref-switch-track" aria-hidden="true" />
          </label>
          <label className="pref-switch-row" htmlFor="autoBackupHistory">
            <span className="pref-switch-copy">
              <strong>{tr('autoBackupHistory')}</strong>
              <small>{tr('autoBackupHistoryNotice')}</small>
            </span>
            <input
              id="autoBackupHistory"
              type="checkbox"
              role="switch"
              checked={prefs.autoBackupHistory === true}
              onChange={(event) => update({ autoBackupHistory: event.target.checked })}
            />
            <span className="pref-switch-track" aria-hidden="true" />
          </label>
        </section>
        <section className="preferences-group" aria-labelledby="preferences-reports">
          <h2 id="preferences-reports">
            <FileText size={17} />
            {tr('reports')}
          </h2>
          <div className="pref-field">
            <label htmlFor="companyName">{tr('companyName')}</label>
            <input
              id="companyName"
              maxLength={150}
              value={prefs.companyName}
              onChange={(event) => update({ companyName: event.target.value })}
            />
          </div>
          <div className="pref-field">
            <label htmlFor="companyAddress">{tr('address')}</label>
            <textarea
              id="companyAddress"
              maxLength={700}
              rows={2}
              value={prefs.companyAddress}
              onChange={(event) => update({ companyAddress: event.target.value })}
            />
          </div>
          <div className="pref-field">
            <label htmlFor="companyContact">{tr('contact')}</label>
            <input
              id="companyContact"
              maxLength={250}
              value={prefs.companyContact}
              onChange={(event) => update({ companyContact: event.target.value })}
            />
          </div>
          <div className="pref-logo-row">
            <div className="pref-logo-text">
              <span className="pref-field-label">{tr('logo')}</span>
              <small>{tr('autoOptionalForPDFReports')}</small>
            </div>
            <div className="logo-controls">
              <button
                type="button"
                disabled={busy || choosingLogo}
                onClick={() => void chooseLogo()}
              >
                <ImagePlus size={15} />
                {tr('logoSelect')}
              </button>
              {prefs.companyLogo && (
                <button type="button" disabled={busy} onClick={() => update({ companyLogo: '' })}>
                  <Trash2 size={15} />
                  {tr('remove')}
                </button>
              )}
            </div>
          </div>
          {prefs.companyLogo && (
            <img className="company-logo-preview" src={prefs.companyLogo} alt={tr('logoPreview')} />
          )}
        </section>
        <details
          className="pref-technical"
          onToggle={(event) => {
            if (event.currentTarget.open) void loadVersion();
          }}
        >
          <summary>
            <HardDrive size={17} aria-hidden="true" />
            <span>{tr('smartTool')}</span>
          </summary>
          <div className="pref-technical-body">
            <p>{tr('smartToolNotice')}</p>
            <dl className="pref-details">
              <dt>{tr('activePath')}</dt>
              <dd>
                <code>{prefs.binary}</code>
              </dd>
              <dt>{tr('version')}</dt>
              <dd>
                <code title={version ?? undefined}>
                  {macVersion ? `smartctl ${macVersion[1]} ${macVersion[2]}` : (version ?? '…')}
                </code>
              </dd>
              {bundledMac && macVersion && (
                <>
                  <dt>{tr('smartToolBuild')}</dt>
                  <dd>
                    <code>Darwin {macVersion[3]} · ARM64</code>
                  </dd>
                  <dt>{tr('smartToolTarget')}</dt>
                  <dd>
                    <code>macOS 15+ · ARM64</code>
                  </dd>
                </>
              )}
            </dl>
          </div>
        </details>
      </main>
      {error && (
        <p role="alert" className="pref-error">
          {error}
        </p>
      )}
      <footer className="pref-footer">
        <span className="pref-footer-status">
          {modified ? (
            tr('autoUnsavedChanges')
          ) : (
            <>
              <Check size={14} />
              {tr('autoUpToDate')}
            </>
          )}
        </span>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => window.close()}
        >
          {tr('autoCancel')}
        </button>
        <button
          className="button primary"
          type="button"
          disabled={busy || choosingLogo || !modified}
          onClick={() => void save()}
        >
          {busy ? '…' : tr('apply')}
        </button>
      </footer>
    </div>
  );
}
