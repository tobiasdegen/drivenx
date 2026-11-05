'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isMainFrameSender } = require('../../electron/ipc/ipc-sender.js');

test('only a live top-level Electron frame may invoke the main IPC router', () => {
  const mainFrame = { url: 'file:///app/index.html' };
  const sender = { isDestroyed: () => false, mainFrame, id: 12 };
  assert.equal(isMainFrameSender({ sender, senderFrame: mainFrame }), true);
  // A nested frame can have the same origin and webContents ID as the main frame.
  assert.equal(isMainFrameSender({ sender, senderFrame: { url: mainFrame.url } }), false);
  assert.equal(isMainFrameSender({ sender, senderFrame: null }), false);
  assert.equal(
    isMainFrameSender({ sender: { ...sender, isDestroyed: () => true }, senderFrame: mainFrame }),
    false,
  );
  assert.equal(isMainFrameSender({ sender: { id: 12 }, senderFrame: mainFrame }), false);
  assert.equal(isMainFrameSender(null), false);
});

test('all registered application IPC requests use the top-level frame gate', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, 'main.js'), 'utf8');
  assert.match(main, /createIpcRegistrar\(\{/);
  assert.match(main, /isMainFrameSender\(event\)/);
});

test('Electron frame wrappers with matching process and routing IDs are accepted', () => {
  const mainFrame = { routingId: 42, processId: 7 };
  const sender = { isDestroyed: () => false, mainFrame };
  assert.equal(isMainFrameSender({ sender, senderFrame: { ...mainFrame } }), true);
  assert.equal(isMainFrameSender({ sender, senderFrame: { routingId: 43, processId: 7 } }), false);
  assert.equal(isMainFrameSender({ sender, senderFrame: { routingId: 42, processId: 8 } }), false);
});
