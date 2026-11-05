'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIpcRegistrar } = require('../../electron/ipc/ipc-registrar.js');
const { isMainFrameSender } = require('../../electron/ipc/ipc-sender.js');

function harness() {
  const channels = new Map();
  const register = createIpcRegistrar({
    ipcMain: { handle: (channel, handler) => channels.set(channel, handler) },
    authorize: (event, channel) => isMainFrameSender(event) && channel !== 'restricted',
    unauthorizedMessage: () => 'Keine Berechtigung',
    serializeError: (error) => (error instanceof Error ? error.message : 'Fehler'),
  });
  const frame = { routingId: 5, processId: 2 };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  return { channels, register, frame, sender };
}

test('authorized IPC returns the existing success envelope and forwarded arguments', async () => {
  const h = harness();
  h.register('echo', async (...args) => args);
  assert.deepEqual(
    await h.channels.get('echo')({ sender: h.sender, senderFrame: h.frame }, 1, 'x'),
    {
      ok: true,
      value: [1, 'x'],
    },
  );
});

test('a nested frame or channel not on the allowed list never calls a privileged handler', async () => {
  const h = harness();
  let executed = 0;
  h.register('echo', () => {
    executed++;
  });
  h.register('restricted', () => {
    executed++;
  });
  assert.deepEqual(
    await h.channels.get('echo')({ sender: h.sender, senderFrame: { routingId: 3, processId: 2 } }),
    { ok: false, error: 'Keine Berechtigung' },
  );
  assert.deepEqual(await h.channels.get('restricted')({ sender: h.sender, senderFrame: h.frame }), {
    ok: false,
    error: 'Keine Berechtigung',
  });
  assert.equal(executed, 0);
});

test('exception while inspecting sender fails closed without triggering the handler', async () => {
  const h = harness();
  h.register('echo', () => {
    throw Error('handler must never run');
  });
  const sender = {
    get mainFrame() {
      throw Error('renderer exited');
    },
    isDestroyed: () => false,
  };
  assert.deepEqual(await h.channels.get('echo')({ sender, senderFrame: h.frame }), {
    ok: false,
    error: 'Keine Berechtigung',
  });
});

test('handler rejection is returned in the normal error envelope', async () => {
  const h = harness();
  h.register('fail', async () => {
    throw Error('Read failed');
  });
  assert.deepEqual(await h.channels.get('fail')({ sender: h.sender, senderFrame: h.frame }), {
    ok: false,
    error: 'Read failed',
  });
});
