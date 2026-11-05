'use strict';
const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createScanController } = require('../../electron/devices/scan-controller.js');
const { createDetailCache } = require('../../electron/diagnostics/detail-cache.js');
const {
  allowedManualAccessMode,
  MANUAL_ACCESS_MODES,
} = require('../../shared/manual-access-modes.mjs');

const key = (d) => `${d.name}\0${d.type}`;
const device = (type = 'scsi') => ({ name: '/dev/sdb', type });
function setup(overrides = {}) {
  const reports = createDetailCache();
  const calls = [];
  const ctrl = createScanController({
    platform: 'win32',
    scanDevices: async () => ({ devices: [device()], warnings: [] }),
    safeDevice: (d) => {
      if (
        !d ||
        !/^\/dev\/sd[a-z]$/.test(d.name) ||
        !/^(?:[a-zA-Z0-9][a-zA-Z0-9,+_-]{0,59}|snt(?:jmicron|asmedia|realtek)\/sat)$/.test(d.type)
      )
        throw Error('invalid device');
      return { name: d.name, type: d.type };
    },
    deviceKey: key,
    startWindowsInventory: () => null,
    parseWindowsInventory: () => ({}),
    possibleWindowsAliases: () => [],
    findWindowsNvmeAliases: async () => [],
    runSmart: async (args) => {
      calls.push(args);
      return { json: {} };
    },
    operations: { run: (_path, action) => action() },
    reports,
    logStartup: () => {},
    isTestPending: () => false,
    ...overrides,
  });
  return { ctrl, reports, calls };
}

test('unknown 152d:0581 USB bridge can switch from scanned SCSI to manually selected sntjmicron', async () => {
  const { ctrl, reports } = setup();
  const scanned = await ctrl.scan();
  assert.deepEqual(
    scanned.devices.map(({ name, type }) => ({ name, type })),
    [device()],
  );
  const old = await reports.load(key(device()), async () => ({ reportId: 'old' }));
  assert.equal(reports.get(key(device())), old);
  assert.deepEqual(ctrl.selectAccessMode(device(), 'sntjmicron', 1), device('sntjmicron'));
  assert.equal(reports.get(key(device())), undefined, 'stale SCSI snapshot revoked');
  assert.deepEqual(ctrl.assertDevice(device('sntjmicron')), device('sntjmicron'));
  assert.throws(() => ctrl.assertDevice(device()), /aktuellen Erkennung/);
  // Read and self-test requests use the new authorized -d; no arbitrary user command.
  const { createSmartAccess } = require('../../electron/devices/smart-access.js');
  const args = [];
  const access = createSmartAccess({
    assertDevice: ctrl.assertDevice,
    runSmart: async (flags) => {
      args.push(flags);
      return { exitCode: 0, json: { nvme_smart_health_information_log: { critical_warning: 0 } } };
    },
  });
  await access.detail(device('sntjmicron'));
  assert.deepEqual(args[0], ['-x', '-j', '-d', 'sntjmicron', '/dev/sdb']);
  await access.startTest(device('sntjmicron'), 'short');
  assert.deepEqual(args[1], ['-t', 'short', '-j', '-d', 'sntjmicron', '/dev/sdb']);
});

test('mode allowlist rejects shell flags, unknown drivers and arbitrary paths', async () => {
  const { ctrl } = setup();
  await ctrl.scan();
  for (const value of [
    '-d',
    'sntjmicron;rm -rf /',
    'sat,999',
    'megaraid,999',
    '',
    null,
    {},
    'sat,x',
    'sntjmicron/evil',
    'sntjmicron/sat;--scan',
    'nvme/sat',
  ]) {
    assert.equal(allowedManualAccessMode(value), false);
    assert.throws(() => ctrl.selectAccessMode(device(), value, 1), /Zugriffsart/);
  }
  assert.throws(
    () => ctrl.selectAccessMode({ name: '/dev/sdc', type: 'scsi' }, 'sat', 1),
    /aktuellen Erkennung/,
  );
  assert.ok(MANUAL_ACCESS_MODES.includes('sat'));
  assert.ok(MANUAL_ACCESS_MODES.includes('sntjmicron'));
  for (const mode of ['sntjmicron/sat', 'sntasmedia/sat', 'sntrealtek/sat']) {
    assert.ok(MANUAL_ACCESS_MODES.includes(mode));
    assert.equal(allowedManualAccessMode(mode), true);
  }
});

test('new discovery resets manual mode; old type cannot be reused after selection', async () => {
  const { ctrl } = setup();
  await ctrl.scan();
  ctrl.selectAccessMode(device(), 'sat', 1);
  assert.throws(() => ctrl.selectAccessMode(device(), 'nvme', 1), /aktuellen Erkennung/);
  const rescanned = await ctrl.scan();
  assert.equal(rescanned.devices[0].type, 'scsi');
  assert.throws(() => ctrl.assertDevice(device('sat')), /aktuellen Erkennung/);
  assert.throws(() => ctrl.selectAccessMode(device(), 'sntjmicron', 1), /aktualisiert/);
});

test('manual selection rejects changes during scan or self-test and rejects an already existing alias mode', async () => {
  let finish;
  let testing = false;
  const { ctrl } = setup({
    scanDevices: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    isTestPending: () => testing,
  });
  const scanning = ctrl.scan();
  assert.throws(() => ctrl.selectAccessMode(device(), 'sat', 1), /erkennung/i);
  finish({ devices: [device(), device('sat')], warnings: [] });
  await scanning;
  testing = true;
  assert.throws(() => ctrl.selectAccessMode(device(), 'sntjmicron', 1), /SMART-Selbsttest-Starts/);
  testing = false;
  assert.throws(() => ctrl.selectAccessMode(device(), 'sat', 1), /bereits vorhanden/);
});

test('late Windows inventory enriches the current mode without restoring stale SCSI type', async () => {
  let resolve;
  const { ctrl } = setup({
    startWindowsInventory: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const { generation } = await ctrl.scan();
  const late = ctrl.scanMetadata(generation);
  ctrl.selectAccessMode(device(), 'sntjmicron', 1);
  resolve({ inventory: {}, durationMs: '1ms' });
  const metadata = await late;
  assert.equal(metadata.devices[0].type, 'sntjmicron');
  assert.equal(metadata.devices[0].name, '/dev/sdb');
});

test('scan → unknown SCSI readout → explicit NVMe bridge switch → shared diagnostic snapshot', async () => {
  const { ctrl, reports } = setup();
  await ctrl.scan();
  const { createSmartAccess } = require('../../electron/devices/smart-access.js');
  const { createDiagnosticService } = require('../../electron/diagnostics/diagnostic-service.js');
  const { evaluate } = require('../../electron/diagnostics/health.js');
  const executed = [];
  const smartAccess = createSmartAccess({
    assertDevice: ctrl.assertDevice,
    runSmart: async (args) => {
      executed.push(args);
      if (args.includes('scsi'))
        return {
          exitCode: 2,
          json: {
            device: { protocol: 'SCSI' },
            smartctl: {
              messages: [{ severity: 'error', string: 'Unknown USB bridge [0x152d:0x0581]' }],
            },
          },
        };
      return {
        exitCode: 0,
        json: {
          model_name: 'WD Blue SN580',
          device: { protocol: 'NVMe' },
          nvme_smart_health_information_log: {
            critical_warning: 0,
            available_spare: 100,
            available_spare_threshold: 10,
            percentage_used: 1,
            media_errors: 0,
            num_err_log_entries: 0,
            power_on_hours: 120,
            power_cycles: 40,
          },
        },
      };
    },
  });
  const service = createDiagnosticService({
    validateDevice: (d) => d,
    assertDevice: ctrl.assertDevice,
    deviceKey: key,
    reports,
    operations: { run: (_key, action) => action() },
    smartAccess,
    evaluate,
    history: { identity: () => null },
    getSettings: () => ({ autoSaveHistory: false }),
    getUserDataPath: () => '/tmp/unused',
    scanGeneration: ctrl.scanGeneration,
    isScanning: ctrl.isScanning,
    createId: () => 'confirmed-nvme-snapshot',
    logSaveError: () => {},
  });
  const initial = await service.detail(device());
  assert.equal(visibleDiagnosisStatus(initial.health), 'unassessable');
  ctrl.selectAccessMode(device(), 'sntjmicron', 1);
  await assert.rejects(service.detail(device()), /aktuellen Erkennung/);
  const recovered = await service.detail(device('sntjmicron'));
  assert.equal(recovered.device.type, 'sntjmicron');
  assert.equal(recovered.raw.model_name, 'WD Blue SN580');
  assert.equal(visibleDiagnosisStatus(recovered.health), 'ok');
  assert.equal(recovered.reportId, 'confirmed-nvme-snapshot');
  assert.equal(reports.get(key(device('sntjmicron'))), recovered);
  assert.equal(reports.get(key(device())), undefined);
  assert.ok(executed.some((flags) => flags.includes('sntjmicron')));
});

test('late alias results from the previous access mode cannot rewrite the device list', async () => {
  let finish;
  const { ctrl } = setup({
    possibleWindowsAliases: () => [device()],
    findWindowsNvmeAliases: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const { generation } = await ctrl.scan();
  const aliases = ctrl.scanAliases(generation);
  ctrl.selectAccessMode(device(), 'sntjmicron', generation);
  finish([[device(), device('sntjmicron')]]);
  await assert.rejects(aliases, /inzwischen aktualisiert/);
  assert.deepEqual(ctrl.assertDevice(device('sntjmicron')), device('sntjmicron'));
});

// A JMicron bridge may hold either a SATA or NVMe M.2 SSD under one VID:PID.
test('combo JMicron selector uses one smartctl mode and retains the resolved SATA protocol', async () => {
  const { ctrl } = setup();
  await ctrl.scan();
  const choice = ctrl.selectAccessMode(device(), 'sntjmicron/sat', 1);
  assert.deepEqual(choice, device('sntjmicron/sat'));
  const { createSmartAccess } = require('../../electron/devices/smart-access.js');
  const calls = [];
  const access = createSmartAccess({
    assertDevice: ctrl.assertDevice,
    runSmart: async (flags, timeout) => {
      calls.push({ flags, timeout });
      return {
        exitCode: 4,
        json: {
          device: { type: 'sat', protocol: 'ATA' },
          model_name: 'INTEL SSDSCKKW256G8',
          smart_status: { passed: true },
          ata_smart_attributes: { table: [{ id: 9, raw: { value: 1860 } }] },
        },
      };
    },
  });
  const result = await access.detail(choice);
  assert.equal(result.json.device.type, 'sat');
  assert.equal(result.json.device.protocol, 'ATA');
  assert.equal(calls.length, 1, 'a valid SAT report must not trigger more probes');
  assert.deepEqual(calls[0].flags, ['-x', '-j', '-d', 'sntjmicron/sat', '/dev/sdb']);
  assert.ok(calls[0].timeout > 45000, 'slow NVMe Identify fallback has a bounded extended timeout');
  await access.startTest(choice, 'short');
  assert.deepEqual(calls[1].flags, ['-t', 'short', '-j', '-d', 'sntjmicron/sat', '/dev/sdb']);
  assert.ok(calls[1].timeout > 25000);
});
