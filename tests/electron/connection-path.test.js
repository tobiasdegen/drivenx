'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const source = path.join(ELECTRON_SOURCE_DIR, '..', 'src', 'connection-path.mjs');
const model = import(pathToFileURL(source).href);
function fixture() {
  return {
    name: '/dev/disk4',
    type: 'sat',
    transport: 'USB',
    connection: {
      verified: true,
      chain: [
        {
          category: 'controller',
          name: 'USB3.0 Hub',
          manufacturer: 'VIA Labs',
          speed: '5 Gb/s',
          vendorId: '0x2109',
          productId: '0x0813',
          usbIdNames: { vendorName: 'VIA Labs', productName: 'VL813 Hub' },
        },
        {
          category: 'usb',
          name: 'ASM1153USB3.0TOSATA',
          manufacturer: '',
          speed: '5 Gb/s',
          vendorId: '0x174c',
          productId: '0x55aa',
          usbIdNames: {
            vendorName: 'ASMedia',
            productName: 'ASM1051E SATA bridge, ASM1153 SATA bridge',
          },
        },
        {
          category: 'disk',
          name: 'ASM1153U ASM1153USB3.0TOS Media',
          manufacturer: null,
          vendorId: null,
          productId: null,
          speed: null,
        },
      ],
    },
  };
}
test('IOMedia/SCSI inquiry is folded into the bridge and not rendered as a physical device', async () => {
  const { buildConnectionPath } = await model;
  const device = fixture();
  const raw = {
    model_name: 'Hitachi HTS545050B9A300',
    device: { protocol: 'ATA' },
    interface_speed: { max: { string: '3.0 Gb/s' } },
  };
  const result = buildConnectionPath(device, raw, 'darwin');
  assert.deepEqual(
    result.stages.map((s) => s.kind),
    ['host', 'usb', 'usb', 'drive'],
  );
  assert.deepEqual(
    result.stages.map((s) => s.role),
    ['host', 'hub', 'bridge', 'drive'],
  );
  assert.match(result.stages[2].inquiryName, /ASM1153U/);
  assert.equal(result.stages[3].name, 'Hitachi HTS545050B9A300');
  assert.equal(result.stages[3].link.label, 'SATA max. 3.0 Gb/s');
  assert.equal(result.stages[3].link.kind, 'maximum');
  assert.equal(result.summary, 'unknown');
  assert.equal(result.hasSataMaximumOnly, true);
  assert.equal(result.stages[2].hints.ambiguous, true);
  assert.equal(device.connection.chain.length, 3, 'never mutate scan metadata');
});
test('SATA current speed lower than maximum is flagged without inventing USB speed', async () => {
  const { buildConnectionPath } = await model;
  const device = fixture();
  const raw = {
    device: { protocol: 'ATA' },
    interface_speed: { current: { string: '3.0 Gb/s' }, max: { string: '6.0 Gb/s' } },
  };
  const result = buildConnectionPath(device, raw, 'win32');
  assert.equal(result.summary, 'sata-lower');
  assert.equal(result.stages[0].name, 'Computer');
  assert.equal(result.stages.at(-1).link.kind, 'current');
});
test('unmatched or incomplete USB metadata never invents links or controller models', async () => {
  const { buildConnectionPath } = await model;
  const result = buildConnectionPath(
    { transport: 'USB', connection: { chain: [{ category: 'usb', name: 'Generic USB' }] } },
    {},
    'darwin',
  );
  assert.equal(result.summary, 'unknown');
  assert.equal(result.hasSpeeds, false);
  assert.equal(result.stages[1].hints, null);
  assert.equal(result.stages[1].link, null);
});
test('only a metadata-only trailing disk is folded, never another physical device', async () => {
  const { usbDevices } = await model;
  const chain = fixture().connection.chain;
  chain[2].vendorId = '0x7777';
  assert.equal(usbDevices(chain).length, 3);
});

test('ambiguous disk leaf is not merged into a USB hub or unknown parent', async () => {
  const { usbDevices } = await model;
  const hub = {
    category: 'controller',
    name: 'USB3.0 Hub',
    vendorId: '0x2109',
    productId: '0x0813',
  };
  const leaf = {
    category: 'disk',
    name: 'USB SCSI Disk',
    vendorId: null,
    productId: null,
    speed: null,
  };
  const first = usbDevices([hub, leaf]);
  assert.equal(first.length, 2);
  assert.equal(first[0].inquiryName, undefined);
  assert.equal(usbDevices([{ category: 'usb', name: 'Unknown parent' }, leaf]).length, 2);
});

test('USB identification copy includes only reported IDs and SCSI inquiry', async () => {
  const { buildConnectionPath, formatConnectionIdentifiers } = await model;
  const stage = buildConnectionPath(fixture(), {}, 'darwin').stages[2];
  const copied = formatConnectionIdentifiers(stage);
  assert.match(copied, /VID: 0x174c/);
  assert.match(copied, /PID: 0x55aa/);
  assert.match(copied, /Inquiry: ASM1153U/);
  assert.match(copied, /USB ID product:/);
  assert.doesNotMatch(copied, /Location:/);
});

test('USB copy still works for metadata-only nodes without a VID or PID', async () => {
  const { formatConnectionIdentifiers } = await model;
  const copied = formatConnectionIdentifiers({
    name: 'Generic adapter',
    node: null,
    inquiryName: 'SCSI Disk',
    hints: { vendor: 'Vendor hint', product: 'Product hint' },
  });
  assert.match(copied, /Generic adapter/);
  assert.match(copied, /Inquiry: SCSI Disk/);
  assert.match(copied, /USB ID vendor: Vendor hint/);
  assert.doesNotMatch(copied, /VID:|PID:/);
  assert.equal(formatConnectionIdentifiers(null), '');
});

test('unmapped USB product has no invented chipset hint', async () => {
  const { buildConnectionPath } = await model;
  const result = buildConnectionPath(
    {
      name: '/dev/sdb',
      connection: {
        chain: [
          {
            category: 'usb',
            name: 'USB storage device',
            vendorId: '0x152d',
            productId: '0x0581',
            usbIdNames: { vendorName: 'USB vendor', productName: null },
          },
        ],
      },
    },
    { device: { protocol: 'ATA' } },
    'win32',
  );
  assert.deepEqual(result.stages[1].hints, {
    vendor: 'USB vendor',
    product: '',
    ambiguous: false,
  });
  assert.equal(result.stages[1].link, null);
});
