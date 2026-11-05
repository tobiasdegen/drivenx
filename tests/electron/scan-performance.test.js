'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === 'electron') return { app: { isPackaged: false } };
  return originalLoad.call(this, id, ...args);
};
const { scanDevices } = require('../../electron/devices/smart.js');
Module._load = originalLoad;

const listed = (devices) => ({ json: { smartctl: {}, devices }, exitCode: 0 });

test('ambiguous JMicron adapter is listed without blocking on scan-open', async () => {
  const calls = [];
  const { devices } = await scanDevices('auto', {
    platform: 'win32',
    runSmartProbe: async (args, timeout) => {
      calls.push({ args, timeout });
      if (args[0] === '--scan-open')
        return listed([{ name: '/dev/sda', type: 'sat', info_name: 'USB SATA' }]);
      if (args[0] === '--scan')
        return listed([
          { name: '/dev/sda', type: 'sntjmicron', info_name: 'USB JMicron' },
          { name: '/dev/sdb', type: 'nvme' },
        ]);
      throw new Error('unexpected identity read');
    },
  });
  assert.deepEqual(
    calls.map((c) => c.args[0]),
    ['--scan'],
  );
  assert.ok(calls.every((c) => c.timeout === 25000));
  assert.equal(devices[0].requiresUsbChoice, true);
  assert.deepEqual(
    devices.map((d) => [d.name, d.type]),
    [
      ['/dev/sda', 'sntjmicron'],
      ['/dev/sdb', 'nvme'],
    ],
  );
});

test('future USB NVMe selectors are listed without opening or optional identity reads', async () => {
  const calls = [];
  const result = await scanDevices('auto', {
    platform: 'win32',
    runSmartProbe: async (args) => {
      calls.push(args);
      if (args[0] !== '--scan') throw new Error('Unexpected device access');
      return listed([
        { name: '/dev/sda', type: 'sntfuture', info_name: '/dev/sda [USB NVMe candidate]' },
        { name: '/dev/sdb', type: 'nvme', info_name: '/dev/sdb' },
      ]);
    },
  });
  assert.deepEqual(calls, [['--scan', '-j']]);
  assert.equal(result.devices[0].requiresUsbChoice, true);
  assert.equal(result.devices[1].requiresUsbChoice, undefined);
});

test('explicit USB batch preset avoids scan-open and preserves internal NVMe selectors', async () => {
  const calls = [];
  const result = await scanDevices('sat', {
    platform: 'win32',
    runSmartProbe: async (args) => {
      calls.push(args[0]);
      return listed([
        { name: '/dev/sda', type: 'sntjmicron', info_name: 'USB Bridge' },
        { name: '/dev/sdb', type: 'nvme' },
      ]);
    },
  });
  assert.deepEqual(calls, ['--scan']);
  assert.deepEqual(
    result.devices.map((d) => d.type),
    ['sat', 'nvme'],
  );
});

test('failed optional scan-open does not suppress devices found by scan', async () => {
  const calls = [];
  const result = await scanDevices('auto', {
    platform: 'win32',
    runSmartProbe: async (args) => {
      calls.push(args[0]);
      if (args[0] === '--scan-open') throw new Error('bridge timed out');
      return listed([{ name: '/dev/sde', type: 'sat' }]);
    },
  });
  assert.deepEqual(calls, ['--scan', '--scan-open']);
  assert.equal(result.devices[0].name, '/dev/sde');
  assert.match(result.warnings.join(' '), /bridge timed out/);
});

test('different modes on one path still get identity checks within the shorter time budget', async () => {
  const calls = [];
  const raw = {
    model_name: 'Test disk',
    serial_number: 'SERIAL-ABCDEF',
    user_capacity: { bytes: 1000204886016 },
    device: { protocol: 'ATA' },
  };
  const result = await scanDevices('auto', {
    platform: 'win32',
    runSmartProbe: async (args, timeout) => {
      calls.push({ args, timeout });
      if (args[0] === '--scan-open') return listed([{ name: '/dev/sdf', type: 'sat' }]);
      if (args[0] === '--scan') return listed([{ name: '/dev/sdf', type: 'auto' }]);
      return { json: raw, exitCode: 0 };
    },
  });
  assert.deepEqual(
    calls.map((c) => c.args[0]),
    ['--scan', '--scan-open', '-i', '-i'],
  );
  assert.ok(calls.slice(2).every((c) => c.timeout > 0 && c.timeout <= 9000));
  assert.deepEqual(
    result.devices.map((d) => d.type),
    ['sat'],
  );
});
