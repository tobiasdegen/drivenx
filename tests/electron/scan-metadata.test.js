'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const modulePromise = import(
  pathToFileURL(path.join(ELECTRON_SOURCE_DIR, '..', 'src', 'scan-metadata.mjs')).href
);

test('late Windows enrichment changes only optional metadata of the same device', async () => {
  const { mergeScanMetadata } = await modulePromise;
  const drives = [
    { name: '/dev/sda', type: 'sat', info_name: 'Disk 0' },
    { name: '/dev/sdb', type: 'nvme' },
  ];
  const after = mergeScanMetadata(drives, [
    {
      name: '/dev/sda',
      type: 'sat',
      transport: 'USB',
      capacityBytes: 5000000,
      info_name: 'ignored',
    },
    { name: '/dev/sdc', type: 'sat', transport: 'USB' },
  ]);
  assert.equal(after.length, 2);
  assert.equal(after[0].info_name, 'Disk 0');
  assert.equal(after[0].transport, 'USB');
  assert.equal(after[0].capacityBytes, 5000000);
  assert.deepEqual(after[1], drives[1]);
});

test('enrichment cannot replace smartctl access type or create changed devices', async () => {
  const { mergeScanMetadata } = await modulePromise;
  const drives = [{ name: '/dev/sda', type: 'sat' }];
  assert.deepEqual(
    mergeScanMetadata(drives, [{ name: '/dev/sda', type: 'scsi', transport: 'USB' }]),
    drives,
  );
  assert.deepEqual(mergeScanMetadata(drives, []), drives);
  assert.deepEqual(mergeScanMetadata(drives, null), drives);
});

test('verified NVMe aliases collapse to one entry, preserving the active path', async () => {
  const { collapseScanAliases } = await modulePromise;
  const devices = [
    { name: '/dev/sda', type: 'nvme' },
    { name: '/dev/nvme0', type: 'nvme' },
    { name: '/dev/sdb', type: 'sat' },
  ];
  const groups = [
    [
      { name: '/dev/sda', type: 'nvme' },
      { name: '/dev/nvme0', type: 'nvme' },
    ],
  ];
  assert.deepEqual(
    collapseScanAliases(devices, groups, '/dev/sda\u0000nvme').map((d) => d.name),
    ['/dev/sda', '/dev/sdb'],
  );
  assert.deepEqual(
    collapseScanAliases(devices, groups, '/dev/sdb\u0000sat').map((d) => d.name),
    ['/dev/nvme0', '/dev/sdb'],
  );
});
test('late CIM metadata is not lost when its /dev/sdX access path was hidden', async () => {
  const { mergeAliasMetadata } = await modulePromise;
  const devices = [{ name: '/dev/nvme0', type: 'nvme' }];
  const groups = [
    [
      { name: '/dev/sda', type: 'nvme' },
      { name: '/dev/nvme0', type: 'nvme' },
    ],
  ];
  const updates = [
    { name: '/dev/sda', type: 'nvme', transport: 'PCIe', capacityBytes: 1000204886016 },
    { name: '/dev/nvme0', type: 'nvme' },
  ];
  const merged = mergeAliasMetadata(devices, updates, groups);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, '/dev/nvme0');
  assert.equal(merged[0].type, 'nvme');
  assert.equal(merged[0].transport, 'PCIe');
  assert.equal(merged[0].capacityBytes, 1000204886016);
});
test('collapsing aliases retains previously received Windows metadata', async () => {
  const { collapseScanAliases } = await modulePromise;
  const devices = [
    { name: '/dev/sda', type: 'nvme', transport: 'PCIe' },
    { name: '/dev/nvme0', type: 'nvme' },
  ];
  const groups = [
    [
      { name: '/dev/sda', type: 'nvme' },
      { name: '/dev/nvme0', type: 'nvme' },
    ],
  ];
  assert.deepEqual(collapseScanAliases(devices, groups, ''), [
    { name: '/dev/nvme0', type: 'nvme', transport: 'PCIe' },
  ]);
});

test('direct Windows inventory fields win over alias data while missing fields are filled', async () => {
  const { mergeAliasMetadata } = await modulePromise;
  const selected = { name: '/dev/nvme0', type: 'nvme', internal: false };
  const alias = { name: '/dev/sda', type: 'nvme' };
  const list = mergeAliasMetadata(
    [selected],
    [
      { ...selected, transport: 'PCIe', osMetadata: { source: 'native' } },
      {
        ...alias,
        transport: 'USB',
        capacityBytes: 1234567890,
        connection: { verified: true, source: 'windows-pnp', chain: [{ name: 'Controller' }] },
      },
    ],
    [[selected, alias]],
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].transport, 'PCIe');
  assert.equal(list[0].internal, false);
  assert.equal(list[0].capacityBytes, 1234567890);
  assert.equal(list[0].connection.source, 'windows-pnp');
  assert.equal(list[0].osMetadata.source, 'native');
  assert.deepEqual(list[0].name, '/dev/nvme0');
});

test('optional metadata rejects invalid capacities and preserves explicit internal false', async () => {
  const { mergeScanMetadata, mergeAliasMetadata } = await modulePromise;
  const kept = { name: '/dev/nvme1', type: 'nvme', capacityBytes: 4096000000 };
  const hidden = { name: '/dev/sdb', type: 'nvme' };
  const invalid = mergeScanMetadata([kept], [{ ...kept, capacityBytes: -1, internal: 'false' }]);
  assert.equal(invalid[0].capacityBytes, 4096000000);
  assert.equal(invalid[0].internal, undefined);
  const updated = mergeAliasMetadata([kept], [{ ...hidden, internal: false }], [[kept, hidden]]);
  assert.equal(updated[0].internal, false);
});
