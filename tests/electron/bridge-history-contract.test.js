'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { join } = require('node:path');

// Execute the real preload bridge with a substituted Electron transport.
// This checks argument flow, rather than matching Prettier-sensitive source lines.
test('history IPC bridge forwards the exact reportId with every action', async () => {
  const calls = [];
  let exposed;
  const ipcRenderer = {
    invoke: async (channel, ...args) => {
      calls.push({ channel, args });
      return { ok: true, value: { available: true, records: [] } };
    },
    on() {},
    removeListener() {},
  };
  const electron = {
    contextBridge: {
      exposeInMainWorld: (key, bridge) => {
        assert.equal(key, 'diagnostics');
        exposed = bridge;
      },
    },
    ipcRenderer,
  };
  const code = readFileSync(join(ELECTRON_SOURCE_DIR, 'preload.js'), 'utf8');
  runInNewContext(code, {
    require: (id) => {
      assert.equal(id, 'electron');
      return electron;
    },
  });
  assert.ok(Object.isFrozen(exposed));
  const device = { name: '/dev/disk5', type: 'sat' };
  const reportId = '12345678-1234-4234-9234-123456789abc';
  await exposed.history(device, reportId);
  await exposed.saveHistory(device, reportId);
  await exposed.exportHistory(device, reportId);
  await exposed.importHistory(device, reportId);
  assert.deepEqual(
    calls.map(({ channel, args }) => ({
      channel,
      name: args[0]?.name,
      type: args[0]?.type,
      reportId: args[1],
      argc: args.length,
    })),
    ['history', 'saveHistory', 'exportHistory', 'importHistory'].map((name) => ({
      channel: `diagnostics:${name}`,
      name: '/dev/disk5',
      type: 'sat',
      reportId,
      argc: 2,
    })),
  );
});
