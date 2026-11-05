// @ts-check
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Only the two authorization fields cross into privileged device IPC.
// The renderer's USB topology, capacity and other display metadata are not
// trusted by the main process and must not be sent back with each command.
/** @typedef {import('../src/ipc-contract').DiagnosticsBridge} DiagnosticsBridge */
/** @typedef {import('../src/ipc-contract').DeviceReference} DeviceReference */
/** @typedef {import('../src/ipc-contract').MenuCommand} MenuCommand */
/** @typedef {import('../src/types').Preferences} Preferences */
/** @typedef {{locale: import('../src/ipc-contract').Locale, theme: Preferences['theme']}} Appearance */
/** @param {DeviceReference} device */
const deviceRef = (device) => ({ name: device.name, type: device.type });
/**
 * The main process owns runtime validation and returns an IPC result envelope.
 * The exposed bridge alone selects the fixed allowed channels.
 * @template T
 * @param {string} name
 * @param {...unknown} args
 * @returns {Promise<T>}
 */
const invoke = async (name, ...args) => {
  const result = await ipcRenderer.invoke(`diagnostics:${name}`, ...args);
  if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
    const error =
      result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
        ? result.error
        : 'Unbekannter Fehler';
    throw new Error(error);
  }
  if (!('value' in result)) throw new Error('Ungültige IPC-Antwort');
  // A typed return is promised by the trusted main-process handler. The
  // renderer cannot choose the channel or supply privileged objects directly.
  return /** @type {T} */ (result.value);
};

/** @type {DiagnosticsBridge} */
const bridge = {
  onMenuCommand: (cb) => {
    /** @type {(event: unknown, command: MenuCommand) => void} */
    const listener = (_e, command) => cb(command);
    ipcRenderer.on('diagnostics:menu-command', listener);
    return () => ipcRenderer.removeListener('diagnostics:menu-command', listener);
  },
  onPreferencesChanged: (cb) => {
    /** @type {(event: unknown, value: Preferences) => void} */
    const listener = (_e, value) => cb(value);
    ipcRenderer.on('diagnostics:preferences-changed', listener);
    return () => ipcRenderer.removeListener('diagnostics:preferences-changed', listener);
  },
  onQueryLogAppearanceChanged: (cb) => {
    /** @type {(event: unknown, value: Appearance) => void} */
    const listener = (_e, value) => cb(value);
    ipcRenderer.on('diagnostics:query-log-appearance-changed', listener);
    return () => ipcRenderer.removeListener('diagnostics:query-log-appearance-changed', listener);
  },
  onQueryLogChanged: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('diagnostics:query-log-changed', listener);
    return () => ipcRenderer.removeListener('diagnostics:query-log-changed', listener);
  },
  queryLog: () => invoke('queryLog'),
  queryLogResult: (id) => invoke('queryLogResult', id),
  saveQueryLogResult: (id) => invoke('saveQueryLogResult', id),
  queryLogAppearance: () => invoke('queryLogAppearance'),
  clearQueryLog: () => invoke('clearQueryLog'),
  exportQueryLog: (includeRaw = false) => invoke('exportQueryLog', includeRaw),
  openPreferences: () => invoke('openPreferences'),
  environment: () => invoke('environment'),
  settings: () => invoke('settings'),
  saveSettings: (v) => invoke('saveSettings', v),
  chooseLogo: () => invoke('chooseLogo'),
  version: () => invoke('version'),
  scan: (preferredUsbMode = 'auto') => invoke('scan', preferredUsbMode),
  scanMetadata: (generation) => invoke('scanMetadata', generation),
  scanAliases: (generation) => invoke('scanAliases', generation),
  detail: (device, fresh = false) => invoke('detail', deviceRef(device), fresh),
  selectAccessMode: (device, mode, generation) =>
    invoke('selectAccessMode', deviceRef(device), mode, generation),
  history: (device, reportId) => invoke('history', deviceRef(device), reportId),
  windowsTrim: () => invoke('windowsTrim'),
  macHostIo: (device, reportId) => invoke('macHostIo', deviceRef(device), reportId),
  saveHistory: (device, reportId) => invoke('saveHistory', deviceRef(device), reportId),
  restoreLocalHistory: (device, reportId) =>
    invoke('restoreLocalHistory', deviceRef(device), reportId),
  exportHistory: (device, reportId) => invoke('exportHistory', deviceRef(device), reportId),
  importHistory: (device, reportId) => invoke('importHistory', deviceRef(device), reportId),
  test: (device, kind, reportId) => invoke('test', deviceRef(device), kind, reportId),
  exportReport: (data, format, locale, reportId) =>
    invoke('export', deviceRef(data), format, locale, reportId),
};
contextBridge.exposeInMainWorld('diagnostics', Object.freeze(bridge));
