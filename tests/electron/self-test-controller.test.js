'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSelfTestController } = require('../../electron/devices/self-test-controller.js');
const { createDeviceOperations } = require('../../electron/devices/device-operations.js');
const { createDetailCache } = require('../../electron/diagnostics/detail-cache.js');
const device = { name: '/dev/sda', type: 'auto' };
const raw = (serial = 'ABCD0123') => ({
  model_name: 'Drive',
  serial_number: serial,
  user_capacity: { bytes: 1000000 },
  ata_smart_data: { capabilities: { self_tests_supported: true } },
});
function harness({ realSerial = 'ABCD0123', testAction } = {}) {
  const reports = createDetailCache();
  const commands = [];
  let generation = 1;
  let scanning = false;
  const smartAccess = {
    detail: async () => ({ json: raw(realSerial), exitCode: 0 }),
    startTest: async (d, kind) => {
      commands.push({ d, kind });
      return testAction ? testAction(d, kind) : { json: {}, exitCode: 0 };
    },
  };
  const controller = createSelfTestController({
    reports,
    operations: createDeviceOperations(),
    smartAccess,
    assertDevice: (d) => d,
    deviceKey: (d) => d.name,
    isScanning: () => scanning,
    scanGeneration: () => generation,
  });
  const request = { device, kind: 'short', reportId: 'report-1' };
  const init = () =>
    reports.load(device.name, async () => ({ reportId: request.reportId, raw: raw() }));
  return {
    controller,
    reports,
    smartAccess,
    commands,
    request,
    init,
    setScanning: (value) => {
      scanning = value;
    },
    advanceGeneration: () => {
      generation++;
    },
  };
}
test('matched scan and confirmed identity allow the command and invalidate report', async () => {
  const h = harness();
  await h.init();
  const result = await h.controller.start(h.request);
  assert.equal(result, true);
  assert.equal(h.commands.length, 1);
  assert.equal(h.reports.get(device.name), undefined);
});
test('mismatching serial number aborts before a dangerous command', async () => {
  const h = harness({ realSerial: 'WRONG123' });
  await h.init();
  await assert.rejects(h.controller.start(h.request), /ausgetauscht/);
  assert.equal(h.commands.length, 0);
});
test('missing displayed report and outdated report identity block start', async () => {
  const h = harness();
  await assert.rejects(h.controller.start(h.request), /veraltet/);
  await h.init();
  await assert.rejects(h.controller.start({ ...h.request, reportId: 'older' }), /veraltet/);
  assert.equal(h.commands.length, 0);
});
test('scanning at start or after probe blocks starting the SMART test', async () => {
  const h = harness();
  await h.init();
  h.setScanning(true);
  await assert.rejects(h.controller.start(h.request), /Laufwerkserkennung läuft/);
  h.setScanning(false);
  h.smartAccess.detail = async () => {
    h.advanceGeneration();
    return { json: raw(), exitCode: 0 };
  };
  await assert.rejects(h.controller.start(h.request), /Laufwerkserkennung hat sich geändert/);
  assert.equal(h.commands.length, 0);
});
test('two simultaneous test requests on one drive cannot both start', async () => {
  const h = harness();
  await h.init();
  let release;
  const running = new Promise((resolve) => {
    release = resolve;
  });
  h.smartAccess.detail = async () => {
    await running;
    return { json: raw(), exitCode: 0 };
  };
  const first = h.controller.start(h.request);
  await assert.rejects(h.controller.start(h.request), /bereits ausgeführt/);
  release();
  await first;
  assert.equal(h.commands.length, 1);
  assert.equal(h.controller.isPending(), false);
});
test('an attempted test invalidates the old report even on execution failure', async () => {
  const h = harness({
    testAction: async () => {
      throw Error('timeout');
    },
  });
  await h.init();
  await assert.rejects(h.controller.start(h.request), /timeout/);
  assert.equal(h.reports.get(device.name), undefined);
  assert.equal(h.controller.isPending(), false);
});
test('already-running device SMART test blocks new command', async () => {
  const h = harness();
  await h.init();
  h.smartAccess.detail = async () => ({
    json: {
      ...raw(),
      ata_smart_data: {
        capabilities: { self_tests_supported: true },
        self_test: { status: { value: 240 } },
      },
    },
    exitCode: 0,
  });
  await assert.rejects(h.controller.start(h.request), /bereits ein SMART-Selbsttest/);
  assert.equal(h.commands.length, 0);
});

test('failed SMART identity probe never starts a test even with matching serial', async () => {
  for (const failure of [
    { exitCode: 2, json: raw() },
    { exitCode: 1, json: raw() },
    { exitCode: 4, json: raw() },
    {
      exitCode: 0,
      json: { ...raw(), smartctl: { messages: [{ severity: 'error', string: 'open failed' }] } },
    },
    { exitCode: undefined, json: raw() },
    { exitCode: 0, json: null },
  ]) {
    const h = harness();
    await h.init();
    h.smartAccess.detail = async () => failure;
    await assert.rejects(h.controller.start(h.request), /Kontrollabfrage fehlgeschlagen/);
    assert.equal(h.commands.length, 0);
    assert.equal(h.reports.get(device.name)?.reportId, h.request.reportId);
    assert.equal(h.controller.isPending(), false);
  }
});
test('nonfailure smartctl health bits do not wrongly block a safe identity probe', async () => {
  const h = harness();
  await h.init();
  h.smartAccess.detail = async () => ({ json: raw(), exitCode: 8 });
  const result = await h.controller.start(h.request);
  assert.equal(result, true);
  assert.equal(h.commands.length, 1);
});

test('separate access types on one path cannot start parallel SMART self-tests', async () => {
  const reports = createDetailCache();
  const operations = createDeviceOperations();
  const modes = [
    { name: '/dev/sdb', type: 'sat' },
    { name: '/dev/sdb', type: 'auto' },
  ];
  const deviceKey = (d) => `${d.name}\0${d.type}`;
  for (const d of modes)
    await reports.load(deviceKey(d), async () => ({ reportId: d.type, raw: raw() }));
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started = 0;
  const controller = createSelfTestController({
    reports,
    operations,
    deviceKey,
    assertDevice: (d) => d,
    isScanning: () => false,
    scanGeneration: () => 1,
    smartAccess: {
      detail: async () => {
        await gate;
        return { json: raw(), exitCode: 0 };
      },
      startTest: async () => {
        started++;
        return { json: {}, exitCode: 0 };
      },
    },
  });
  const first = controller.start({ device: modes[0], kind: 'short', reportId: 'sat' });
  await assert.rejects(
    controller.start({ device: modes[1], kind: 'short', reportId: 'auto' }),
    /bereits ausgeführt/,
  );
  release();
  await first;
  assert.equal(started, 1);
});

test('unknown or explicitly unsupported SMART self-test capabilities prevent any command', async () => {
  for (const capability of [undefined, false]) {
    const h = harness();
    await h.init();
    h.smartAccess.detail = async () => ({
      json: {
        ...raw(),
        ata_smart_data:
          capability === undefined
            ? undefined
            : { capabilities: { self_tests_supported: capability } },
      },
      exitCode: 0,
    });
    await assert.rejects(h.controller.start(h.request), /Unterstützung|unterstützt keine/);
    assert.equal(h.commands.length, 0);
    assert.equal(h.reports.get(device.name)?.reportId, h.request.reportId);
  }
});

test('controller returns only device-operation status; the IPC boundary owns localized success copy', async () => {
  const h = harness();
  await h.init();
  assert.equal(await h.controller.start(h.request), true);
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, 'main.js'), 'utf8');
  assert.match(main, /getCatalogSection\(settings\.locale, 'smartView'\)\.selfTestStarted/);
  const { getCatalogSection } = require('../../electron/ui/translator.js');
  assert.notEqual(
    getCatalogSection('de-DE', 'smartView').selfTestStarted,
    getCatalogSection('en-US', 'smartView').selfTestStarted,
  );
});

test('queued self-test does not probe hardware if the scan generation changed while waiting', async () => {
  const h = harness();
  await h.init();
  let unblock;
  const held = new Promise((resolve) => {
    unblock = resolve;
  });
  let reads = 0;
  let generation = 5;
  const controller = createSelfTestController({
    operations: {
      run: async (_name, job) => {
        await held;
        return job();
      },
    },
    reports: h.reports,
    smartAccess: {
      detail: async () => {
        reads++;
        return { json: raw(), exitCode: 0 };
      },
      startTest: async () => {
        throw new Error('must not execute');
      },
    },
    assertDevice: (device) => device,
    deviceKey: (device) => device.name,
    isScanning: () => false,
    scanGeneration: () => generation,
  });
  const pending = controller.start(h.request);
  generation++;
  unblock();
  await assert.rejects(pending, /Laufwerkserkennung hat sich geändert/);
  assert.equal(reads, 0);
});
