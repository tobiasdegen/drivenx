// @ts-check
'use strict';
const path = require('node:path');

/**
 * Load the application page in a window without leaking a rejected Electron
 * navigation promise into the main process. did-fail-load remains responsible
 * for presenting an actionable error page.
 *
 * @param {{ isDestroyed: () => boolean; loadURL: (url: string) => Promise<unknown>; loadFile: (file: string, options?: {hash?: string}) => Promise<unknown> }} window
 * @param {{ packaged: boolean; devServerUrl?: string | null; htmlPath: string; hash?: '' | '#preferences' | '#query-log'; logFailure?: (reason: string) => void }} options
 */
function loadApplicationWindow(window, options) {
  if (window.isDestroyed()) return;
  const { packaged, devServerUrl, htmlPath, hash = '', logFailure = () => {} } = options;
  // Keep the URL in sync with trusted-sender.js: each auxiliary window has
  // exactly one authorized hash, including in development builds.
  try {
    const pending =
      !packaged && devServerUrl
        ? window.loadURL(devServerUrl + hash)
        : window.loadFile(path.resolve(htmlPath), { hash: hash.replace(/^#/, '') });
    // Both a synchronous throw and an asynchronous reject are possible when
    // a window is destroyed while an initial load is still in progress.
    void Promise.resolve(pending).catch((error) => {
      if (!window.isDestroyed()) logFailure(errorCode(error));
    });
  } catch (error) {
    if (!window.isDestroyed()) logFailure(errorCode(error));
  }
}

/** @param {unknown} error */
function errorCode(error) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'NAVIGATION_FAILED';
}

/**
 * Deny renderer-initiated navigation (including redirects) and opening new
 * windows consistently for main, auxiliary and PDF windows. The application
 * itself may still call loadURL/loadFile to perform a deliberate load.
 *
 * @param {{webContents: {setWindowOpenHandler: (callback: () => {action: 'deny'}) => void; on: (name: string, callback: (event: {preventDefault: () => void}) => void) => unknown}}} window
 */
function restrictWindowNavigation(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  /** @param {{preventDefault: () => void}} event */
  const denyNavigation = (event) => event.preventDefault();
  window.webContents.on('will-navigate', denyNavigation);
  window.webContents.on('will-redirect', denyNavigation);
}

module.exports = { loadApplicationWindow, restrictWindowNavigation };
