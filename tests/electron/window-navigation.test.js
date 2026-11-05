'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApplicationWindow } = require('../../electron/ui/window-navigation.js');

const options = { packaged: true, htmlPath: '/project/dist/index.html' };

test('packaged window loads the expected entry and authorized hash', () => {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    loadFile: (file, opt) => {
      calls.push([file, opt]);
      return Promise.resolve();
    },
    loadURL: () => {
      throw Error('unexpected dev URL');
    },
  };
  loadApplicationWindow(window, { ...options, hash: '#query-log' });
  assert.deepEqual(calls, [[path.resolve(options.htmlPath), { hash: 'query-log' }]]);
});

test('development window loads original dev URL and hash', () => {
  let loaded;
  loadApplicationWindow(
    {
      isDestroyed: () => false,
      loadURL: (url) => {
        loaded = url;
        return Promise.resolve();
      },
      loadFile: () => {
        throw Error('unexpected file');
      },
    },
    { ...options, packaged: false, devServerUrl: 'http://127.0.0.1:5173/', hash: '#preferences' },
  );
  assert.equal(loaded, 'http://127.0.0.1:5173/#preferences');
});

test('synchronous and asynchronous failures are consumed and logged without throwing', async () => {
  const errors = [];
  const base = { ...options, logFailure: (code) => errors.push(code) };
  loadApplicationWindow(
    {
      isDestroyed: () => false,
      loadFile: () => {
        throw Object.assign(new Error('not readable'), { code: 'ENOENT' });
      },
    },
    base,
  );
  loadApplicationWindow(
    {
      isDestroyed: () => false,
      loadFile: () => Promise.reject(new Error('failed to navigate')),
    },
    base,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, ['ENOENT', 'NAVIGATION_FAILED']);
});

test('destroyed windows are not loaded or logged after rejected navigation', async () => {
  let destroyed = false;
  let rejectLoad;
  const logs = [];
  const window = {
    isDestroyed: () => destroyed,
    loadFile: () =>
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
  };
  loadApplicationWindow(window, { ...options, logFailure: (code) => logs.push(code) });
  destroyed = true;
  rejectLoad(Error('window closed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(logs, []);
});

test('all renderer windows deny navigation, redirects and new windows', () => {
  const { restrictWindowNavigation } = require('../../electron/ui/window-navigation.js');
  const listeners = new Map();
  let openHandler;
  restrictWindowNavigation({
    webContents: {
      setWindowOpenHandler: (callback) => {
        openHandler = callback;
      },
      on: (event, callback) => {
        listeners.set(event, callback);
      },
    },
  });
  assert.deepEqual(openHandler(), { action: 'deny' });
  assert.deepEqual([...listeners.keys()], ['will-navigate', 'will-redirect']);
  for (const handler of listeners.values()) {
    let prevented = false;
    handler({
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
  }
});
