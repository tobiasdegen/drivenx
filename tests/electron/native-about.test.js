'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { showNativeAbout, createAboutHtml } = require('../../electron/ui/native-about.js');
const { version: APP_VERSION } = require('../../package.json');

test('native About shows compact, localized information on macOS', () => {
  let opts;
  let shown = 0;
  const app = {
    getVersion: () => APP_VERSION,
    setAboutPanelOptions: (x) => {
      opts = x;
    },
    showAboutPanel: () => {
      shown++;
    },
  };
  showNativeAbout({
    app,
    locale: 'de-DE',
    platform: 'darwin',
    root: '/project',
    resourcesPath: '/bundle',
    packaged: true,
  });
  assert.equal(shown, 1);
  assert.equal(opts.applicationName, 'DriveNX');
  assert.equal(opts.applicationVersion, APP_VERSION);
  assert.match(opts.copyright, /Tobias Degen/);
  assert.match(opts.credits, /MIT-Lizenz/);
  assert.equal(opts.iconPath, undefined);
});

test('native Windows About uses the packaged icon and English credits', () => {
  let opts;
  const app = {
    getVersion: () => APP_VERSION,
    setAboutPanelOptions: (x) => {
      opts = x;
    },
    showAboutPanel: () => {},
  };
  showNativeAbout({
    app,
    locale: 'en-US',
    platform: 'win32',
    root: '/project',
    resourcesPath: '/bundle',
    packaged: true,
  });
  assert.equal(opts.iconPath, path.join('/bundle', 'icon.png'));
  assert.match(opts.credits, /MIT License/);
});

test('native Linux About uses packaged Linux icon and author information', () => {
  let options;
  const app = {
    getVersion: () => APP_VERSION,
    setAboutPanelOptions: (value) => {
      options = value;
    },
    showAboutPanel: () => {},
  };
  showNativeAbout({
    app,
    locale: 'en-US',
    platform: 'linux',
    root: '/project',
    resourcesPath: '/bundle',
    packaged: true,
  });
  assert.equal(options.iconPath, path.join('/bundle', 'icon.png'));
  assert.deepEqual(options.authors, ['Tobias Degen']);
});

test('centered About HTML uses the bundled icon and never enables scripts', () => {
  const html = createAboutHtml({
    locale: 'de-DE',
    version: APP_VERSION,
    iconPath: path.resolve(__dirname, '../../build/icon.png'),
  });
  assert.match(html, /text-align:center/);
  assert.match(html, /data:image\/png;base64,/);
  assert.ok(html.includes(`Version ${APP_VERSION}`));
  assert.match(html, /MIT-Lizenz/);
  assert.match(html, /Rechtliche Hinweise/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /<script\b/i);
});
