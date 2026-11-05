'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const path = require('node:path');

const source = (name) => readFileSync(path.join(ELECTRON_SOURCE_DIR, name), 'utf8');

test('the public preload bridge exposes only registered main-process IPC channels', async () => {
  const called = new Set();
  let bridge;
  runInNewContext(source('preload.js'), {
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (_name, methods) => (bridge = methods) },
        ipcRenderer: {
          invoke: async (channel) => {
            called.add(channel);
            return { ok: true, value: null };
          },
          on() {},
          removeListener() {},
        },
      };
    },
  });
  assert.ok(bridge && Object.isFrozen(bridge));
  const contract = readFileSync(
    path.join(ELECTRON_SOURCE_DIR, '..', 'src', 'ipc-contract.ts'),
    'utf8',
  );
  const interfaceBody = contract
    .split('export interface DiagnosticsBridge {')[1]
    ?.split('\n}\n')[0];
  assert.ok(interfaceBody, 'DiagnosticsBridge interface is present');
  const typedMethods = [...interfaceBody.matchAll(/^ {2}(\w+)\(/gm)].map((match) => match[1]);
  assert.deepEqual(Object.keys(bridge).sort(), typedMethods.sort());
  for (const [method, invoke] of Object.entries(bridge)) {
    if (method.startsWith('on')) continue; // Event subscriptions use ipcRenderer.on, not invoke.
    await invoke({ name: '/dev/sda', type: 'sat' }, 'short', 1, 'de-DE');
  }
  const registered = new Set();
  for (const name of ['main.js', 'ipc/history-ipc.js', 'ipc/query-log-ipc.js']) {
    for (const match of source(name).matchAll(/\bregister\(\s*['"](diagnostics:[^'"]+)['"]/g)) {
      registered.add(match[1]);
    }
  }
  assert.ok(registered.size > 0, 'main-process IPC channel registration was found');
  assert.deepEqual([...called].sort(), [...registered].sort());
});
