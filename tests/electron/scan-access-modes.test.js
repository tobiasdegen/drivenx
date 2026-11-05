'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  collectAccessModes,
  samePhysicalDisk,
  resolveAccessModes,
} = require('../../electron/devices/scan-access-modes.js');
const sat = { name: '/dev/sdb', type: 'sat' };
const auto = { name: '/dev/sdb', type: 'auto' };
const raid0 = { name: '/dev/sda', type: 'megaraid,0' };
const raid1 = { name: '/dev/sda', type: 'megaraid,1' };
function ata(serial) {
  return {
    model_name: 'Disk 1',
    serial_number: serial,
    user_capacity: { bytes: 1000204886016 },
    device: { protocol: 'ATA' },
  };
}
test('discover both access modes on one path but deduplicate exact selectors', () => {
  assert.deepEqual(collectAccessModes([sat, auto, sat]), [sat, auto]);
});
test('identical verified physical disk keeps preferred scan-open access mode', async () => {
  const list = await resolveAccessModes([sat, auto], async () => ata('REAL-123-ABC'));
  assert.deepEqual(list, [sat]);
});
test('same path with different RAID members keeps both', async () => {
  assert.deepEqual(await resolveAccessModes([raid0, raid1], async (d) => ata(d.type)), [
    raid0,
    raid1,
  ]);
});
test('ambiguous identity or failed probe must keep both devices', async () => {
  assert.deepEqual(await resolveAccessModes([sat, auto], async () => ata('1234567890')), [
    sat,
    auto,
  ]);
  assert.deepEqual(
    await resolveAccessModes([sat, auto], async (d) => {
      if (d.type === 'auto') throw new Error('bridge failure');
      return ata('REAL-123-ABC');
    }),
    [sat, auto],
  );
});
test('different sizes, models, serials and incompatible protocols are never merged', () => {
  const disk = ata('REAL-123-ABC');
  assert.equal(samePhysicalDisk(disk, { ...disk, user_capacity: { bytes: 500000000 } }), false);
  assert.equal(samePhysicalDisk(disk, { ...disk, model_name: 'Other' }), false);
  assert.equal(samePhysicalDisk(disk, ata('OTHER-123-ABC')), false);
  assert.equal(samePhysicalDisk(disk, { ...disk, device: { protocol: 'SCSI' } }), false);
});
test('NVMe namespaces are never collapsed without verified namespace signatures', () => {
  const disk = {
    device: { type: 'nvme', protocol: 'NVMe' },
    model_name: 'Test NVMe',
    serial_number: 'NVME-REAL-123',
    user_capacity: { bytes: 1000204886016 },
  };
  assert.equal(samePhysicalDisk(disk, disk), false);
});

test('different MegaRAID slots are preserved without slow or misleading identity probes', async () => {
  let probes = 0;
  const targets = [raid0, raid1, { name: '/dev/sda', type: 'megaraid,2' }];
  assert.deepEqual(
    await resolveAccessModes(targets, async () => {
      probes++;
      return ata('CONTROLLER-SERIAL-SHARED');
    }),
    targets,
  );
  assert.equal(probes, 0);
});

test('unreadable first access mode does not cause a pointless second bridge timeout', async () => {
  const calls = [];
  const result = await resolveAccessModes([sat, auto], async (d) => {
    calls.push(d.type);
    throw new Error('timed out');
  });
  assert.deepEqual(result, [sat, auto]);
  assert.deepEqual(calls, ['sat']);
});

test('identity probing has a shared budget and preserves every unverified selector', async () => {
  const drives = [
    { name: '/dev/sda', type: 'sat' },
    { name: '/dev/sda', type: 'auto' },
    { name: '/dev/sdb', type: 'sat' },
    { name: '/dev/sdb', type: 'auto' },
    { name: '/dev/sdc', type: 'sat' },
    { name: '/dev/sdc', type: 'auto' },
  ];
  let elapsed = 0;
  const timeouts = [];
  const result = await resolveAccessModes(
    drives,
    async (_device, timeoutMs) => {
      timeouts.push(timeoutMs);
      elapsed += timeoutMs;
      return ata(`DRIVE-${timeouts.length}`);
    },
    { now: () => elapsed, budgetMs: 15000, maxProbes: 10 },
  );
  assert.deepEqual(timeouts, [9000, 6000]);
  assert.deepEqual(result, drives, 'insufficient proof may not silently hide disks');
});

test('scan uses a global cap even when identity probes complete immediately', async () => {
  const devices = Array.from({ length: 6 }, (_, index) => [
    { name: `/dev/sd${index}`, type: 'sat' },
    { name: `/dev/sd${index}`, type: 'auto' },
  ]).flat();
  let calls = 0;
  const output = await resolveAccessModes(
    devices,
    async () => {
      calls++;
      return ata(`SERIAL-${calls}`);
    },
    { now: () => 0, budgetMs: 18000, maxProbes: 3 },
  );
  assert.equal(calls, 3);
  assert.deepEqual(output, devices);
});

test('verified matching identities are de-duplicated when there is enough time', async () => {
  const devices = [sat, auto];
  const seenTimeouts = [];
  const resolved = await resolveAccessModes(devices, async (_device, timeoutMs) => {
    seenTimeouts.push(timeoutMs);
    return ata('SERIAL-123456');
  });
  assert.deepEqual(resolved, [sat]);
  assert.equal(seenTimeouts.length, 2);
});
