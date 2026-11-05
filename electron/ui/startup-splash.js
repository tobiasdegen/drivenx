// @ts-check
'use strict';

const DELAY_MS = 350;

function splashHtml(locale = 'en-US') {
  const german = /^de(?:-|$)/i.test(locale);
  const label = german ? 'Wird gestartet …' : 'Starting …';
  const language = german ? 'de' : 'en';
  // Fixed, local, script-free markup. No external files, user input or navigation.
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;height:100vh;display:grid;place-items:center;background:#101827;color:#e9eef9;font:16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .shell{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;border:1px solid #30425e}
    .mark{width:48px;height:48px;border-radius:14px;background:#203553;border:1px solid #41659a;display:grid;place-items:center;color:#91bbf6;font-size:28px;font-weight:700;line-height:1}
    h1{margin:0;font-size:25px;font-weight:700;letter-spacing:-.5px}.status{color:#aebdd3;font-size:14px;display:flex;gap:9px;align-items:center}
    .dot{width:8px;height:8px;border:2px solid #6eacfa;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.dot{animation:none}}
  </style></head><body><div class="shell" role="status"><div class="mark" aria-hidden="true">D</div><h1>DriveNX</h1><div class="status"><span class="dot" aria-hidden="true"></span>${label}</div></div></body></html>`;
}

/**
 * A Windows-only packaged startup hint, shown only when initialization actually
 * takes longer than DELAY_MS. Close before completion to avoid a distracting flash.
 * The view has no preload, JavaScript, network access, or privileged IPC.
 *
 * @param {{ BrowserWindow: new (options: object) => any, locale: string,
 *   iconPath: string, restrictNavigation: (win: any) => void,
 *   log?: (tag: string) => void, schedule?: typeof setTimeout,
 *   cancel?: typeof clearTimeout }} options
 */
function createStartupSplash({
  BrowserWindow,
  locale,
  iconPath,
  restrictNavigation,
  log = () => {},
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  const splash = new BrowserWindow({
    width: 330,
    height: 210,
    center: true,
    frame: false,
    show: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: false,
    backgroundColor: '#101827',
    title: 'DriveNX',
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      javascript: false,
      webSecurity: true,
    },
  });
  restrictNavigation(splash);
  let loaded = false;
  let elapsed = false;
  let closed = false;
  function showIfReady() {
    if (!closed && loaded && elapsed && !splash.isDestroyed()) {
      splash.show();
      log('splash-visible');
    }
  }
  splash.once('ready-to-show', () => {
    loaded = true;
    showIfReady();
  });
  const timer = schedule(() => {
    elapsed = true;
    showIfReady();
  }, DELAY_MS);
  try {
    void Promise.resolve(
      splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(locale))}`),
    ).catch(() => {
      // Startup continues even when this optional hint cannot be loaded.
    });
  } catch {
    // Also tolerate a synchronous navigation failure.
  }
  return {
    close() {
      if (closed) return;
      closed = true;
      cancel(timer);
      if (!splash.isDestroyed()) splash.destroy();
    },
  };
}

module.exports = { createStartupSplash, splashHtml, DELAY_MS };
