'use strict';
const { getCatalogSection } = require('./translator.js');
const message = (locale, key, values = {}) =>
  getCatalogSection(locale, 'startup')[key].replace(/\{(\w+)\}/g, (_match, name) =>
    String(values[name] ?? '–'),
  );

function showBootError(window, detail, locale = 'en-US') {
  if (!window || window.isDestroyed()) return;
  const safe = String(detail).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
  const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><style>body{margin:0;background:#0c1220;color:#edf2ff;font:15px system-ui;padding:36px}h1{font-size:23px}p{max-width:700px;line-height:1.6;color:#adbdd7}pre{white-space:pre-wrap;background:#17233a;border:1px solid #374666;border-radius:8px;padding:16px;color:#fff}</style><h1>${message(locale, 'bootHeading')}</h1><p>${message(locale, 'bootHelp')}</p><pre>${safe}</pre></html>`;
  // A window may be closed after the first failure but before Electron resolves
  // the error page navigation. Never leave an unhandled rejection behind.
  try {
    void Promise.resolve(
      window.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html)),
    ).catch(() => {});
  } catch {
    // The renderer is no longer able to show the error page.
  }
}

function attachStartupDiagnostics(window, name, logStartup, options = {}) {
  const schedule = options.schedule || setTimeout;
  const locale = () => (typeof options.locale === 'function' ? options.locale() : 'en-US');
  let revision = 0;
  const alive = () => !window.isDestroyed() && !window.webContents.isDestroyed();

  // A previous load's delayed React check must not overwrite a newer page.
  window.webContents.on('did-start-loading', () => {
    revision++;
  });
  window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    // ERR_ABORTED is normal when a navigation is superseded or a window closes.
    if (code === -3) return;
    logStartup('load-failed', `code=${code}; mainFrame=${Boolean(isMainFrame)}`);
    if (isMainFrame)
      showBootError(
        window,
        message(locale(), 'fileLoadFailed', { detail: description, code }),
        locale(),
      );
  });
  window.webContents.on('preload-error', (_event, _preloadPath, error) => {
    logStartup('preload-error', 'preload');
    showBootError(
      window,
      message(locale(), 'preloadFailed', { detail: error?.message || error }),
      locale(),
    );
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    logStartup('renderer-gone', `reason=${details.reason}`);
    showBootError(window, message(locale(), 'rendererGone', { detail: details.reason }), locale());
  });
  window.webContents.on('console-message', ({ level, message }) => {
    // Electron delivers the severity and message on a single event object.
    // Log categories only, so renderer output cannot expose sensitive details.
    if (level === 'error' || /Content Security Policy|Failed to load|Uncaught/i.test(message))
      logStartup(
        'renderer-console',
        /Content Security Policy/i.test(message) ? 'CSP' : 'renderer-error',
      );
  });
  window.webContents.on('did-finish-load', () => {
    const ticket = ++revision;
    if (!alive()) return;
    const url = window.webContents.getURL();
    // Never inspect or replace our own boot-error page.
    if (url.startsWith('data:')) return;
    logStartup('page-loaded', name);
    schedule(async () => {
      if (!alive() || ticket !== revision || window.webContents.getURL() !== url) return;
      try {
        const result = await window.webContents.executeJavaScript(
          `({root:!!document.getElementById('root'),mounted:!!document.querySelector('#root > *'),url:location.href,api:typeof window.diagnostics})`,
          true,
        );
        // executeJavaScript() can resolve after the renderer navigates again.
        if (!alive() || ticket !== revision || window.webContents.getURL() !== url) return;
        logStartup(
          'react-check',
          `root=${Boolean(result.root)} mounted=${Boolean(result.mounted)} api=${result.api === 'object' ? 'available' : 'missing'}`,
        );
        if (!result.mounted)
          showBootError(
            window,
            message(locale(), 'reactLoadFailed', { api: result.api, url: result.url }),
            locale(),
          );
      } catch {
        if (alive() && ticket === revision)
          logStartup('react-check-error', 'renderer-check-failed');
      }
    }, 4000);
  });
}

module.exports = { showBootError, attachStartupDiagnostics };
