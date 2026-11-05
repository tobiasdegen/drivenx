const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMenu } = require('../../electron/ui/app-menu.js');
const { version: APP_VERSION } = require('../../package.json');
test('localized menu builds for Windows without a window', () => {
  let template;
  const Menu = {
    buildFromTemplate: (x) => {
      template = x;
      return x;
    },
    setApplicationMenu: () => {},
  };
  const app = {
    name: 'DriveNX',
    isPackaged: true,
    setAboutPanelOptions: () => {},
    showAboutPanel: () => {},
    getVersion: () => APP_VERSION,
  };
  buildMenu({
    Menu,
    app,
    settings: { locale: 'de-DE' },
    openPreferences: () => {},
    getWindow: () => null,
    platform: 'win32',
  });
  assert.ok(template.some((x) => x.label === 'Datei'));
  assert.ok(!template.some((x) => x.label === 'Bearbeiten'));
  assert.ok(!JSON.stringify(template).includes('toggleDevTools'));
});
test('developer menu appears in unpackaged builds', () => {
  let template;
  const Menu = {
    buildFromTemplate: (x) => {
      template = x;
      return x;
    },
    setApplicationMenu: () => {},
  };
  const app = {
    name: 'DriveNX',
    isPackaged: false,
    setAboutPanelOptions: () => {},
    showAboutPanel: () => {},
    getVersion: () => APP_VERSION,
  };
  buildMenu({
    Menu,
    app,
    settings: { locale: 'en-US' },
    openPreferences: () => {},
    getWindow: () => null,
  });
  assert.ok(JSON.stringify(template).includes('toggleDevTools'));
});

test('macOS keeps conventional File and Edit menus', () => {
  let template;
  const Menu = {
    buildFromTemplate: (x) => {
      template = x;
      return x;
    },
    setApplicationMenu: () => {},
  };
  const app = {
    name: 'DriveNX',
    isPackaged: true,
    setAboutPanelOptions: () => {},
    showAboutPanel: () => {},
    getVersion: () => APP_VERSION,
  };
  buildMenu({
    Menu,
    app,
    settings: { locale: 'de-DE' },
    openPreferences: () => {},
    getWindow: () => null,
    platform: 'darwin',
  });
  assert.ok(template.some((x) => x.label === 'Ablage'));
  assert.ok(template.some((x) => x.label === 'Bearbeiten'));
});

test('View menu follows UI tab order with separate query results', () => {
  let template;
  const Menu = {
    buildFromTemplate: (x) => {
      template = x;
      return x;
    },
    setApplicationMenu: () => {},
  };
  const app = {
    name: 'DriveNX',
    isPackaged: true,
    setAboutPanelOptions: () => {},
    getVersion: () => APP_VERSION,
  };
  buildMenu({
    Menu,
    app,
    settings: { locale: 'de-DE' },
    openPreferences: () => {},
    getWindow: () => null,
    platform: 'win32',
  });
  const view = template.find((item) => item.label === 'Ansicht');
  assert.deepEqual(
    view.submenu.filter((item) => item.click).map((item) => item.label),
    [
      'Übersicht',
      'Hardware und Anschluss',
      'Messhistorie',
      'SMART-Attribute',
      'Selbsttests',
      'Fehlerprotokoll',
      'Abfrageprotokoll…',
    ],
  );
});

test('native About and one legal notices entry are exposed without duplicates on both platforms', () => {
  for (const platform of ['darwin', 'win32']) {
    let menu;
    let aboutOpened = 0;
    let legalOpened = 0;
    const Menu = {
      buildFromTemplate: (input) => ((menu = input), input),
      setApplicationMenu: () => {},
    };
    buildMenu({
      Menu,
      app: { name: 'DriveNX', isPackaged: true },
      platform,
      settings: { locale: 'de-DE' },
      getWindow: () => null,
      openPreferences: () => {},
      openAbout: () => {
        aboutOpened++;
      },
      openLegalNotices: () => {
        legalOpened++;
      },
    });
    const appMenu = platform === 'darwin' ? menu[0] : null;
    const help = menu.find((entry) => entry.label === 'Hilfe');
    const about = (platform === 'darwin' ? appMenu : help).submenu.find(
      (item) => item.label === 'Über DriveNX',
    );
    assert.ok(about);
    assert.equal(help.submenu.filter((item) => item.label === 'Rechtliche Hinweise…').length, 1);
    if (platform === 'darwin')
      assert.equal(
        help.submenu.some((item) => item.label === 'Über DriveNX'),
        false,
      );
    assert.equal(
      appMenu?.submenu.some((item) => item.label === 'Rechtliche Hinweise…') ?? false,
      false,
    );
    assert.equal(JSON.stringify(menu).includes('Drittanbieter-Lizenzen…'), false);
    about.click();
    help.submenu.find((item) => item.label === 'Rechtliche Hinweise…').click();
    assert.equal(aboutOpened, 1);
    assert.equal(legalOpened, 1);
  }
});

test('macOS View menu avoids a duplicate native Full Screen entry', () => {
  for (const platform of ['darwin', 'win32']) {
    let template;
    const Menu = {
      buildFromTemplate: (value) => {
        template = value;
        return value;
      },
      setApplicationMenu: () => {},
    };
    buildMenu({
      Menu,
      platform,
      app: { name: 'DriveNX', isPackaged: true, getVersion: () => APP_VERSION },
      settings: { locale: 'de-DE' },
      getWindow: () => null,
      openPreferences: () => {},
    });
    const view = template.find((menu) => menu.label === 'Ansicht');
    assert.equal(
      view.submenu.filter((entry) => entry.role === 'togglefullscreen').length,
      platform === 'darwin' ? 0 : 1,
    );
    assert.ok(
      template.some(
        (menu) =>
          menu.label === 'Fenster' && menu.submenu.some((item) => item.label === 'Minimieren'),
      ),
      'localized window menu preserved',
    );
  }
});

test('Windows window menu performs maximize/restore instead of Mac-only zoom role', () => {
  let template;
  let maximized = false;
  const window = {
    isDestroyed: () => false,
    isMaximized: () => maximized,
    maximize: () => {
      maximized = true;
    },
    unmaximize: () => {
      maximized = false;
    },
  };
  buildMenu({
    Menu: { buildFromTemplate: (x) => ((template = x), x), setApplicationMenu: () => {} },
    app: { name: 'DriveNX', isPackaged: true, getVersion: () => APP_VERSION },
    settings: { locale: 'de-DE' },
    getWindow: () => window,
    openPreferences: () => {},
    platform: 'win32',
  });
  const menu = template.find((item) => item.label === 'Fenster');
  const item = menu.submenu.find((entry) => entry.label === 'Maximieren / Wiederherstellen');
  assert.ok(item);
  item.click();
  assert.equal(maximized, true);
  item.click();
  assert.equal(maximized, false);
});
