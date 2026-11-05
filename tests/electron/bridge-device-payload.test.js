'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

function bridgeWithTransport(invoke) {
  let bridge;
  runInNewContext(readFileSync(join(ELECTRON_SOURCE_DIR, 'preload.js'), 'utf8'), {
    require(id) {
      assert.equal(id, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld: (_, methods) => {
            bridge = methods;
          },
        },
        ipcRenderer: { invoke, on() {}, removeListener() {} },
      };
    },
  });
  return bridge;
}

// A device scan contains OS and adapter metadata for display. None of it is
// required to authorize hardware operations, and no caller should send it
// back across the renderer/main trust boundary.
test('all device-bound IPC actions forward only the device access identity', async () => {
  const calls = [];
  const bridge = bridgeWithTransport(async (channel, ...args) => {
    calls.push({ channel, args });
    return { ok: true, value: {} };
  });
  const fullDevice = {
    name: '/dev/disk7',
    type: 'sntjmicron',
    info_name: 'Example NVMe SSD',
    capacityBytes: 123456789,
    transport: 'USB',
    internal: false,
    osMetadata: { serial: 'PRIVATE', mediaName: 'Example' },
    connection: { verified: true, chain: [{ name: 'Bridge', serial: 'PRIVATE' }] },
  };
  const reportId = '9fc93bcf-58fd-4bcc-bcee-e60e5f6c0b65';
  await bridge.detail(fullDevice, true);
  await bridge.selectAccessMode(fullDevice, 'sat', 3);
  await bridge.history(fullDevice, reportId);
  await bridge.saveHistory(fullDevice, reportId);
  await bridge.importHistory(fullDevice, reportId);
  await bridge.exportHistory(fullDevice, reportId);
  await bridge.macHostIo(fullDevice, reportId);
  await bridge.test(fullDevice, 'short', reportId);
  await bridge.exportReport(fullDevice, 'pdf', 'de-DE', reportId);
  assert.deepEqual(
    calls.map((call) => call.channel),
    [
      'diagnostics:detail',
      'diagnostics:selectAccessMode',
      'diagnostics:history',
      'diagnostics:saveHistory',
      'diagnostics:importHistory',
      'diagnostics:exportHistory',
      'diagnostics:macHostIo',
      'diagnostics:test',
      'diagnostics:export',
    ],
  );
  assert.equal(calls[1].args[1], 'sat');
  assert.equal(calls[1].args[2], 3);
  for (const { args } of calls) {
    assert.deepEqual(Object.keys(args[0]).sort(), ['name', 'type']);
    assert.equal(args[0].name, fullDevice.name);
    assert.equal(args[0].type, fullDevice.type);
    assert.notStrictEqual(args[0], fullDevice);
  }
  assert.deepEqual(
    Object.keys(fullDevice).sort(),
    [
      'name',
      'type',
      'info_name',
      'capacityBytes',
      'transport',
      'internal',
      'osMetadata',
      'connection',
    ].sort(),
    'the original display metadata remains intact in the renderer',
  );
});

test('invalid renderer device identity is still rejected by backend validation', () => {
  const { device } = require('../../electron/ipc/ipc-validation.js');
  assert.deepEqual(
    device({ name: '/dev/disk7', type: 'sntjmicron', connection: { serial: 'x' } }),
    { name: '/dev/disk7', type: 'sntjmicron' },
  );
  for (const invalid of [null, {}, { name: '/dev/disk7' }, { name: '/dev/disk7', type: 5 }]) {
    assert.throws(() => device(invalid), /Laufwerksauswahl/);
  }
});
