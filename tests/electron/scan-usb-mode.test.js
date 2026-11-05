'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validScanUsbMode,
  applyScanUsbMode,
  mergeOpenedAndListed,
} = require('../../shared/scan-usb-mode.mjs');
const { createScanController } = require('../../electron/devices/scan-controller.js');
const disk = (type, name = '/dev/sdb', info_name = '/dev/sdb [USB NVMe JMicron]') => ({
  name,
  type,
  info_name,
});

test('dual-protocol JMicron 152d:0581 SATA: opened SAT supersedes the unverified NVMe guess', () => {
  const result = mergeOpenedAndListed(
    [disk('sat', '/dev/sdb', '/dev/sdb [SAT]')],
    [disk('sntjmicron/sat')],
  );
  assert.deepEqual(
    result.map((d) => d.type),
    ['sat'],
  );
  assert.equal(
    result[0].transport,
    'USB',
    'smartctl JMicron USB hint survives the verified SAT result',
  );
  assert.deepEqual(
    mergeOpenedAndListed([disk('sntjmicron')], [disk('sat', '/dev/sdb', '/dev/sdb [USB SAT]')]).map(
      (d) => d.type,
    ),
    ['sntjmicron'],
  );
});

test('unknown USB NVMe selector is handled without a new VID/PID entry', () => {
  const guessed = disk('sntfuture', '/dev/sdf', '/dev/sdf [USB NVMe candidate]');
  assert.equal(applyScanUsbMode(guessed, 'sat').type, 'sat');
  assert.deepEqual(
    mergeOpenedAndListed([disk('sat', '/dev/sdf', '/dev/sdf [SAT]')], [guessed]).map((d) => [
      d.type,
      d.transport,
    ]),
    [['sat', 'USB']],
  );
});

test('auto discovery retains USB drives omitted from scan-open and does not merge RAID members', () => {
  const opened = [
    disk('ata', '/dev/sda', '/dev/sda [ATA]'),
    disk('sat', '/dev/sdb', '/dev/sdb [SAT]'),
  ];
  const listed = [
    disk('ata', '/dev/sda', '/dev/sda [ATA]'),
    disk('sntjmicron/sat'),
    disk('scsi', '/dev/sdc', '/dev/sdc [SCSI]'),
  ];
  const out = mergeOpenedAndListed(opened, listed);
  assert.deepEqual(
    out.map((d) => [d.name, d.type]),
    [
      ['/dev/sda', 'ata'],
      ['/dev/sdb', 'sat'],
      ['/dev/sdc', 'scsi'],
    ],
  );
  const raid = mergeOpenedAndListed(
    [disk('megaraid,0', '/dev/sdb', '/dev/sdb')],
    [disk('megaraid,1', '/dev/sdb', '/dev/sdb')],
  );
  assert.equal(raid.length, 2);
  assert.deepEqual(
    mergeOpenedAndListed(
      [disk('sat', '/dev/sdb', '/dev/sdb [SAT]')],
      [disk('scsi', '/dev/sdb', '/dev/sdb [SCSI]')],
    ).map((d) => d.type),
    ['sat'],
  );
});

test('USB batch SAT override leaves internal ATA, NVMe and non-USB SCSI unchanged', () => {
  assert.equal(applyScanUsbMode(disk('sntjmicron'), 'sat').type, 'sat');
  assert.equal(applyScanUsbMode(disk('sntjmicron'), 'sat').transport, 'USB');
  assert.equal(applyScanUsbMode(disk('sntjmicron'), 'sntjmicron/sat').type, 'sntjmicron/sat');
  assert.equal(
    applyScanUsbMode(disk('sat', '/dev/sdb', '/dev/sdb [USB SAT]'), 'sntjmicron').type,
    'sntjmicron',
  );
  for (const mode of ['ata', 'nvme', 'megaraid,0', 'scsi']) {
    assert.equal(applyScanUsbMode(disk(mode, '/dev/sda', '/dev/sda'), 'sat').type, mode);
  }
  assert.equal(
    applyScanUsbMode(disk('scsi', '/dev/sdc', '/dev/sdc [USB Mass Storage]'), 'sat').type,
    'sat',
  );
});

test('batch preset rejects unlisted / dangerous driver strings and never infers device type from USB ID', () => {
  for (const mode of [
    'sat;rm -rf /',
    'nvme',
    'scsi',
    'megaraid,1',
    '',
    undefined,
    null,
    'sntjmicron/evil',
  ]) {
    assert.equal(validScanUsbMode(mode), false);
    assert.throws(() => applyScanUsbMode(disk('sntjmicron'), mode), /Invalid USB scan/);
  }
  assert.equal(
    applyScanUsbMode(disk('scsi', '/dev/sdb', '/dev/sdb'), 'sat').type,
    'scsi',
    'generic SCSI without proven USB metadata is not blindly changed',
  );
});

test('scan controller forwards validated batch preset to discovery; next automatic scan resets it', async () => {
  const calls = [];
  const controller = createScanController({
    platform: 'win32',
    scanDevices: async (mode) => {
      calls.push(mode);
      return { devices: [disk(mode === 'sat' ? 'sat' : 'sntjmicron')], warnings: [] };
    },
    safeDevice: ({ name, type }) => ({ name, type }),
    deviceKey: ({ name, type }) => `${name}\0${type}`,
    startWindowsInventory: () => null,
    parseWindowsInventory: () => ({}),
    possibleWindowsAliases: () => [],
    findWindowsNvmeAliases: async () => [],
    runSmart: async () => ({ json: {} }),
    operations: { run: (_, work) => work() },
    reports: { reset: () => {} },
    logStartup: () => {},
    isTestPending: () => false,
  });
  const first = await controller.scan('sat');
  assert.equal(first.devices[0].type, 'sat');
  await assert.rejects(controller.scan('sat;rm -rf /'), /Zugriffsart/);
  const second = await controller.scan();
  assert.equal(second.devices[0].type, 'sntjmicron');
  assert.deepEqual(calls, ['sat', 'auto']);
});

test('JMicron ambiguity skips scan-open before manual SATA or NVMe selection', async () => {
  const Module = require('node:module');
  const original = Module._load;
  Module._load = function (id, ...args) {
    if (id === 'electron') return { app: { isPackaged: false } };
    return original.call(this, id, ...args);
  };
  let scanDevices;
  try {
    ({ scanDevices } = require('../../electron/devices/smart.js'));
  } finally {
    Module._load = original;
  }
  const calls = [];
  const runSmartProbe = async (args) => {
    calls.push(args);
    return {
      json: {
        devices:
          args[0] === '--scan-open'
            ? [disk('sat', '/dev/sdb', '/dev/sdb [SAT]')]
            : [disk('sntjmicron', '/dev/sdb'), disk('scsi', '/dev/sdc', '/dev/sdc [SCSI]')],
      },
    };
  };
  const result = await scanDevices('auto', { runSmartProbe, platform: 'win32' });
  assert.deepEqual(
    result.devices.map(({ name, type }) => [name, type]),
    [
      ['/dev/sdb', 'sntjmicron'],
      ['/dev/sdc', 'scsi'],
    ],
  );
  assert.equal(result.devices[0].requiresUsbChoice, true);
  assert.deepEqual(calls, [['--scan', '-j']]);
});

test('SAT batch preset never opens the JMicron controller as NVMe during scan', async () => {
  const Module = require('node:module');
  const original = Module._load;
  Module._load = function (id, ...args) {
    if (id === 'electron') return { app: { isPackaged: false } };
    return original.call(this, id, ...args);
  };
  let scanDevices;
  try {
    ({ scanDevices } = require('../../electron/devices/smart.js'));
  } finally {
    Module._load = original;
  }
  const calls = [];
  const result = await scanDevices('sat', {
    platform: 'win32',
    runSmartProbe: async (args) => {
      calls.push(args);
      return { json: { devices: [disk('sntjmicron'), disk('ata', '/dev/sda', '/dev/sda [ATA]')] } };
    },
  });
  assert.deepEqual(calls, [['--scan', '-j']]);
  assert.deepEqual(
    result.devices.map(({ name, type }) => [name, type]),
    [
      ['/dev/sdb', 'sat'],
      ['/dev/sda', 'ata'],
    ],
  );
});

test('Realtek 0bda:9210 SATA bridge stops before NVMe scan-open and waits for a selection', async () => {
  const Module = require('node:module');
  const original = Module._load;
  Module._load = function (id, ...args) {
    if (id === 'electron') return { app: { isPackaged: false } };
    return original.call(this, id, ...args);
  };
  let scanDevices;
  try {
    ({ scanDevices } = require('../../electron/devices/smart.js'));
  } finally {
    Module._load = original;
  }
  const calls = [];
  const result = await scanDevices('auto', {
    platform: 'win32',
    runSmartProbe: async (args) => {
      calls.push(args);
      if (args[0] !== '--scan') throw new Error('Unauthorized NVMe read');
      return {
        json: {
          devices: [
            disk('nvme', '/dev/sda', '/dev/sda'),
            disk('sntrealtek', '/dev/sdb', '/dev/sdb [USB NVMe Realtek]'),
          ],
        },
      };
    },
  });
  assert.deepEqual(calls, [['--scan', '-j']]);
  assert.equal(result.devices.find((d) => d.name === '/dev/sdb')?.requiresUsbChoice, true);
  assert.equal(result.devices.find((d) => d.name === '/dev/sda')?.requiresUsbChoice, undefined);
});

test('preload carries a deliberately selected USB preset to the privileged scan boundary', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { runInNewContext } = require('node:vm');
  const calls = [];
  let bridge;
  runInNewContext(readFileSync(join(ELECTRON_SOURCE_DIR, 'preload.js'), 'utf8'), {
    require: (id) => {
      assert.equal(id, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld: (_name, value) => {
            bridge = value;
          },
        },
        ipcRenderer: {
          invoke: async (channel, ...args) => {
            calls.push([channel, ...args]);
            return { ok: true, value: { devices: [], generation: 1 } };
          },
          on() {},
          removeListener() {},
        },
      };
    },
  });
  await bridge.scan('sat');
  await bridge.scan();
  assert.deepEqual(calls, [
    ['diagnostics:scan', 'sat'],
    ['diagnostics:scan', 'auto'],
  ]);
});

test('auto scan does not trigger a slow NVMe-first fallback on an ambiguous adapter', async () => {
  const Module = require('node:module');
  const original = Module._load;
  Module._load = function (id, ...args) {
    if (id === 'electron') return { app: { isPackaged: false } };
    return original.call(this, id, ...args);
  };
  let scanDevices;
  try {
    ({ scanDevices } = require('../../electron/devices/smart.js'));
  } finally {
    Module._load = original;
  }
  const calls = [];
  const response = await scanDevices('auto', {
    platform: 'win32',
    runSmartProbe: async (args) => {
      calls.push(args[0]);
      if (args[0] === '--scan-open')
        throw Object.assign(new Error('Scan open timeout'), { code: 'ETIMEDOUT' });
      return { json: { devices: [disk('sntjmicron', '/dev/sdb')] } };
    },
  });
  assert.deepEqual(calls, ['--scan']);
  assert.deepEqual(
    response.devices.map(({ name, type }) => [name, type]),
    [['/dev/sdb', 'sntjmicron']],
  );
  assert.equal(response.devices[0].requiresUsbChoice, true);
  assert.equal(response.warnings.length, 0);
});
