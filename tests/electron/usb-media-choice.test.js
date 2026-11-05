'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  needsUsbMediaChoice,
  usbMediaAccessMode,
  usbMediaOptions,
} = require('../../shared/usb-media-choice.mjs');
const { createScanController } = require('../../electron/devices/scan-controller.js');

test('all USB NVMe bridge selector classes require a user decision on Windows', () => {
  for (const type of [
    'sntjmicron',
    'sntjmicron/sat',
    'sntrealtek',
    'sntrealtek/sat',
    'sntasmedia',
    'sntasmedia/sat',
    'sntfuture', // Unsupported or future driver: still ambiguous, never probe automatically.
  ]) {
    assert.equal(needsUsbMediaChoice({ type }, 'win32'), true, type);
    assert.equal(needsUsbMediaChoice({ type }, 'darwin'), false, type);
  }
  for (const type of ['sat', 'nvme', 'megaraid,1', 'scsi', 'ata', 'usbjmicron']) {
    assert.equal(needsUsbMediaChoice({ type }, 'win32'), false, type);
  }
  assert.equal(needsUsbMediaChoice(null, 'win32'), false);
  assert.equal(needsUsbMediaChoice({ type: 'sntjmicron/evil' }, 'win32'), false);
});

test('choices derive from the supported smartctl selectors, not vendor/product exceptions', () => {
  for (const driver of ['sntjmicron', 'sntrealtek', 'sntasmedia']) {
    assert.deepEqual(usbMediaOptions(driver), {
      sata: 'sat',
      nvme: driver,
      unknown: `${driver}/sat`,
    });
    assert.equal(usbMediaAccessMode('unknown', `${driver}/sat`), `${driver}/sat`);
    assert.equal(usbMediaAccessMode('nvme', driver), driver);
  }
  assert.equal(usbMediaAccessMode('sata', 'sntrealtek'), 'sat');
  assert.deepEqual(usbMediaOptions('sntfuture'), { sata: 'sat', nvme: null, unknown: null });
  assert.equal(usbMediaAccessMode('nvme', 'sntfuture'), null);
  assert.equal(usbMediaAccessMode('unknown', 'sntfuture'), null);
  assert.equal(usbMediaAccessMode('unknown', 'nvme'), null);
  assert.equal(usbMediaAccessMode('evil', 'sntjmicron'), null);
});

function controllerFixture(bridgeType = 'sntjmicron') {
  const calls = { probes: [], inventory: 0 };
  const controller = createScanController({
    platform: 'win32',
    scanDevices: async () => ({
      devices: [
        { name: '/dev/sdb', type: bridgeType, requiresUsbChoice: true, info_name: 'USB bridge' },
        { name: '/dev/sdc', type: 'nvme', info_name: 'Internal SSD' },
      ],
      warnings: [],
    }),
    safeDevice: (device) => ({ name: device.name, type: device.type }),
    deviceKey: (device) => `${device.name}\0${device.type}`,
    startWindowsInventory: async () => ({ inventory: null }),
    parseWindowsInventory: () => ({}),
    possibleWindowsAliases: () => [],
    findWindowsNvmeAliases: async (devices, identify) => {
      for (const d of devices) await identify(d);
      return [];
    },
    runSmart: async (args) => {
      calls.probes.push(args);
      return { json: {} };
    },
    operations: { run: async (_name, job) => job() },
    reports: { reset() {}, invalidate() {} },
    logStartup() {},
    isTestPending: () => false,
  });
  return { controller, calls };
}

test('the main process prevents SMART reads on unconfirmed bridge paths', async () => {
  const { controller } = controllerFixture();
  const { devices, generation } = await controller.scan();
  const usb = devices[0];
  const internal = devices[1];
  assert.equal(usb.requiresUsbChoice, true);
  assert.equal(internal.requiresUsbChoice, undefined);
  assert.throws(() => controller.assertDevice(usb), /SATA|NVMe/);
  assert.deepEqual(controller.assertDevice(internal), { name: '/dev/sdc', type: 'nvme' });
  assert.deepEqual(controller.selectAccessMode(usb, 'sat', generation), {
    name: '/dev/sdb',
    type: 'sat',
  });
  assert.deepEqual(controller.assertDevice({ name: '/dev/sdb', type: 'sat' }), {
    name: '/dev/sdb',
    type: 'sat',
  });
  assert.throws(() => controller.assertDevice(usb), /aktuellen Erkennung/);
  await controller.scan();
  assert.throws(
    () => controller.assertDevice({ name: '/dev/sdb', type: 'sat' }),
    /aktuellen Erkennung/,
  );
});

test('Realtek candidate stays unauthorized until SATA, NVMe or hybrid mode is explicitly selected', async () => {
  for (const kind of ['sata', 'nvme', 'unknown']) {
    const { controller, calls } = controllerFixture('sntrealtek');
    const { devices, generation } = await controller.scan();
    const bridge = devices[0];
    assert.equal(bridge.requiresUsbChoice, true);
    assert.throws(() => controller.assertDevice(bridge), /SATA|NVMe/);
    await controller.scanAliases(generation);
    assert.deepEqual(calls.probes, [['-i', '-j', '-d', 'nvme', '/dev/sdc']]);
    const mode = usbMediaAccessMode(kind, bridge.type);
    const authorized = controller.selectAccessMode(bridge, mode, generation);
    assert.equal(
      authorized.type,
      { sata: 'sat', nvme: 'sntrealtek', unknown: 'sntrealtek/sat' }[kind],
    );
    assert.deepEqual(controller.assertDevice(authorized), authorized);
  }
});

test('unknown future bridge remains blocked but permits a user-selected SATA access', async () => {
  const { controller, calls } = controllerFixture('sntfuture');
  const { devices, generation } = await controller.scan();
  assert.equal(devices[0].requiresUsbChoice, true);
  assert.throws(() => controller.assertDevice(devices[0]), /SATA|NVMe/);
  await controller.scanAliases(generation);
  assert.deepEqual(calls.probes, [['-i', '-j', '-d', 'nvme', '/dev/sdc']]);
  assert.equal(usbMediaAccessMode('nvme', devices[0].type), null);
  const selected = controller.selectAccessMode(devices[0], 'sat', generation);
  assert.equal(controller.assertDevice(selected).type, 'sat');
});

test('an explicitly selected hybrid mode is accepted even when it matches scan type', async () => {
  const { controller } = controllerFixture();
  const { generation, devices } = await controller.scan();
  const usb = devices[0];
  // The user's decision is required even if it selects a type that smartctl guessed.
  const resolved = controller.selectAccessMode(usb, usb.type, generation);
  assert.equal(resolved.type, usb.type);
  assert.deepEqual(controller.assertDevice(resolved), resolved);
});

test('optional alias identification never probes an unconfirmed JMicron USB bridge', async () => {
  const { controller, calls } = controllerFixture();
  const { generation } = await controller.scan();
  await controller.scanAliases(generation);
  assert.equal(calls.probes.length, 1);
  assert.deepEqual(calls.probes[0], ['-i', '-j', '-d', 'nvme', '/dev/sdc']);
});

test('unsupported smartctl selector syntax stays rejected', () => {
  const Module = require('node:module');
  const old = Module._load;
  Module._load = function (id, ...args) {
    if (id === 'electron') return { app: { isPackaged: false } };
    return old.call(this, id, ...args);
  };
  let safeDevice;
  try {
    ({ safeDevice } = require('../../electron/devices/smart.js'));
  } finally {
    Module._load = old;
  }
  for (const type of ['sntjmicron/evil', 'sat/sntjmicron', 'sat/12', 'nvme/sat', '-d']) {
    assert.throws(() => safeDevice({ name: '/dev/sdb', type }), /Gerätetyp/);
  }
});
