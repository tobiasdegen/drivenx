'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequestTracker } = require('../../src/request-tracker.mjs');
const {
  chooseScannedDevice,
  scheduleScanFollowups,
  startBackgroundReads,
} = require('../../src/scan-followups.mjs');
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const device = (name, type = 'sat') => ({ name, type });

const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

test('selection survives a smartctl access-type change and still prefers exact matches', () => {
  const old = device('/dev/sda', 'sat');
  const newDevice = device('/dev/sda', 'usbjmicron');
  const other = device('/dev/sdb');
  assert.equal(chooseScannedDevice([other, newDevice], '/dev/sda\0sat', old.name), newDevice);
  assert.equal(chooseScannedDevice([old, other], '/dev/sda\0sat', old.name), old);
  assert.equal(chooseScannedDevice([other], '/dev/sda\0sat', old.name), other);
});

test('optional Windows metadata never overwrites a new scan', async () => {
  const tracker = createRequestTracker();
  const epoch = tracker.beginScan();
  const wait = deferred();
  const ref = { current: [device('/dev/sda')] };
  const updates = [];
  scheduleScanFollowups({
    result: { generation: 1, metadataPending: true },
    epoch,
    tracker,
    api: { scanMetadata: () => wait.promise },
    deviceRef: ref,
    aliasGroupsRef: { current: [] },
    selectedRef: { current: '/dev/sda\0sat' },
    onDevices: (x) => updates.push(x),
    onNotice: () => {},
  });
  tracker.beginScan();
  wait.resolve({ devices: [{ ...device('/dev/sda'), capacityBytes: 12345 }] });
  await settle();
  assert.equal(updates.length, 0);
  assert.equal(ref.current[0].capacityBytes, undefined);
});

test('background details limit concurrency and skip obsolete requests', async () => {
  const tracker = createRequestTracker();
  const epoch = tracker.beginScan();
  tracker.select('/dev/sda\0sat');
  let running = 0;
  let peak = 0;
  const wait = deferred();
  const updates = [];
  const promise = startBackgroundReads({
    devices: [device('/dev/sda'), device('/dev/sdb'), device('/dev/sdc'), device('/dev/sdd')],
    selectedKey: '/dev/sda\0sat',
    epoch,
    tracker,
    api: {
      detail: async (d) => {
        running++;
        peak = Math.max(peak, running);
        await wait.promise;
        running--;
        return { device: d };
      },
    },
    onDetail: (key) => updates.push(key),
    onError: () => {},
  });
  await settle();
  assert.equal(peak, 2);
  tracker.beginScan();
  wait.resolve();
  await promise;
  assert.deepEqual(updates, []);
});

test('Windows NVMe metadata survives either asynchronous response order', async () => {
  const aliases = [device('/dev/sda', 'nvme'), device('/dev/nvme0', 'nvme')];
  for (const first of ['metadata', 'aliases']) {
    const tracker = createRequestTracker();
    const epoch = tracker.beginScan();
    const windows = deferred();
    const duplicateCheck = deferred();
    const deviceRef = { current: aliases.map((entry) => ({ ...entry })) };
    const aliasGroupsRef = { current: [] };
    const selectedRef = { current: '/dev/nvme0\0nvme' };
    const updates = [];
    scheduleScanFollowups({
      result: { generation: 12, metadataPending: true, aliasCheckPending: true },
      epoch,
      tracker,
      deviceRef,
      aliasGroupsRef,
      selectedRef,
      api: { scanMetadata: () => windows.promise, scanAliases: () => duplicateCheck.promise },
      onDevices: (devices) => updates.push(devices),
      onNotice: () => {},
    });
    const finish = {
      metadata: () =>
        windows.resolve({
          devices: [{ ...aliases[0], transport: 'PCIe', capacityBytes: 1000204886016 }],
          message: [],
        }),
      aliases: () => duplicateCheck.resolve({ groups: [aliases] }),
    };
    finish[first]();
    await settle();
    finish[first === 'metadata' ? 'aliases' : 'metadata']();
    await settle();
    assert.equal(updates.length, 2, first);
    assert.equal(deviceRef.current.length, 1, first);
    assert.equal(deviceRef.current[0].name, '/dev/nvme0', first);
    assert.equal(deviceRef.current[0].transport, 'PCIe', first);
    assert.equal(deviceRef.current[0].capacityBytes, 1000204886016, first);
    assert.equal(selectedRef.current, '/dev/nvme0\0nvme', first);
  }
});

test('obsolete NVMe aliases cannot remove drives from a newer scan', async () => {
  const tracker = createRequestTracker();
  const epoch = tracker.beginScan();
  const pending = deferred();
  const devices = [device('/dev/sda', 'nvme'), device('/dev/nvme0', 'nvme')];
  const deviceRef = { current: devices };
  const groups = { current: [] };
  let publications = 0;
  scheduleScanFollowups({
    result: { generation: 3, aliasCheckPending: true },
    epoch,
    tracker,
    api: { scanAliases: () => pending.promise },
    deviceRef,
    aliasGroupsRef: groups,
    selectedRef: { current: '/dev/sda\0nvme' },
    onDevices: () => publications++,
    onNotice: () => {},
  });
  tracker.beginScan();
  const nextDevices = [device('/dev/sdb', 'sat')];
  deviceRef.current = nextDevices;
  pending.resolve({ groups: [devices] });
  await settle();
  assert.equal(publications, 0);
  assert.deepEqual(deviceRef.current, nextDevices);
  assert.deepEqual(groups.current, []);
});

test('sidebar errors are attributed to the correct drive and do not stop later reads', async () => {
  const tracker = createRequestTracker();
  const epoch = tracker.beginScan();
  const details = [];
  const errors = [];
  await startBackgroundReads({
    devices: [device('/dev/sda'), device('/dev/sdb'), device('/dev/sdc'), device('/dev/sdd')],
    selectedKey: '/dev/sda\0sat',
    epoch,
    tracker,
    api: {
      detail: async (d) => {
        if (d.name === '/dev/sdb') throw new Error('smartctl failed');
        return { device: d.name };
      },
    },
    onDetail: (key) => details.push(key),
    onError: (key) => errors.push(key),
  });
  assert.deepEqual(errors, ['/dev/sdb\0sat']);
  assert.deepEqual(details.sort(), ['/dev/sdc\0sat', '/dev/sdd\0sat']);
});

test('background queue skips a drive newly selected while earlier jobs are running', async () => {
  const tracker = createRequestTracker();
  const epoch = tracker.beginScan();
  tracker.select('/dev/sda\0sat');
  const waiting = deferred();
  const attempted = [];
  const reads = startBackgroundReads({
    devices: [
      device('/dev/sda'),
      device('/dev/sdb'),
      device('/dev/sdc'),
      device('/dev/sdd'),
      device('/dev/sde'),
    ],
    selectedKey: '/dev/sda\0sat',
    epoch,
    tracker,
    api: {
      detail: async (item) => {
        attempted.push(item.name);
        if (item.name === '/dev/sdb' || item.name === '/dev/sdc') await waiting.promise;
        return { reportId: item.name };
      },
    },
    onDetail: () => {},
    onError: () => {},
  });
  await settle();
  tracker.select('/dev/sdd\0sat');
  waiting.resolve();
  await reads;
  assert.deepEqual(attempted.sort(), ['/dev/sdb', '/dev/sdc', '/dev/sde']);
});

test('verified Windows NVMe aliases fill missing fields without overriding the retained path', async () => {
  const { collapseScanAliases } = await import('../../src/scan-metadata.mjs');
  const selected = {
    ...device('/dev/nvme0', 'nvme'),
    transport: 'PCIe',
    internal: false,
    osMetadata: { source: 'nvme-controller' },
  };
  const alternate = {
    ...device('/dev/sda', 'nvme'),
    transport: 'USB',
    internal: true,
    capacityBytes: 500107862016,
    connection: { verified: true, source: 'windows-pnp', chain: [{ name: 'Verified USB bridge' }] },
  };
  const result = collapseScanAliases(
    [selected, alternate],
    [[device('/dev/nvme0', 'nvme'), device('/dev/sda', 'nvme')]],
    '/dev/nvme0\0nvme',
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].name, '/dev/nvme0');
  assert.equal(result[0].transport, 'PCIe');
  assert.equal(result[0].internal, false);
  assert.equal(result[0].osMetadata.source, 'nvme-controller');
  assert.equal(result[0].capacityBytes, 500107862016);
  assert.equal(result[0].connection.chain[0].name, 'Verified USB bridge');
});

test('partial Windows metadata survives both asynchronous reply orders for verified aliases', async () => {
  const nvme = { ...device('/dev/nvme0', 'nvme'), transport: 'PCIe', internal: false };
  const alternate = device('/dev/sda', 'nvme');
  for (const first of ['metadata', 'aliases']) {
    const tracker = createRequestTracker();
    const epoch = tracker.beginScan();
    const windows = deferred();
    const aliases = deferred();
    const deviceRef = { current: [nvme, alternate].map((d) => ({ ...d })) };
    const aliasGroupsRef = { current: [] };
    const groups = [[nvme, alternate]];
    scheduleScanFollowups({
      result: { generation: 21, metadataPending: true, aliasCheckPending: true },
      epoch,
      tracker,
      deviceRef,
      aliasGroupsRef,
      selectedRef: { current: '/dev/nvme0\0nvme' },
      api: { scanMetadata: () => windows.promise, scanAliases: () => aliases.promise },
      onDevices: () => {},
      onNotice: () => {},
    });
    const finish = {
      metadata: () =>
        windows.resolve({
          devices: [
            {
              ...alternate,
              capacityBytes: 500000000000,
              transport: 'USB',
              connection: { verified: true, source: 'windows-pnp', chain: [{ name: 'Bridge' }] },
            },
          ],
          message: [],
        }),
      aliases: () => aliases.resolve({ groups }),
    };
    finish[first]();
    await settle();
    finish[first === 'metadata' ? 'aliases' : 'metadata']();
    await settle();
    const [kept] = deviceRef.current;
    assert.equal(deviceRef.current.length, 1, first);
    assert.equal(kept.name, '/dev/nvme0', first);
    assert.equal(kept.transport, 'PCIe', first);
    assert.equal(kept.internal, false, first);
    assert.equal(kept.capacityBytes, 500000000000, first);
    assert.equal(kept.connection.chain[0].name, 'Bridge', first);
  }
});

test('background read does not publish a verified alias removed while its IPC reply is pending', async () => {
  const tracker = createRequestTracker();
  const epoch = tracker.beginScan();
  tracker.select('/dev/nvme0\0nvme');
  const alias = device('/dev/sda', 'nvme');
  const keep = device('/dev/nvme0', 'nvme');
  const visible = { current: [alias, keep] };
  const pending = deferred();
  const updates = [];
  const work = startBackgroundReads({
    devices: visible.current,
    selectedKey: '/dev/nvme0\0nvme',
    epoch,
    tracker,
    isDeviceCurrent: (key) => visible.current.some((d) => `${d.name}\0${d.type}` === key),
    api: { detail: () => pending.promise },
    onDetail: (key) => updates.push(key),
    onError: (key) => updates.push(key),
  });
  await settle();
  visible.current = [keep];
  pending.resolve({ reportId: 'old-alias-report' });
  await work;
  assert.deepEqual(updates, []);
});

test('background queue skips alias removed before its turn without issuing an IPC query', async () => {
  const tracker = createRequestTracker();
  const epoch = tracker.beginScan();
  tracker.select('/dev/sda\0sat');
  const visible = {
    current: [device('/dev/sda'), device('/dev/sdb'), device('/dev/sdc'), device('/dev/sdd')],
  };
  const wait = deferred();
  const queried = [];
  const work = startBackgroundReads({
    devices: visible.current,
    selectedKey: '/dev/sda\0sat',
    epoch,
    tracker,
    isDeviceCurrent: (key) => visible.current.some((d) => `${d.name}\0${d.type}` === key),
    api: {
      detail: async (d) => {
        queried.push(d.name);
        if (d.name === '/dev/sdb') await wait.promise;
        return {};
      },
    },
    onDetail: () => {},
    onError: () => {},
  });
  await settle();
  visible.current = visible.current.filter((d) => d.name !== '/dev/sdd');
  wait.resolve();
  await work;
  assert.equal(queried.includes('/dev/sdd'), false);
});

test('optional background reads wait for alias verification and only see retained paths', async () => {
  const tracker = createRequestTracker();
  const epoch = tracker.beginScan();
  const alias = device('/dev/sda', 'nvme');
  const keep = device('/dev/nvme0', 'nvme');
  const other = device('/dev/sdb', 'sat');
  tracker.select('/dev/nvme0\0nvme');
  const deviceRef = { current: [alias, keep, other] };
  const selectedRef = { current: '/dev/nvme0\0nvme' };
  const aliasReply = deferred();
  const queried = [];
  const ready = scheduleScanFollowups({
    result: { generation: 50, aliasCheckPending: true },
    epoch,
    tracker,
    deviceRef,
    selectedRef,
    aliasGroupsRef: { current: [] },
    api: { scanAliases: () => aliasReply.promise },
    onDevices: () => {},
    onNotice: () => {},
  });
  const background = ready.then(() =>
    startBackgroundReads({
      devices: deviceRef.current,
      selectedKey: selectedRef.current,
      epoch,
      tracker,
      isDeviceCurrent: (key) => deviceRef.current.some((d) => `${d.name}\0${d.type}` === key),
      api: {
        detail: async (d) => {
          queried.push(d.name);
          return {};
        },
      },
      onDetail: () => {},
      onError: () => {},
    }),
  );
  await settle();
  assert.deepEqual(queried, [], 'no alias is queried while verification is outstanding');
  aliasReply.resolve({ groups: [[alias, keep]] });
  await background;
  assert.deepEqual(deviceRef.current.map((d) => d.name).sort(), ['/dev/nvme0', '/dev/sdb']);
  assert.deepEqual(queried, ['/dev/sdb']);
});

test('failed alias verification releases the optional background read gate without collapsing devices', async () => {
  const tracker = createRequestTracker();
  const epoch = tracker.beginScan();
  const drives = [device('/dev/nvme0', 'nvme'), device('/dev/sda', 'nvme')];
  const deviceRef = { current: drives };
  const ready = scheduleScanFollowups({
    result: { generation: 30, aliasCheckPending: true },
    epoch,
    tracker,
    deviceRef,
    selectedRef: { current: '/dev/nvme0\0nvme' },
    aliasGroupsRef: { current: [] },
    api: {
      scanAliases: async () => {
        throw new Error('identity lookup unsupported');
      },
    },
    onDevices: () => assert.fail('unverified identities must never be collapsed'),
    onNotice: () => {},
  });
  await ready;
  assert.deepEqual(deviceRef.current, drives);
});

test('late sidebar details or errors cannot replace the active drive after it becomes selected', async () => {
  for (const fail of [false, true]) {
    const tracker = createRequestTracker();
    const epoch = tracker.beginScan();
    tracker.select('/dev/sda\0sat');
    let reject;
    let resolve;
    const gate = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const details = [],
      errors = [];
    const reading = startBackgroundReads({
      devices: [device('/dev/sda'), device('/dev/sdb')],
      selectedKey: '/dev/sda\0sat',
      epoch,
      tracker,
      api: { detail: () => gate },
      onDetail: (key) => details.push(key),
      onError: (key) => errors.push(key),
    });
    await settle();
    tracker.select('/dev/sdb\0sat');
    if (fail) reject(new Error('outdated SMART failure'));
    else resolve({ reportId: 'outdated' });
    await reading;
    assert.deepEqual(details, []);
    assert.deepEqual(errors, []);
  }
});
