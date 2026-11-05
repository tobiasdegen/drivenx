'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseUsbProfiler, parseIoregTree } = require('../../electron/devices/connection.js');
const inventory = {
  SPUSBDataType: [
    {
      _name: 'USB 3.1 Bus',
      _items: [
        {
          _name: 'SATA USB Bridge',
          manufacturer: 'BridgeCo',
          vendor_id: '0x1234',
          product_id: '0x5678',
          speed: 'Up to 5 Gb/s',
          _items: [{ _name: '500 GB Media', bsd_name: 'disk4' }],
        },
        { _name: 'Unrelated adapter', _items: [{ bsd_name: 'disk6' }] },
      ],
    },
  ],
};
test('matches USB bridge to a BSD whole disk via parent chain', () => {
  const v = parseUsbProfiler(inventory, '/dev/disk4');
  assert.equal(v.verified, true);
  assert.equal(v.adapter.name, 'SATA USB Bridge');
  assert.equal(v.adapter.vendorId, '0x1234');
  assert.equal(v.chain.at(-1).category, 'disk');
});
test('no adapter association for another disk', () =>
  assert.equal(parseUsbProfiler(inventory, '/dev/disk0'), null));
test('reject partition and malformed structures', () => {
  assert.equal(parseUsbProfiler(inventory, '/dev/disk4s1'), null);
  assert.equal(parseUsbProfiler({}, '/dev/disk4'), null);
});

test('IORegistry resolves disk4 through USB hub and matching ASMedia bridge', () => {
  const tree = [
    '+-o Root  <class IORegistryEntry, id 1>',
    '  +-o USB3.0 Hub@02200000  <class IOUSBHostDevice, id 2>',
    '  |   "USB Product Name" = "USB3.0 Hub"',
    '  |   "USB Vendor Name" = "VIA Labs, Inc."',
    '  |   +-o ASM1153USB3.0TOSATA@02230000  <class IOUSBHostDevice, id 3>',
    '  |   |   "USB Product Name" = "ASM1153USB3.0TOSATA"',
    '  |   |   "UsbLinkSpeed" = 5000000000',
    '  |   |   "idVendor" = 5964',
    '  |   |   "idProduct" = 21930',
    '  |   |   +-o Disk Media  <class IOMedia, id 4>',
    '  |   |       "BSD Name" = "disk4"',
    '  |   +-o Unrelated Media  <class IOMedia, id 5>',
    '  |       "BSD Name" = "disk6"',
  ].join('\n');
  const result = parseIoregTree(tree, '/dev/disk4');
  assert.equal(result.verified, true);
  assert.equal(result.adapter.name, 'ASM1153USB3.0TOSATA');
  assert.equal(result.adapter.vendorId, '0x174c');
  assert.equal(result.adapter.productId, '0x55aa');
  assert.equal(result.adapter.speed, '5 Gb/s');
  assert.equal(result.chain[0].manufacturer, 'VIA Labs, Inc.');
  assert.equal(parseIoregTree(tree, '/dev/disk0'), null);
});

test('macOS IOKit identifies a bound UASP driver only when actually present in the disk ancestor path', () => {
  const base = [
    '+-o USB bridge  <class IOUSBHostDevice, id 1>',
    '  +-o USB interface  <class IOUSBHostInterface, id 2>',
    '    +-o Mass Storage  <class IOUSBMassStorageUASDriver, id 3>',
    '      +-o Disk  <class IOMedia, id 4>',
    '          "BSD Name" = "disk4"',
  ].join('\n');
  assert.equal(parseIoregTree(base, '/dev/disk4').usbDriver, 'uasp');
  assert.equal(
    parseIoregTree(
      base.replace('IOUSBMassStorageUASDriver', 'IOUSBMassStorageDriver'),
      '/dev/disk4',
    ).usbDriver,
    null,
  );
});
