'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDetailCache } = require('../../electron/diagnostics/detail-cache.js');
const { createDiagnosticService } = require('../../electron/diagnostics/diagnostic-service.js');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup({ autoSaveHistory = true, smartRead } = {}) {
  const reports = createDetailCache();
  const saved = [];
  const errors = [];
  let generation = 1;
  let scanning = false;
  let calls = 0;
  const service = createDiagnosticService({
    validateDevice: (value) => value,
    assertDevice: (value) => value,
    deviceKey: (value) => value.name,
    reports,
    operations: { run: (_path, work) => work() },
    smartAccess: {
      detail: async (value) => {
        calls++;
        return smartRead ? smartRead(value) : { json: { serial_number: '1' }, exitCode: 0 };
      },
    },
    evaluate: () => ({ status: 'ok', readout: { status: 'vollstaendig' } }),
    history: {
      identity: () => 'drive-a',
      save: async (_path, report) => {
        saved.push(report);
      },
    },
    getSettings: () => ({ autoSaveHistory }),
    getUserDataPath: () => '/tmp/fake',
    scanGeneration: () => generation,
    isScanning: () => scanning,
    createId: () => `id-${calls}`,
    logSaveError: (error) => errors.push(error),
  });
  const rescan = () => {
    generation++;
    scanning = true;
    reports.reset();
  };
  return {
    service,
    reports,
    saved,
    rescan,
    finishScan: () => {
      scanning = false;
    },
    errors,
  };
}

test('current authorized reading may be saved to history and returned', async () => {
  const { service, saved } = setup();
  const report = await service.detail({ name: '/dev/sda', type: 'sat' });
  assert.equal(saved.length, 1);
  assert.equal(saved[0], report);
});

test('rescan while SMART is pending rejects stale response without auto-historization', async () => {
  const pending = deferred();
  const { service, saved, rescan, finishScan } = setup({ smartRead: () => pending.promise });
  const old = service.detail({ name: '/dev/sda', type: 'sat' });
  await Promise.resolve();
  rescan();
  finishScan();
  pending.resolve({ json: { serial_number: '1' }, exitCode: 0 });
  await assert.rejects(old, /aktualisiert|geändert/);
  assert.deepEqual(saved, []);
});

test('new request for same path cannot be overwritten or saved by old read', async () => {
  const pending = deferred();
  let reads = 0;
  const { service, saved, rescan, finishScan } = setup({
    smartRead: () => {
      reads++;
      return reads === 1 ? pending.promise : { json: { serial_number: '2' }, exitCode: 0 };
    },
  });
  const old = service.detail({ name: '/dev/sda', type: 'sat' });
  await Promise.resolve();
  await Promise.resolve();
  rescan();
  finishScan();
  const current = await service.detail({ name: '/dev/sda', type: 'sat' });
  pending.resolve({ json: { serial_number: '1' }, exitCode: 0 });
  await assert.rejects(old, /aktualisiert|geändert/);
  assert.deepEqual(
    saved.map((r) => r.raw.serial_number),
    ['2'],
  );
  assert.equal(current.raw.serial_number, '2');
});

test('scanning blocks starting a new diagnostic read', async () => {
  const { service, rescan } = setup();
  rescan();
  await assert.rejects(service.detail({ name: '/dev/sda' }), /Laufwerkserkennung läuft/);
});

test('simultaneous IPC readers of one SMART snapshot write one automatic history entry', async () => {
  const pending = deferred();
  const { service, saved } = setup({ smartRead: () => pending.promise });
  const first = service.detail({ name: '/dev/sda', type: 'sat' });
  const second = service.detail({ name: '/dev/sda', type: 'sat' });
  pending.resolve({ json: { serial_number: 'stable' }, exitCode: 0 });
  const [a, b] = await Promise.all([first, second]);
  assert.strictEqual(a, b);
  assert.equal(saved.length, 1);
});

test('explicit refresh starts a new backend SMART read even while an older read is pending', async () => {
  const oldRead = deferred();
  const freshRead = deferred();
  let calls = 0;
  const { service, saved } = setup({
    smartRead: () => (++calls === 1 ? oldRead.promise : freshRead.promise),
  });
  const device = { name: '/dev/sda', type: 'sat' };
  const oldRequest = service.detail(device);
  // Allow the old request to reach smartAccess.
  await new Promise((resolve) => setImmediate(resolve));
  const refresh = service.detail(device, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  oldRead.resolve({ json: { serial_number: 'OLD' }, exitCode: 0 });
  await assert.rejects(oldRequest, /aktualisiert|geändert/);
  freshRead.resolve({ json: { serial_number: 'NEW' }, exitCode: 0 });
  const report = await refresh;
  assert.equal(report.raw.serial_number, 'NEW');
  assert.deepEqual(
    saved.map((row) => row.raw.serial_number),
    ['NEW'],
  );
});

test('ordinary simultaneous backend subscribers continue to share a single read', async () => {
  const pending = deferred();
  let calls = 0;
  const { service } = setup({
    smartRead: () => {
      calls++;
      return pending.promise;
    },
  });
  const d = { name: '/dev/sdb', type: 'sat' };
  const a = service.detail(d, false);
  const b = service.detail(d);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  pending.resolve({ json: { serial_number: 'SAME' }, exitCode: 0 });
  assert.strictEqual(await a, await b);
});

test('nonboolean explicit refresh flag is refused before hardware access', async () => {
  const { service } = setup();
  await assert.rejects(service.detail({ name: '/dev/sda' }, 'yes'), /Invalid refresh flag/);
});

test('refresh remains independent through the real per-device operation queue', async () => {
  const { createDeviceOperations } = require('../../electron/devices/device-operations.js');
  const oldRead = deferred();
  let sequence = 0;
  const saved = [];
  const reports = createDetailCache();
  const service = createDiagnosticService({
    validateDevice: (d) => d,
    assertDevice: (d) => d,
    deviceKey: (d) => d.name,
    reports,
    operations: createDeviceOperations(),
    smartAccess: {
      detail: async () => {
        sequence++;
        if (sequence === 1) return oldRead.promise;
        return { json: { serial_number: 'NEW' }, exitCode: 0 };
      },
    },
    evaluate: () => ({ status: 'ok', readout: { status: 'vollstaendig' } }),
    history: {
      identity: () => 'drive-a',
      save: async (_, row) => {
        saved.push(row);
      },
    },
    getSettings: () => ({ autoSaveHistory: true }),
    getUserDataPath: () => '/tmp/fake',
    scanGeneration: () => 1,
    isScanning: () => false,
    createId: () => `report-${sequence}`,
    logSaveError: (e) => {
      throw e;
    },
  });
  const d = { name: '/dev/sda', type: 'sat' };
  const first = service.detail(d);
  await new Promise((resolve) => setImmediate(resolve));
  const forced = service.detail(d, true);
  // The second command waits for the first command's disk lock.
  assert.equal(sequence, 1);
  oldRead.resolve({ json: { serial_number: 'OLD' }, exitCode: 0 });
  await assert.rejects(first, /aktualisiert|geändert/);
  const newest = await forced;
  assert.equal(sequence, 2);
  assert.equal(newest.raw.serial_number, 'NEW');
  assert.deepEqual(
    saved.map((r) => r.raw.serial_number),
    ['NEW'],
  );
});

test('queued diagnosis never touches a device after a new scan has revoked the request', async () => {
  const { createDeviceOperations } = require('../../electron/devices/device-operations.js');
  const reports = createDetailCache();
  const operations = createDeviceOperations();
  const blocker = deferred();
  let generation = 1;
  let reads = 0;
  const hold = operations.run('/dev/sda', () => blocker.promise);
  const service = createDiagnosticService({
    validateDevice: (d) => d,
    assertDevice: (d) => d,
    deviceKey: (d) => d.name,
    reports,
    operations,
    smartAccess: {
      detail: async () => {
        reads++;
        return { json: { serial_number: 'OLD' }, exitCode: 0 };
      },
    },
    evaluate: () => ({ status: 'ok', readout: { status: 'vollstaendig' } }),
    history: { identity: () => null },
    getSettings: () => ({ autoSaveHistory: false }),
    getUserDataPath: () => '/tmp/fake',
    scanGeneration: () => generation,
    isScanning: () => false,
    createId: () => 'report-id',
    logSaveError: () => {},
  });
  const pending = service.detail({ name: '/dev/sda', type: 'sat' });
  await new Promise((resolve) => setImmediate(resolve));
  generation++;
  reports.reset();
  blocker.resolve();
  await hold;
  await assert.rejects(pending, /aktualisiert|geändert/);
  assert.equal(reads, 0, 'the stale request must never issue smartctl');
  assert.equal((await service.detail({ name: '/dev/sda', type: 'sat' })).reportId, 'report-id');
  assert.equal(reads, 1, 'a newly authorized request can still run');
});

test('queued diagnosis is not executed after an access mode change', async () => {
  const { createDeviceOperations } = require('../../electron/devices/device-operations.js');
  const reports = createDetailCache();
  const operations = createDeviceOperations();
  const hold = deferred();
  const busy = operations.run('/dev/sda', () => hold.promise);
  let authorizedType = 'sat';
  let reads = 0;
  const service = createDiagnosticService({
    validateDevice: (d) => d,
    assertDevice: (d) => {
      if (d.type !== authorizedType) throw new Error('device not authorized');
      return d;
    },
    deviceKey: (d) => `${d.name}\0${d.type}`,
    reports,
    operations,
    smartAccess: {
      detail: async () => {
        reads++;
        return { json: {}, exitCode: 0 };
      },
    },
    evaluate: () => ({}),
    history: { identity: () => null },
    getSettings: () => ({ autoSaveHistory: false }),
    getUserDataPath: () => '/tmp/fake',
    scanGeneration: () => 1,
    isScanning: () => false,
    createId: () => 'id',
    logSaveError: () => {},
  });
  const pending = service.detail({ name: '/dev/sda', type: 'sat' });
  await new Promise((resolve) => setImmediate(resolve));
  authorizedType = 'sntjmicron';
  reports.invalidate('/dev/sda\0sat');
  hold.resolve();
  await busy;
  await assert.rejects(pending, /not authorized/);
  assert.equal(reads, 0);
});
