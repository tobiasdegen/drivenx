'use strict';
const { getCatalogSection } = require('./translator.js');
function buildMenu({
  Menu,
  app,
  settings,
  openPreferences,
  openQueryLog = () => {},
  openLegalNotices = () => {},
  openAbout = () => {},
  getWindow,
  platform = process.platform,
}) {
  const win = getWindow();
  const t = getCatalogSection(settings.locale, 'menu');
  const send = (command) => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.webContents.send('diagnostics:menu-command', command);
    }
  };
  const about = () => openAbout();
  const settingsItem = {
    label: t.textSettings,
    accelerator: 'CmdOrCtrl+,',
    click: openPreferences,
  };
  const file = {
    label: platform === 'darwin' ? t.fileMac : t.file,
    submenu: [
      {
        label: t.textRefreshDrives,
        accelerator: 'CmdOrCtrl+R',
        click: () => send('scan'),
      },
      {
        label: t.textExportPdfReport,
        accelerator: 'CmdOrCtrl+E',
        click: () => send('pdf'),
      },
      { label: t.textExportSmartJson, click: () => send('json') },
      { label: t.textExportHtmlReport, click: () => send('html') },
      { type: 'separator' },
      ...(platform === 'darwin' ? [] : [settingsItem, { type: 'separator' }]),
      { role: 'quit', label: t.textQuit },
    ],
  };
  const edit = {
    label: t.textEdit,
    submenu: [
      { role: 'undo', label: t.textUndo },
      { role: 'redo', label: t.textRedo },
      { type: 'separator' },
      { role: 'cut', label: t.textCut },
      { role: 'copy', label: t.textCopy },
      { role: 'paste', label: t.textPaste },
      { role: 'selectAll', label: t.textSelectAll },
    ],
  };
  const view = {
    label: t.textView,
    submenu: [
      { label: t.textOverview, click: () => send('overview') },
      {
        label: t.textHardwareAndConnection,
        click: () => send('hardware'),
      },
      { label: t.textMeasurementHistory, click: () => send('history') },
      { label: t.textSmartAttributes, click: () => send('attributes') },
      { label: t.textSelfTests, click: () => send('tests') },
      { label: t.textErrorLog, click: () => send('errors') },
      { type: 'separator' },
      { label: t.textQueryLog, accelerator: 'CmdOrCtrl+Shift+L', click: openQueryLog },
      { type: 'separator' },
      // The macOS native Window menu already provides Full Screen.
      ...(platform === 'darwin' ? [] : [{ role: 'togglefullscreen', label: t.textFullScreen }]),
      ...(!app.isPackaged
        ? [
            {
              role: 'toggleDevTools',
              label: t.textDeveloperTools,
              accelerator: 'CmdOrCtrl+Shift+I',
            },
          ]
        : []),
    ],
  };
  const help = {
    label: t.textHelp,
    submenu: [
      ...(platform === 'darwin' ? [] : [{ label: t.textAboutDriveNX, click: about }]),
      { label: t.textLegalNotices, click: openLegalNotices },
    ],
  };
  const template = [
    ...(platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { label: t.textAboutDriveNX, click: about },
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services', label: t.textServices },
              { type: 'separator' },
              { role: 'hide', label: t.textHideDriveNX },
              { role: 'hideOthers', label: t.textHideOthers },
              { role: 'unhide', label: t.textShowAll },
              { type: 'separator' },
              { role: 'quit', label: t.textQuitDriveNX },
            ],
          },
        ]
      : []),
    file,
    ...(platform === 'darwin' ? [edit] : []),
    view,
    {
      label: t.textWindow,
      submenu: [
        { role: 'minimize', label: t.textMinimize },
        ...(platform === 'darwin'
          ? [{ role: 'zoom', label: t.textZoom }]
          : [
              {
                label: t.textMaxRestore,
                click: () => {
                  const target = getWindow();
                  if (!target || target.isDestroyed()) return;
                  if (target.isMaximized()) target.unmaximize();
                  else target.maximize();
                },
              },
            ]),
        ...(platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front', label: t.textBringToFront }]
          : []),
        { type: 'separator' },
        { role: 'close', label: t.textClose },
      ],
    },
    help,
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
