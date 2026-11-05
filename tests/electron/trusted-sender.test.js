'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trustedSender } = require('../../electron/ipc/trusted-sender.js');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const win = { isDestroyed: () => false, webContents: { id: 10 } };
const opts = {
  senderId: 10,
  mainWindow: win,
  preferencesWindow: null,
  packaged: false,
  htmlPath: path.resolve('test-app', 'dist', 'index.html'),
};
test('built file URL accepted for npm start', () => {
  const builtUrl = pathToFileURL(opts.htmlPath).href;
  assert.equal(trustedSender({ ...opts, frameUrl: builtUrl }), true);
  assert.equal(trustedSender({ ...opts, frameUrl: `${builtUrl}#preferences` }), false);
});
test('dev-server URL accepted only in dev mode', () => {
  assert.equal(
    trustedSender({
      ...opts,
      devServerUrl: 'http://127.0.0.1:5173',
      frameUrl: 'http://127.0.0.1:5173/',
    }),
    true,
  );
  assert.equal(trustedSender({ ...opts, frameUrl: 'http://127.0.0.1:5173/#preferences' }), false);
});
test('reject other URLs, senders, fragments and paths', () => {
  const builtUrl = pathToFileURL(opts.htmlPath).href;
  for (const frameUrl of [
    'https://example.org/',
    pathToFileURL(path.join(path.dirname(opts.htmlPath), 'bad.html')).href,
    `${builtUrl}#evil`,
    `${builtUrl}?x=1`,
  ])
    assert.equal(trustedSender({ ...opts, frameUrl }), false);
  assert.equal(trustedSender({ ...opts, senderId: 99, frameUrl: builtUrl }), false);
});

test('each window is authorized only on its assigned URL fragment', () => {
  const builtUrl = pathToFileURL(opts.htmlPath).href;
  const preferences = { isDestroyed: () => false, webContents: { id: 11 } };
  const log = { isDestroyed: () => false, webContents: { id: 12 } };
  const windows = { ...opts, preferencesWindow: preferences, queryWindow: log };
  assert.equal(
    trustedSender({ ...windows, senderId: 11, frameUrl: `${builtUrl}#preferences` }),
    true,
  );
  assert.equal(
    trustedSender({ ...windows, senderId: 12, frameUrl: `${builtUrl}#query-log` }),
    true,
  );
  for (const hash of ['', '#preferences', '#evil']) {
    assert.equal(
      trustedSender({ ...windows, senderId: 12, frameUrl: `${builtUrl}${hash}` }),
      false,
    );
  }
  assert.equal(
    trustedSender({ ...windows, senderId: 10, frameUrl: `${builtUrl}#query-log` }),
    false,
  );
});
