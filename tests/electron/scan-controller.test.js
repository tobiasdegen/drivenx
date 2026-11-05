'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createScanController } = require('../../electron/devices/scan-controller.js');

const key = (d) => `${d.name}\0${d.type}`;
const device = (name = '/dev/sda', type = 'sat') => ({ name, type });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function setup(overrides = {}) {
  const log = [];
  const state = { resets: 0, scans: 0 };
  const args = {
    platform: 'win32',
    scanDevices: async () => {
      state.scans++;
      return { devices: [device()], warnings: [] };
    },
    safeDevice: (d) => d,
    deviceKey: key,
    startWindowsInventory: () => Promise.resolve({ inventory: { foo: true }, durationMs: '8ms' }),
    parseWindowsInventory: (_inventory, d) => ({ capacityBytes: 1000, name: d.name }),
    possibleWindowsAliases: () => [],
    findWindowsNvmeAliases: async () => [],
    runSmart: async () => ({ json: { model_name: 'Test' } }),
    operations: { run: (_key, work) => work() },
    reports: {
      reset: () => {
        state.resets++;
      },
      invalidate: () => {},
    },
    logStartup: (tag, value) => log.push([tag, value]),
    isTestPending: () => false,
    ...overrides,
  };
  return { controller: createScanController(args), state, log };
}

test('discovery publishes smartctl disks without waiting for optional Windows inventory', async () => {
  const pending = deferred();
  const { controller, state } = setup({ startWindowsInventory: () => pending.promise });
  const first = await controller.scan();
  assert.equal(first.devices[0].name, '/dev/sda');
  assert.equal(first.metadataPending, true);
  assert.equal(
    Object.hasOwn(first, 'exitCode'),
    false,
    'scan success must not carry an unused exit code',
  );
  assert.equal(state.resets, 1);
  pending.resolve({ inventory: {}, durationMs: '10ms' });
  const metadata = await controller.scanMetadata(first.generation);
  assert.equal(metadata.devices[0].capacityBytes, 1000);
});

test('concurrent discovery shares one scan and preserves the device allowlist', async () => {
  const pending = deferred();
  const { controller, state } = setup({
    platform: 'darwin',
    scanDevices: async () => {
      state.scans++;
      return pending.promise;
    },
  });
  const first = controller.scan();
  const second = controller.scan();
  pending.resolve({ devices: [device()], warnings: [] });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.generation, b.generation);
  assert.equal(state.scans, 1);
  assert.deepEqual(controller.assertDevice(device()), device());
  assert.throws(
    () => controller.assertDevice(device('/dev/sdb')),
    /nicht in der aktuellen Erkennung/,
  );
});

test('new scan rejects stale Windows inventory after asynchronous completion', async () => {
  const pending = deferred();
  let count = 0;
  const { controller } = setup({
    startWindowsInventory: () =>
      ++count === 1 ? pending.promise : Promise.resolve({ inventory: {} }),
  });
  const first = await controller.scan();
  const oldMetadata = controller.scanMetadata(first.generation);
  await controller.scan();
  pending.resolve({ inventory: {} });
  await assert.rejects(oldMetadata, /inzwischen aktualisiert/);
  await assert.rejects(controller.scanMetadata(first.generation), /inzwischen aktualisiert/);
});

test('self-test pending prevents scan and does not advance generation', async () => {
  const { controller } = setup({ isTestPending: () => true });
  await assert.rejects(controller.scan(), /SMART-Selbsttest-Starts/);
  assert.equal(controller.scanGeneration(), 0);
});

test('scan alias lookup uses serialized identity reads and detects stale results', async () => {
  const pending = deferred();
  let args;
  const { controller } = setup({
    platform: 'win32',
    possibleWindowsAliases: () => [device()],
    findWindowsNvmeAliases: async (_devices, identify) => {
      args = await identify(device());
      await pending.promise;
      return [[device(), device('/dev/nvme0', 'nvme')]];
    },
  });
  const first = await controller.scan();
  assert.equal(first.aliasCheckPending, true);
  const aliases = controller.scanAliases(first.generation);
  await controller.scan();
  pending.resolve();
  await assert.rejects(aliases, /inzwischen aktualisiert/);
  assert.deepEqual(args, { model_name: 'Test' });
});

test('macOS discovery annotates verified USB chains with optional database names', async () => {
  const original = {
    ...device('/dev/disk4', 'sat'),
    transport: 'USB',
    connection: {
      verified: true,
      source: 'ioreg',
      chain: [
        { name: 'OS adapter', manufacturer: 'OS vendor', vendorId: '0x174c', productId: '0x55aa' },
      ],
    },
  };
  const { controller } = setup({
    platform: 'darwin',
    scanDevices: async () => ({ devices: [original], warnings: [] }),
  });
  const result = await controller.scan();
  assert.equal(result.devices[0].connection.chain[0].name, 'OS adapter');
  assert.equal(
    result.devices[0].connection.chain[0].usbIdNames.vendorName,
    'ASMedia Technology Inc.',
  );
  assert.equal(result.devices[0].type, 'sat');
  assert.deepEqual(
    controller.assertDevice(device('/dev/disk4', 'sat')),
    device('/dev/disk4', 'sat'),
  );
});

test('Windows follow-up metadata annotates USB device without changing authorized access path', async () => {
  const { controller } = setup({
    parseWindowsInventory: (_inventory, d) => ({
      name: d.name,
      type: d.type,
      transport: 'USB',
      connection: {
        verified: true,
        source: 'windows-pnp',
        chain: [{ name: 'USB Mass Storage Device', vendorId: '0x152d', productId: '0x0583' }],
      },
    }),
  });
  const initial = await controller.scan();
  const metadata = await controller.scanMetadata(initial.generation);
  assert.equal(initial.devices[0].connection, null);
  assert.equal(metadata.devices[0].connection.chain[0].usbIdNames.source, 'usb.ids');
  assert.match(metadata.devices[0].connection.chain[0].usbIdNames.productName, /JMS583/);
  assert.deepEqual(controller.assertDevice(device()), device());
});

test('starting a new scan revokes previous device authorization and report cache immediately', async () => {
  const waiting = deferred();
  let calls = 0;
  const cached = new Map();
  const { controller, state } = setup({
    scanDevices: () =>
      ++calls === 1 ? Promise.resolve({ devices: [device()], warnings: [] }) : waiting.promise,
    reports: {
      reset: () => {
        state.resets++;
        cached.clear();
      },
    },
  });
  await controller.scan();
  cached.set('old', { reportId: 'old' });
  const pending = controller.scan();
  assert.equal(controller.isScanning(), true);
  assert.equal(state.resets, 2);
  assert.equal(cached.size, 0);
  assert.throws(() => controller.assertDevice(device()), /nicht in der aktuellen Erkennung/);
  waiting.resolve({ devices: [device('/dev/sdb')], warnings: [] });
  const result = await pending;
  assert.deepEqual(
    result.devices.map((item) => item.name),
    ['/dev/sdb'],
  );
  assert.throws(() => controller.assertDevice(device()), /nicht in der aktuellen Erkennung/);
  assert.equal(controller.assertDevice(device('/dev/sdb')).name, '/dev/sdb');
});

test('a failed discovery leaves no old authorized devices or SMART reports behind', async () => {
  let calls = 0;
  const { controller, state } = setup({
    scanDevices: () =>
      ++calls === 1
        ? Promise.resolve({ devices: [device()], warnings: [] })
        : Promise.reject(new Error('scan device error')),
  });
  await controller.scan();
  await assert.rejects(controller.scan(), /scan device error/);
  assert.equal(state.resets, 2);
  assert.equal(controller.isScanning(), false);
  assert.throws(() => controller.assertDevice(device()), /nicht in der aktuellen Erkennung/);
});

test('an invalid later device cannot leave a partially authorized inventory', async () => {
  const valid = device('/dev/sda');
  const invalid = device('/dev/sdb');
  const { controller } = setup({
    scanDevices: async () => ({ devices: [valid, invalid], warnings: [] }),
    safeDevice: (input) => {
      if (input.name === invalid.name) throw new Error('invalid scanned device');
      return input;
    },
  });
  await assert.rejects(controller.scan(), /invalid scanned device/);
  assert.equal(controller.isScanning(), false);
  assert.throws(() => controller.assertDevice(valid), /nicht in der aktuellen Erkennung/);
});

test('optional Windows inventory start failure does not hide valid SMART devices', async () => {
  const { controller } = setup({
    startWindowsInventory: () => {
      throw new Error('Failed to launch powershell');
    },
  });
  const result = await controller.scan();
  assert.equal(result.devices.length, 1);
  assert.equal(result.metadataPending, false);
  assert.match(result.message.join(' '), /Optionale Windows-Gerätezuordnung/);
  assert.deepEqual(controller.assertDevice(device()), device());
});

test('queued NVMe identity probe is skipped after rescan before it obtains its device slot', async () => {
  const { createDeviceOperations } = require('../../electron/devices/device-operations.js');
  const operations = createDeviceOperations();
  const blocker = deferred();
  const busy = operations.run('/dev/sda', () => blocker.promise);
  let hardwareReads = 0;
  const { controller } = setup({
    operations,
    possibleWindowsAliases: () => [device()],
    findWindowsNvmeAliases: async (devices, readIdentity) => {
      await readIdentity(devices[0]);
      return [];
    },
    runSmart: async () => {
      hardwareReads++;
      return { json: {} };
    },
  });
  const first = await controller.scan();
  const pending = controller.scanAliases(first.generation);
  await controller.scan();
  blocker.resolve();
  await busy;
  await assert.rejects(pending, /inzwischen aktualisiert/);
  assert.equal(hardwareReads, 0);
});

test('queued NVMe identity probe is skipped after manual selector change', async () => {
  const { createDeviceOperations } = require('../../electron/devices/device-operations.js');
  const operations = createDeviceOperations();
  const blocker = deferred();
  const busy = operations.run('/dev/sda', () => blocker.promise);
  let hardwareReads = 0;
  const { controller } = setup({
    operations,
    possibleWindowsAliases: () => [device()],
    findWindowsNvmeAliases: async (devices, readIdentity) => {
      await readIdentity(devices[0]);
      return [];
    },
    runSmart: async () => {
      hardwareReads++;
      return { json: {} };
    },
  });
  const first = await controller.scan();
  const pending = controller.scanAliases(first.generation);
  controller.selectAccessMode(device(), 'auto', first.generation);
  blocker.resolve();
  await busy;
  await assert.rejects(pending, /inzwischen aktualisiert/);
  assert.equal(hardwareReads, 0);
});

test('simultaneous alias requests share one lookup without duplicate smartctl calls', async () => {
  const blocker = deferred();
  let reads = 0;
  const { controller } = setup({
    possibleWindowsAliases: () => [device()],
    findWindowsNvmeAliases: async (_devices, readIdentity) => {
      await readIdentity(device());
      await blocker.promise;
      return [[device(), device('/dev/nvme0', 'nvme')]];
    },
    runSmart: async () => {
      reads++;
      return { json: {} };
    },
  });
  const result = await controller.scan();
  const a = controller.scanAliases(result.generation);
  const b = controller.scanAliases(result.generation);
  assert.strictEqual(a, b);
  blocker.resolve();
  assert.deepEqual(await a, await b);
  assert.equal(reads, 1);
  await controller.scanAliases(result.generation);
  assert.equal(reads, 2, 'completed probes may be repeated on explicit request');
});

test('asynchronous failure of optional Windows inventory remains a metadata warning', async () => {
  const { controller } = setup({
    startWindowsInventory: () => Promise.reject(new Error('CIM unavailable')),
  });
  const scan = await controller.scan();
  assert.equal(scan.devices.length, 1);
  assert.equal(scan.metadataPending, true);
  const metadata = await controller.scanMetadata(scan.generation);
  assert.deepEqual(metadata.devices, []);
  assert.match(metadata.message[0], /Optionale Windows-Gerätezuordnung/);
  assert.deepEqual(controller.assertDevice(device()), device());
});
