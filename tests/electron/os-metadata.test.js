'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  windowsMetadata,
  linuxMetadata,
  parseLinuxBlockName,
  metadataResult,
} = require('../../electron/platform/os-metadata.js');
test('Windows size and sector size come only from matched OS disk', () => {
  const x = windowsMetadata({
    deviceId: '\\\\.\\PHYSICALDRIVE0',
    size: '2000398934016',
    bytesPerSector: 512,
    model: 'Example',
    interfaceType: 'SCSI',
  });
  assert.equal(x.capacityBytes, 2000398934016);
  assert.equal(x.osMetadata.logicalBlockSize, 512);
  assert.equal(x.osMetadata.source, 'windows-wmi');
  assert.equal(x.osMetadata.solidState, undefined);
});
test('absent and invalid capacity is not invented', () => {
  assert.equal(windowsMetadata({ size: '0' }).capacityBytes, undefined);
  assert.equal(windowsMetadata({ size: 'not a number' }).capacityBytes, undefined);
  assert.equal(
    metadataResult({ source: 'test', capacityBytes: '9007199254740993' }).capacityBytes,
    undefined,
  );
});
test('Linux accepts whole physical block devices, never partitions or traversal', () => {
  assert.equal(parseLinuxBlockName('/dev/nvme0n1'), 'nvme0n1');
  assert.equal(parseLinuxBlockName('/dev/sda1'), null);
  assert.equal(parseLinuxBlockName('/dev/nvme0n1p1'), null);
  assert.equal(parseLinuxBlockName('/dev/../etc/passwd'), null);
});
test('Linux sysfs counts 512-byte sectors even when device logical sector is 4096', async () => {
  const records = {
    size: '976562500',
    'queue/logical_block_size': '4096',
    'queue/physical_block_size': '4096',
    removable: '0',
    'queue/rotational': '0',
    'device/model': 'OEM Disk',
  };
  const readFile = async (p) => {
    const k = p.split('/sys/class/block/nvme0n1/')[1];
    if (!(k in records)) throw Error('not found');
    return records[k];
  };
  const result = await linuxMetadata('/dev/nvme0n1', {
    readFile,
    realpath: async () => '/devices/pci0000:00/0000:00:04.0/nvme/nvme0',
  });
  assert.equal(result.capacityBytes, 500000000000);
  assert.equal(result.osMetadata.logicalBlockSize, 4096);
  assert.equal(result.osMetadata.solidState, true);
  assert.equal(result.transport, 'PCIe');
});
test('Linux missing sysfs files does not invent capacity or connection', async () => {
  const r = await linuxMetadata('/dev/sdb', {
    readFile: async () => {
      throw Error('not found');
    },
    realpath: async () => {
      throw Error('missing');
    },
  });
  assert.equal(r.capacityBytes, undefined);
  assert.equal(r.transport, undefined);
});
