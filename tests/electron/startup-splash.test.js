'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createStartupSplash,
  splashHtml,
  DELAY_MS,
} = require('../../electron/ui/startup-splash.js');

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.shows = 0;
    this.url = '';
  }
  loadURL(url) {
    this.url = url;
    return Promise.resolve();
  }
  isDestroyed() {
    return this.destroyed;
  }
  show() {
    this.shows++;
  }
  destroy() {
    this.destroyed = true;
  }
}

function fixture() {
  const scheduled = [];
  const canceled = [];
  const logs = [];
  let window;
  const splash = createStartupSplash({
    BrowserWindow: class extends FakeBrowserWindow {
      constructor(options) {
        super(options);
        window = this;
      }
    },
    locale: 'de-DE',
    iconPath: 'C:\\Program Files\\DriveNX\\icon.png',
    restrictNavigation: (win) => assert.ok(win instanceof FakeBrowserWindow),
    log: (tag) => logs.push(tag),
    schedule: (fn, delay) => {
      assert.equal(delay, DELAY_MS);
      const token = { fn };
      scheduled.push(token);
      return token;
    },
    cancel: (token) => canceled.push(token),
  });
  return { splash, window, scheduled, canceled, logs };
}

test('splash has no scripts, preload, web access or privileged bridge', () => {
  const { splash, window } = fixture();
  assert.equal(window.options.show, false);
  assert.equal(window.options.webPreferences.javascript, false);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.preload, undefined);
  assert.match(decodeURIComponent(window.url), /default-src 'none'/);
  assert.match(decodeURIComponent(window.url), /Wird gestartet/);
  assert.doesNotMatch(splashHtml('en-US'), /<script/i);
  assert.match(splashHtml('en-US'), /Starting/);
  splash.close();
});

test('fast startup does not display the splash', () => {
  const { splash, window, scheduled, canceled, logs } = fixture();
  window.emit('ready-to-show');
  splash.close();
  scheduled[0].fn();
  assert.equal(window.shows, 0);
  assert.equal(window.destroyed, true);
  assert.equal(canceled.length, 1);
  assert.deepEqual(logs, []);
  splash.close();
  assert.equal(canceled.length, 1);
});

test('slow startup shows the splash only after both timer and paint', () => {
  const { splash, window, scheduled, logs } = fixture();
  scheduled[0].fn();
  assert.equal(window.shows, 0);
  window.emit('ready-to-show');
  assert.equal(window.shows, 1);
  assert.deepEqual(logs, ['splash-visible']);
  splash.close();
  assert.equal(window.destroyed, true);
});
