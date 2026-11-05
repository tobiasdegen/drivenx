import { useEffect, useState } from 'react';
import { initialLocale, type Locale } from '../i18n.mts';
import QueryLogPanel from './QueryLogPanel';

function resolveTheme(value: 'dark' | 'light' | 'system') {
  if (value !== 'system') return value;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The log window must not scan drives or mount the main application's UI. */
export default function QueryLogWindow() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = window.diagnostics.onQueryLogAppearanceChanged((settings) => {
      if (!active) return;
      receivedUpdate = true;
      setLocale(settings.locale);
      setTheme(resolveTheme(settings.theme));
    });
    void window.diagnostics
      .queryLogAppearance()
      .then((settings) => {
        if (!active || receivedUpdate) return;
        setLocale(settings.locale);
        setTheme(resolveTheme(settings.theme));
      })
      .catch((reason) => {
        if (active && !receivedUpdate) setError(String(reason));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="query-log-window">
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      <QueryLogPanel locale={locale} />
    </div>
  );
}
