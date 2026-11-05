'use strict';
const mainEntryAt = Date.now();
const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard } = require('electron');
const { installWebSecurity } = require('./security/web-security.js');
const { isMainFrameSender } = require('./ipc/ipc-sender.js');
const { createIpcRegistrar } = require('./ipc/ipc-registrar.js');
const { loadApplicationWindow, restrictWindowNavigation } = require('./ui/window-navigation.js');
const { createSettingsSaver } = require('./data/settings-save.js');
installWebSecurity(app);
const fs = require('node:fs/promises');
const { readLimitedJson, atomicWrite } = require('./data/safe-files.js');
const { startupLog } = require('./data/startup-log.js');
const { sessionQueryLog } = require('./data/query-log.js');
const { individualQueryExport } = require('./reports/query-result-export.js');
const { queryLogChannelAllowed } = require('./data/query-log-access.js');
const ipcValidate = require('./ipc/ipc-validation.js');
const { defaultSettings, normalizeStoredSettings } = require('./data/stored-settings.js');
const { getCatalogSection } = require('./ui/translator.js');
const startupText = (key, values = {}) =>
  getCatalogSection(
    /^de(?:-|$)/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? 'de-DE' : 'en-US',
    'startup',
  )[key].replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? '–'));
const { backendError, userErrorMessage } = require('./security/user-errors.js');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
// Must be configured before app.ready: Chromium writes profile/cache data during startup.
const { configurePortableData } = require('./data/portable-data.js');
let portableData;
try {
  portableData = configurePortableData(app, {
    env: process.env,
    platform: process.platform,
    packaged: app.isPackaged,
  });
} catch (error) {
  // This happens before app.whenReady(), so the usual startup.log may not exist.
  // Never silently switch a portable build to a different profile.
  const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
  dialog.showErrorBox(startupText('portableTitle'), startupText('portableDetail', { code }));
  app.exit(1);
  throw error;
}
// Record that Electron reached the main process before the single-instance lock.
startupLog(app.getPath('userData'), 'pre-ready', portableData ? 'portable' : 'standard');
const { enableSingleInstance } = require('./data/single-instance.js');
const {
  runSmart,
  safeDevice,
  deviceKey,
  lookupBinaryAsync,
  scanDevices,
} = require('./devices/smart.js');
const { evaluate } = require('./diagnostics/health.js');
const { createSmartAccess } = require('./devices/smart-access.js');
const { trustedSender: isTrustedSender } = require('./ipc/trusted-sender.js');
const history = require('./data/measurement-history.js');
const { createDetailCache } = require('./diagnostics/detail-cache.js');
const { createDiagnosticService } = require('./diagnostics/diagnostic-service.js');
const { registerQueryLogIpc } = require('./ipc/query-log-ipc.js');
const { registerHistoryIpc } = require('./ipc/history-ipc.js');
const { createDeviceOperations } = require('./devices/device-operations.js');
const { createSelfTestController } = require('./devices/self-test-controller.js');
const { startWindowsInventory } = require('./platform/windows-inventory-loader.js');
const { parseWindowsInventory } = require('./platform/windows-connection.js');
const { possibleWindowsAliases, findWindowsNvmeAliases } = require('./devices/scan-aliases.js');
const { buildMenu: createAppMenu } = require('./ui/app-menu.js');
const {
  createLicenseHtml,
  chromiumLicenseCandidates,
  CHROMIUM_NOTICE_URL,
} = require('./ui/license-viewer.js');
const { showNativeAbout, createAboutHtml } = require('./ui/native-about.js');
const {
  checkLinuxDependencies,
  showLinuxDependencyNotice,
} = require('./platform/linux-dependencies.js');
const { linuxSmartSession } = require('./platform/linux-smart-session.js');
const { createScanController } = require('./devices/scan-controller.js');
const { createReportExporter } = require('./reports/report-export.js');
// All interactive renderer windows share one hardened preload configuration.
// PDF and legal viewers deliberately use stricter settings without a preload.
const rendererWebPreferences = Object.freeze({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
});
// Legal notices and PDF exports are static viewers: no JavaScript or preload.
const staticViewerWebPreferences = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  javascript: false,
  webSecurity: true,
});
let win;
let preferencesWindow;
let queryLogWindow;
let licenseWindow;
let chromiumLicenseWindow;
let aboutWindow;
let startupSplash = null;
const reports = createDetailCache();
const operations = createDeviceOperations();
// Diagnostics are local only. No SMART content or hardware identifiers are logged.
function logStartup(tag, message = '') {
  startupLog(app.getPath('userData'), tag, message);
}
const { attachStartupDiagnostics } = require('./ui/window-diagnostics.js');
const { createStartupSplash } = require('./ui/startup-splash.js');
sessionQueryLog.subscribe(() => {
  if (queryLogWindow && !queryLogWindow.isDestroyed())
    queryLogWindow.webContents.send('diagnostics:query-log-changed');
});

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = defaultSettings();
// A custom executable must be an explicit absolute file path. No PATH/CWD fallback.
const { validBinaryPath, isSmartctlVersion } = require('./security/binary-security.js');
async function verifiedSmartctl(file) {
  if (!validBinaryPath(file)) throw backendError('badSmartctlPath');
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw backendError('smartctlFileMissing');
  const { runTextProcess } = require('./security/text-process.js');
  // Identification is a plausibility check, NOT proof that the executable is safe.
  const text = await sessionQueryLog.track(['--version'], () =>
    runTextProcess(file, ['--version'], {
      timeout: 7000,
      maxOutput: 8192,
      maxError: 8192,
    }),
  );
  const first = text.split(/\r?\n/)[0].trim();
  if (!isSmartctlVersion(first)) throw backendError('badSmartctlVersion');
  return { versionText: first };
}
async function readSettings() {
  settings = defaultSettings(app.getLocale());
  try {
    const v = await readLimitedJson(settingsFile(), 2 * 1024 * 1024);
    settings = normalizeStoredSettings(v, app.getLocale());
  } catch (e) {
    if (e.code !== 'ENOENT') logStartup('settings-read-failed', e.code || e.name || 'invalid');
  }
}
const saveSettings = createSettingsSaver({
  validate: (value) => ({ ...ipcValidate.settings(value) }),
  persist: (value) => atomicWrite(settingsFile(), JSON.stringify(value, null, 2), 2 * 1024 * 1024),
  apply: (value) => {
    settings = value;
    updateMenu();
  },
  publish: async (value) => {
    const { binary } = await lookupBinaryAsync();
    if (win && !win.isDestroyed())
      win.webContents.send('diagnostics:preferences-changed', { ...value, binary: binary || '' });
    if (queryLogWindow && !queryLogWindow.isDestroyed())
      queryLogWindow.webContents.send('diagnostics:query-log-appearance-changed', {
        locale: value.locale,
        theme: value.theme,
      });
    return { ...value, binary: binary || '' };
  },
});
async function probeBinary() {
  const { binary, failure } = await lookupBinaryAsync();
  if (!binary) {
    if (failure)
      throw Object.assign(new Error(failure.reason), {
        code: failure.code,
        macIntegrityKey: failure.reasonKey,
        macIntegrityValues: failure.reasonValues,
      });
    throw backendError('smartctlUnavailable');
  }
  return verifiedSmartctl(binary);
}
const discovery = createScanController({
  getLocale: () => settings.locale,
  platform: process.platform,
  scanDevices,
  safeDevice,
  deviceKey,
  startWindowsInventory: () => startWindowsInventory(settings.locale),
  parseWindowsInventory,
  possibleWindowsAliases,
  findWindowsNvmeAliases,
  runSmart,
  operations,
  reports,
  logStartup,
  isTestPending: () => selfTests.isPending(),
});
// Keep command authorization and self-test coordination at one boundary.
const smartAccess = createSmartAccess({ runSmart, assertDevice: discovery.assertDevice });
const selfTests = createSelfTestController({
  reports,
  operations,
  smartAccess,
  assertDevice: discovery.assertDevice,
  deviceKey,
  isScanning: discovery.isScanning,
  scanGeneration: discovery.scanGeneration,
});
const assertDevice = discovery.assertDevice;
const diagnostics = createDiagnosticService({
  validateDevice: ipcValidate.device,
  assertDevice,
  deviceKey,
  reports,
  operations,
  smartAccess,
  evaluate,
  history,
  getSettings: () => settings,
  getUserDataPath: () => app.getPath('userData'),
  scanGeneration: discovery.scanGeneration,
  isScanning: discovery.isScanning,
  createId: randomUUID,
  logSaveError: (error) => logStartup('history-save-failed', error?.code || 'invalid'),
});
function createPdfWindow() {
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { ...staticViewerWebPreferences },
  });
  restrictWindowNavigation(pdfWin);
  return pdfWin;
}
const exportReport = createReportExporter({
  validateRequest: ipcValidate.exportRequest,
  assertDevice,
  reports,
  deviceKey,
  showSaveDialog: (options) =>
    dialog.showSaveDialog(win && !win.isDestroyed() ? win : undefined, options),
  createPdfWindow,
  writeFile: fs.writeFile,
  // The report renderer is needed only when a report is actually exported.
  generateHTML: (...args) => require('./reports/report.js').generateHTML(...args),
  getSettings: () => settings,
});

function serializeError(e) {
  return userErrorMessage(e, settings.locale);
}
function trustedSender(event) {
  return isTrustedSender({
    frameUrl: event.senderFrame?.url,
    senderId: event.sender.id,
    mainWindow: win,
    preferencesWindow,
    queryWindow: queryLogWindow,
    packaged: app.isPackaged,
    devServerUrl: !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : null,
    htmlPath: path.join(__dirname, '..', 'dist', 'index.html'),
  });
}

// Only reports for a device authorized by the current scan may be read.
function currentReport(device) {
  const authorized = assertDevice(ipcValidate.device(device));
  return reports.get(deviceKey(authorized));
}

const register = createIpcRegistrar({
  ipcMain,
  authorize: (event, channel) =>
    isMainFrameSender(event) &&
    trustedSender(event) &&
    queryLogChannelAllowed(event.sender.id, queryLogWindow, channel),
  unauthorizedMessage: () =>
    userErrorMessage(backendError('unauthorizedIpcSender'), settings.locale),
  serializeError,
});

// Windows token checks run via an absolute System32 path (never PATH/CWD).
const { queryElevatedState } = require('./platform/windows-privilege.js');
function elevatedState() {
  return queryElevatedState({
    trackSystem: (operation) => sessionQueryLog.trackSystem('windows-privilege', operation),
  });
}

let appBootstrapped = false;
const primaryInstance = enableSingleInstance(app, () => ({
  main: win,
  preferences: preferencesWindow,
}));
if (!primaryInstance) logStartup('instance-lock-unavailable');
logStartup('main-init-timing', Date.now() - mainEntryAt);
if (primaryInstance)
  app
    .whenReady()
    .then(async () => {
      logStartup(
        'launch',
        `DriveNX ${app.getVersion()}, ${process.platform}/${process.arch}, packaged=${app.isPackaged}`,
      );
      // Show a small, isolated hint only if Windows startup takes unusually long.
      if (process.platform === 'win32' && app.isPackaged) {
        try {
          startupSplash = createStartupSplash({
            BrowserWindow,
            locale: app.getLocale(),
            iconPath: path.join(process.resourcesPath, 'icon.png'),
            restrictNavigation: restrictWindowNavigation,
            log: (tag) => logStartup(tag),
          });
        } catch {
          // The startup hint is optional. Never prevent the actual application from opening.
          logStartup('splash-failed');
        }
      }
      const settingsStartedAt = Date.now();
      await readSettings();
      logStartup('settings-timing', Date.now() - settingsStartedAt);
      register('diagnostics:settings', async () => ({
        ...settings,
        binary: (await lookupBinaryAsync()).binary || '',
      }));
      register('diagnostics:saveSettings', saveSettings);
      register('diagnostics:openPreferences', async () => {
        openPreferences();
        return true;
      });
      register('diagnostics:chooseLogo', async () => {
        const result = await dialog.showOpenDialog(
          preferencesWindow && !preferencesWindow.isDestroyed() ? preferencesWindow : win,
          {
            title: getCatalogSection(settings.locale, 'dialogs').chooseCompanyLogo,
            properties: ['openFile'],
            filters: [
              {
                name: getCatalogSection(settings.locale, 'dialogs').companyLogoFilter,
                extensions: ['png', 'jpg', 'jpeg'],
              },
            ],
          },
        );
        if (result.canceled || !result.filePaths[0]) return null;
        return require('./reports/company-logo.js').readCompanyLogo(fs, result.filePaths[0]);
      });
      register('diagnostics:version', async () => ({
        binary: (await lookupBinaryAsync()).binary || '',
        details: await probeBinary(),
      }));
      register('diagnostics:environment', async () => ({
        platform: process.platform,
        elevated: await elevatedState(),
      }));
      registerQueryLogIpc({
        register,
        queryLog: sessionQueryLog,
        exportIndividual: individualQueryExport,
        getSettings: () => settings,
        getDialogOwner: () =>
          queryLogWindow && !queryLogWindow.isDestroyed() ? queryLogWindow : win,
        showSaveDialog: (owner, options) => dialog.showSaveDialog(owner, options),
        writeFile: fs.writeFile,
        renameFile: fs.rename,
        removeFile: fs.rm,
      });
      register('diagnostics:scan', discovery.scan);
      register('diagnostics:scanAliases', discovery.scanAliases);
      register('diagnostics:scanMetadata', discovery.scanMetadata);
      register('diagnostics:detail', diagnostics.detail);
      register('diagnostics:selectAccessMode', discovery.selectAccessMode);
      register('diagnostics:macHostIo', async (device, reportId) => {
        const token = ipcValidate.reportIdToken(reportId);
        const report = currentReport(device);
        if (!report || report.reportId !== token) throw backendError('staleDiagnosisData');
        if (process.platform !== 'darwin') return null;
        if (!/^\/dev\/disk\d+$/.test(report.device.name)) return null;
        const { runTextProcess } = require('./security/text-process.js');
        const { parseMacHostIo } = require('./platform/mac-host-io.js');
        const output = await sessionQueryLog.trackSystem(
          'mac-host-io',
          () =>
            runTextProcess(
              '/usr/sbin/ioreg',
              ['-p', 'IOService', '-r', '-c', 'IOBlockStorageDriver', '-l', '-w0'],
              { timeout: 15000, maxOutput: 3 * 1024 * 1024, maxError: 2048 },
            ),
          report.device.name,
        );
        if (currentReport(device) !== report) throw backendError('readFileUpdated');
        return parseMacHostIo(output, report.device.name);
      });
      register('diagnostics:windowsTrim', async () => {
        const { queryWindowsTrim } = require('./platform/windows-trim.js');
        const { runTextProcess } = require('./security/text-process.js');
        return queryWindowsTrim({ runTextProcess });
      });
      registerHistoryIpc({
        register,
        currentReport,
        history,
        ipcValidate,
        getUserDataPath: () => app.getPath('userData'),
        getSettings: () => settings,
        getMainWindow: () => win,
        showSaveDialog: (owner, options) => dialog.showSaveDialog(owner, options),
        showOpenDialog: (owner, options) => dialog.showOpenDialog(owner, options),
        readLimitedJson,
        writeFile: fs.writeFile,
      });
      register('diagnostics:test', async (device, kind, reportId) => {
        const request = ipcValidate.testRequest(device, kind, reportId);
        await selfTests.start(request);
        return { message: getCatalogSection(settings.locale, 'smartView').selfTestStarted };
      });
      register('diagnostics:export', exportReport);
      // Do not create a renderer from 'activate' while async IPC setup is pending.
      appBootstrapped = true;
      logStartup('bootstrap-timing', Date.now() - mainEntryAt);
      createMainWindow();
      if (process.platform === 'linux') {
        // A read-only check and one native notice per launch; no automatic installs.
        void checkLinuxDependencies()
          .then((missing) =>
            showLinuxDependencyNotice(missing, {
              locale: settings.locale,
              dialog,
              clipboard,
              owner: win && !win.isDestroyed() ? win : undefined,
            }),
          )
          .catch((error) => logStartup('linux-dependency-check-failed', error?.code || 'unknown'));
      }
    })
    .catch((error) => {
      // Startup failures must be observable even without a React window.
      logStartup('startup-failed', typeof error?.code === 'string' ? error.code : 'startup');
      startupSplash?.close();
      startupSplash = null;
      dialog.showErrorBox(
        getCatalogSection(settings.locale, 'startup').startTitle,
        getCatalogSection(settings.locale, 'startup').startDetail,
      );
      app.exit(1);
    });
function createMainWindow() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1390,
    height: 860,
    minWidth: 1024,
    minHeight: 660,
    backgroundColor: '#0c1220',
    show: !startupSplash,
    title: 'DriveNX',
    ...(['win32', 'linux'].includes(process.platform)
      ? {
          icon: app.isPackaged
            ? path.join(process.resourcesPath, 'icon.png')
            : path.join(__dirname, '..', 'build', 'icon.png'),
        }
      : {}),
    webPreferences: { ...rendererWebPreferences },
  });
  attachStartupDiagnostics(win, 'main', logStartup, { locale: () => settings.locale });
  if (startupSplash) {
    // Do not reveal a blank main window; close the hint on first painted frame.
    const mainWindow = win;
    let revealed = false;
    function reveal() {
      if (revealed || mainWindow.isDestroyed()) return;
      revealed = true;
      mainWindow.show();
      logStartup('window-visible-timing', Date.now() - mainEntryAt);
      startupSplash?.close();
      startupSplash = null;
    }
    mainWindow.once('ready-to-show', reveal);
    // If the renderer cannot paint, show the main window so boot diagnostics
    // and error pages remain visible rather than hiding behind a stale splash.
    const fallback = setTimeout(reveal, 10000);
    fallback.unref?.();
    mainWindow.once('closed', () => clearTimeout(fallback));
    mainWindow.once('ready-to-show', () => clearTimeout(fallback));
  }
  restrictWindowNavigation(win);
  loadWindow(win);
  // Loading the renderer has priority over rebuilding the menu at startup.
  updateMenu();
  win.on('closed', () => {
    win = null;
  });
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (primaryInstance && appBootstrapped) createMainWindow();
});

function loadWindow(window, hash = '') {
  loadApplicationWindow(window, {
    packaged: app.isPackaged,
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    htmlPath: path.join(__dirname, '..', 'dist', 'index.html'),
    hash,
    logFailure: (reason) => logStartup('window-load-rejected', reason),
  });
}

function openPreferences() {
  if (preferencesWindow && !preferencesWindow.isDestroyed()) {
    if (preferencesWindow.isMinimized()) preferencesWindow.restore();
    preferencesWindow.show();
    preferencesWindow.focus();
    return;
  }
  preferencesWindow = new BrowserWindow({
    width: 740,
    height: 650,
    minWidth: 600,
    minHeight: 530,
    title: getCatalogSection(settings.locale, 'preferences').title,
    parent: process.platform === 'darwin' ? undefined : win,
    backgroundColor: '#101827',
    webPreferences: { ...rendererWebPreferences },
  });
  attachStartupDiagnostics(preferencesWindow, 'preferences', logStartup, {
    locale: () => settings.locale,
  });
  preferencesWindow.setMenuBarVisibility(false);
  restrictWindowNavigation(preferencesWindow);
  loadWindow(preferencesWindow, '#preferences');
  preferencesWindow.on('closed', () => {
    preferencesWindow = null;
  });
}

function openQueryLog() {
  if (queryLogWindow && !queryLogWindow.isDestroyed()) {
    if (queryLogWindow.isMinimized()) queryLogWindow.restore();
    queryLogWindow.show();
    queryLogWindow.focus();
    return;
  }
  queryLogWindow = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 700,
    minHeight: 450,
    title: `DriveNX – ${getCatalogSection(settings.locale, 'queryLog').title}`,
    parent: process.platform === 'darwin' ? undefined : win,
    backgroundColor: '#0c1220',
    webPreferences: { ...rendererWebPreferences },
  });
  attachStartupDiagnostics(queryLogWindow, 'query-log', logStartup, {
    locale: () => settings.locale,
  });
  queryLogWindow.setMenuBarVisibility(false);
  restrictWindowNavigation(queryLogWindow);
  loadWindow(queryLogWindow, '#query-log');
  queryLogWindow.on('closed', () => {
    queryLogWindow = null;
  });
}

function openLegalNotices() {
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    if (licenseWindow.isMinimized()) licenseWindow.restore();
    licenseWindow.show();
    licenseWindow.focus();
    return;
  }
  const locale = settings.locale;
  const heading = getCatalogSection(locale, 'menu').textLegalNotices.replace(/…$/, '');
  let content;
  try {
    content = createLicenseHtml({
      locale,
      context: {
        packaged: app.isPackaged,
        root: path.join(__dirname, '..'),
        resourcesPath: process.resourcesPath,
      },
    });
  } catch (error) {
    logStartup('license-file-unavailable', error?.code || 'unknown');
    dialog.showErrorBox(heading, getCatalogSection(locale, 'startup').legalError);
    return;
  }
  const viewer = new BrowserWindow({
    width: 890,
    height: 720,
    minWidth: 590,
    minHeight: 420,
    backgroundColor: '#0b1422',
    title: heading,
    parent: process.platform === 'darwin' ? undefined : win,
    webPreferences: { ...staticViewerWebPreferences },
  });
  licenseWindow = viewer;
  viewer.setMenuBarVisibility(false);
  restrictWindowNavigation(viewer);
  // All navigations are denied. This single, exact local-UI action can only
  // display the bundled Chromium notices, never open an external website.
  viewer.webContents.on('will-navigate', (_event, details) => {
    if (details?.url === CHROMIUM_NOTICE_URL) openChromiumLicenses();
  });
  void Promise.resolve(
    viewer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`),
  ).catch((error) => logStartup('license-viewer-load-failed', error?.code || 'unknown'));
  viewer.on('closed', () => {
    if (licenseWindow === viewer) licenseWindow = null;
  });
}
function openAbout() {
  // The native macOS About panel left-aligns the credits and breaks long links.
  // Use a small static, sandboxed window on macOS for a consistent layout.
  if (process.platform !== 'darwin') {
    showNativeAbout({
      app,
      locale: settings.locale,
      platform: process.platform,
      root: path.join(__dirname, '..'),
      resourcesPath: process.resourcesPath,
      packaged: app.isPackaged,
    });
    return;
  }
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    if (aboutWindow.isMinimized()) aboutWindow.restore();
    aboutWindow.show();
    aboutWindow.focus();
    return;
  }
  let content;
  try {
    content = createAboutHtml({
      locale: settings.locale,
      version: app.getVersion(),
      iconPath: app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(__dirname, '..', 'build', 'icon.png'),
    });
  } catch (error) {
    logStartup('about-icon-unavailable', error?.code || 'unknown');
    showNativeAbout({
      app,
      locale: settings.locale,
      platform: process.platform,
      root: path.join(__dirname, '..'),
      resourcesPath: process.resourcesPath,
      packaged: app.isPackaged,
    });
    return;
  }
  const viewer = new BrowserWindow({
    width: 420,
    height: 420,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    title: 'DriveNX',
    parent: win,
    backgroundColor: '#141922',
    webPreferences: { ...staticViewerWebPreferences },
  });
  aboutWindow = viewer;
  viewer.setMenuBarVisibility(false);
  restrictWindowNavigation(viewer);
  viewer.once('ready-to-show', () => viewer.show());
  void Promise.resolve(
    viewer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`),
  ).catch((error) => {
    logStartup('about-viewer-load-failed', error?.code || 'unknown');
    if (!viewer.isDestroyed()) viewer.close();
  });
  viewer.on('closed', () => {
    if (aboutWindow === viewer) aboutWindow = null;
  });
}
function openChromiumLicenses() {
  const files = chromiumLicenseCandidates({
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    platform: process.platform,
  });
  const file = files.find((candidate) => require('node:fs').existsSync(candidate));
  if (!file) {
    dialog.showErrorBox(
      'DriveNX – Chromium / Node.js',
      getCatalogSection(settings.locale, 'startup').runtimeMissing,
    );
    return;
  }
  // Keep Chromium's original copyright/license HTML unmodified and local.
  // This dedicated sandboxed window cannot execute JavaScript or navigate away.
  if (chromiumLicenseWindow && !chromiumLicenseWindow.isDestroyed()) {
    if (chromiumLicenseWindow.isMinimized()) chromiumLicenseWindow.restore();
    chromiumLicenseWindow.show();
    chromiumLicenseWindow.focus();
    return;
  }
  const viewer = new BrowserWindow({
    width: 1050,
    height: 760,
    minWidth: 650,
    minHeight: 450,
    title: 'DriveNX – Chromium / Node.js',
    parent: process.platform === 'darwin' ? undefined : win,
    backgroundColor: '#0b1422',
    webPreferences: { ...staticViewerWebPreferences },
  });
  chromiumLicenseWindow = viewer;
  viewer.setMenuBarVisibility(false);
  restrictWindowNavigation(viewer);
  void Promise.resolve(viewer.loadFile(file)).catch((error) => {
    logStartup('chromium-license-load-failed', error?.code || 'unknown');
    dialog.showErrorBox(
      'DriveNX – Chromium / Node.js',
      getCatalogSection(settings.locale, 'startup').runtimeOpenError,
    );
  });
  viewer.on('closed', () => {
    if (chromiumLicenseWindow === viewer) chromiumLicenseWindow = null;
  });
}
function updateMenu() {
  return createAppMenu({
    Menu,
    app,
    settings,
    openPreferences,
    openQueryLog,
    openLegalNotices,
    openAbout,
    getWindow: () => win,
  });
}

if (process.platform === 'linux') app.on('will-quit', () => linuxSmartSession.stop());
