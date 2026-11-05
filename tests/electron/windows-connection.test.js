'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  lettersToIndex,
  parseWindowsInventory,
  parseInventoryOutput,
  INVENTORY_SCRIPT,
} = require('../../electron/platform/windows-connection.js');
const fixture = {
  drives: [
    {
      index: 0,
      deviceId: '\\\\.\\PHYSICALDRIVE0',
      interfaceType: 'SCSI',
      pnpDeviceId: 'SCSI\\DISK&VEN_NVME&PROD_SAMSUNG',
      nodes: [
        { instanceId: 'SCSI\\DISK&VEN_NVME&PROD_SAMSUNG', friendlyName: 'Samsung NVMe' },
        { instanceId: 'PCI\\VEN_144D&DEV_A808', friendlyName: 'NVMe Controller' },
      ],
    },
    {
      index: 1,
      deviceId: '\\\\.\\PHYSICALDRIVE1',
      interfaceType: 'USB',
      pnpDeviceId: 'USBSTOR\\DISK&VEN_SANDISK',
      nodes: [
        { instanceId: 'USBSTOR\\DISK&VEN_SANDISK', friendlyName: 'SanDisk Disk' },
        {
          instanceId: 'USB\\VID_0781&PID_5581\\SN001',
          friendlyName: 'SanDisk USB Mass Storage',
          manufacturer: 'SanDisk',
        },
        { instanceId: 'USB\\ROOT_HUB30\\ABC', friendlyName: 'USB Root Hub' },
      ],
    },
    {
      index: 2,
      deviceId: '\\\\.\\PHYSICALDRIVE2',
      interfaceType: 'IDE',
      pnpDeviceId: 'SCSI\\DISK&VEN_ATA&PROD_SAMSUNG',
      nodes: [],
    },
  ],
};
test('smartctl Windows drive letters map to physical disk indices', () => {
  assert.equal(lettersToIndex('/dev/sda'), 0);
  assert.equal(lettersToIndex('/dev/sdz'), 25);
  assert.equal(lettersToIndex('/dev/sdaa'), 26);
  assert.equal(lettersToIndex('/dev/nvme0'), null);
  assert.equal(lettersToIndex('/dev/sda1'), null);
});
test('Windows NVMe PCIe is distinguished from USB', () => {
  const result = parseWindowsInventory(fixture, { name: '/dev/sda' });
  assert.equal(result.transport, 'PCIe');
  assert.equal(result.internal, true);
  assert.equal(result.connection.chain.at(-1).name, 'Samsung NVMe');
});
test('USB chain is tied to the selected physical drive only', () => {
  const result = parseWindowsInventory(fixture, { name: '/dev/sdb' });
  assert.equal(result.transport, 'USB');
  assert.equal(result.internal, false);
  assert.equal(result.connection.verified, true);
  assert.equal(result.connection.source, 'windows-pnp');
  assert.equal(result.connection.adapter.vendorId, '0x0781');
  assert.equal(result.connection.adapter.productId, '0x5581');
  assert.equal(result.connection.chain.at(-1).name, 'SanDisk Disk');
  assert.equal(parseWindowsInventory(fixture, { name: '/dev/sdc' }).transport, 'SATA');
});
test('unknown disks or conflicting physicaldrive IDs are never guessed', () => {
  assert.deepEqual(parseWindowsInventory(fixture, { name: '/dev/sdd' }), {});
  const bad = { drives: [{ index: 0, deviceId: '\\\\.\\PHYSICALDRIVE9', interfaceType: 'USB' }] };
  assert.deepEqual(parseWindowsInventory(bad, { name: '/dev/sda' }), {});
  assert.deepEqual(
    parseWindowsInventory({ drives: [fixture.drives[0], fixture.drives[0]] }, { name: '/dev/sda' }),
    {},
  );
});
test('no fake PnP chain when PnP lookup fails', () => {
  const x = parseWindowsInventory(
    { drives: [{ index: 0, deviceId: '\\\\.\\PHYSICALDRIVE0', interfaceType: 'USB', nodes: [] }] },
    { name: '/dev/sda' },
  );
  assert.equal(x.transport, 'USB');
  assert.equal(x.connection, undefined);
});
test('Windows inventory parser rejects malformed input', () => {
  assert.equal(parseInventoryOutput('{"drives":[]}').drives.length, 0);
  assert.throws(() => parseInventoryOutput('oops'));
});

test('Windows PnP inventory requests properties together and caches shared ancestors', () => {
  assert.match(INVENTORY_SCRIPT, /\$nodeCache\s*=\s*@\{\}/);
  assert.match(INVENTORY_SCRIPT, /Get-PnpDeviceProperty -InstanceId \$current -KeyName \$keys/);
  assert.match(INVENTORY_SCRIPT, /\$nodeCache\.ContainsKey\(\$current\)/);
  assert.match(
    INVENTORY_SCRIPT,
    /\[Console\]::OutputEncoding\s*=\s*\[System\.Text\.Encoding\]::UTF8/,
  );
  assert.equal((INVENTORY_SCRIPT.match(/Get-PnpDeviceProperty/g) || []).length, 1);
});
test('Windows inventory tolerates absent device list without guessing a disk', () => {
  assert.deepEqual(
    parseWindowsInventory(parseInventoryOutput('{"drives":[]}'), { name: '/dev/sda' }),
    {},
  );
});

test('PnP parent inventory only walks USB devices', () => {
  assert.match(
    INVENTORY_SCRIPT,
    /if \(-not \$isUsb\) \{ \$result\.drives \+= \$entry; continue \}/,
  );
});

test('Windows Storage BusType correctly resolves SCSI-emulated physical drives', () => {
  const sample = {
    drives: [
      {
        index: 0,
        deviceId: '\\\\.\\PHYSICALDRIVE0',
        interfaceType: 'SCSI',
        busType: 'NVMe',
        pnpDeviceId: 'SCSI\\DISK&VEN_NVME&PROD_SAMSUNG',
        nodes: [],
      },
      {
        index: 1,
        deviceId: '\\\\.\\PHYSICALDRIVE1',
        interfaceType: 'SCSI',
        busType: 'USB',
        pnpDeviceId: 'SCSI\\DISK&VEN__USB&PROD__SANDISK',
        nodes: [],
      },
      {
        index: 2,
        deviceId: '\\\\.\\PHYSICALDRIVE2',
        interfaceType: 'SCSI',
        busType: 'USB',
        pnpDeviceId: 'SCSI\\DISK&VEN_SAMSUNG&PROD_SSD_860_EVO',
        nodes: [],
      },
    ],
  };
  assert.equal(parseWindowsInventory(sample, { name: '/dev/sda' }).transport, 'PCIe');
  assert.equal(parseWindowsInventory(sample, { name: '/dev/sdb' }).transport, 'USB');
  assert.equal(parseWindowsInventory(sample, { name: '/dev/sdc' }).transport, 'USB');
  assert.equal(parseWindowsInventory(sample, { name: '/dev/sdc' }).internal, false);
});

test('USB PnP traversal uses Storage BusType even when WMI InterfaceType is SCSI', () => {
  assert.match(INVENTORY_SCRIPT, /Get-Disk -ErrorAction Stop/);
  assert.match(INVENTORY_SCRIPT, /\$isUsb = \[string\]\$entry\.busType -eq 'USB'/);
});

test('Windows UASP is derived from the selected disk PnP driver, not from a bridge model', () => {
  const uasp = JSON.parse(JSON.stringify(fixture));
  uasp.drives[1].pnpDeviceId = 'UASPSTOR\\DISK&VEN_SANDISK';
  uasp.drives[1].nodes[0].instanceId = uasp.drives[1].pnpDeviceId;
  assert.equal(parseWindowsInventory(uasp, { name: '/dev/sdb' }).connection.usbDriver, 'uasp');
  assert.equal(
    parseWindowsInventory(fixture, { name: '/dev/sdb' }).connection.usbDriver,
    'usb-storage',
  );
});
