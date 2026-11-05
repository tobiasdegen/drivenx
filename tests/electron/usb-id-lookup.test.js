'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  normalizeUsbId,
  createUsbIdLookup,
  enrichUsbNames,
} = require('../../electron/devices/usb-id-lookup.js');
const { buildIndex } = require('../../scripts/build-usb-id-index.js');

const root = path.join(ELECTRON_SOURCE_DIR, '..', 'vendor', 'usb-ids');
const lookup = createUsbIdLookup({ file: path.join(root, 'index.json') });

test('USB ID index reproducibly matches original usb.ids and source version', () => {
  const original = fs.readFileSync(path.join(root, 'usb.ids'));
  const generated = buildIndex(original);
  const indexText = fs.readFileSync(path.join(root, 'index.json'), 'utf8');
  assert.equal(indexText, JSON.stringify(generated) + '\n');
  const index = JSON.parse(indexText);
  assert.equal(index.version, '2026.06.26');
  assert.equal(index.vendorCount, 3427);
  assert.equal(index.productCount, 20537);
  assert.equal(index.sha256, crypto.createHash('sha256').update(original).digest('hex'));
});

test('VID and PID are decoded as hexadecimal without guessing unavailable identities', () => {
  assert.equal(normalizeUsbId('0X174C'), '174c');
  assert.equal(normalizeUsbId('55aa'), '55aa');
  for (const bad of ['USB\\VID_174C', '0x1', '0x174c0', '0xzzzz', null, undefined])
    assert.equal(normalizeUsbId(bad), null);
  const asmedia = lookup.lookup('0x174C', '0x55AA');
  assert.equal(asmedia.vendorName, 'ASMedia Technology Inc.');
  assert.match(asmedia.productName, /ASM1051E/);
  assert.equal(asmedia.version, '2026.06.26');
  assert.match(lookup.lookup('152d', '0583').productName, /JMS583/);
  assert.equal(lookup.lookup('174c', 'ffff').productName, null);
  assert.equal(lookup.lookup('ffff', '55aa'), null);
  assert.equal(lookup.lookup(null, '55aa'), null);
});

test('enrichment only annotates verified USB metadata and never overwrites OS identity or SMART access', () => {
  const device = {
    name: '/dev/disk4',
    type: 'sat',
    transport: 'USB',
    connection: {
      source: 'ioreg',
      verified: true,
      chain: [
        {
          name: 'Original USB storage name',
          manufacturer: 'OS company',
          vendorId: '0x174c',
          productId: '0x55aa',
        },
      ],
    },
  };
  const result = enrichUsbNames(device, lookup);
  assert.notStrictEqual(result, device);
  assert.equal(result.name, '/dev/disk4');
  assert.equal(result.type, 'sat');
  assert.equal(result.connection.chain[0].name, 'Original USB storage name');
  assert.equal(result.connection.chain[0].manufacturer, 'OS company');
  assert.equal(result.connection.chain[0].usbIdNames.source, 'usb.ids');
  assert.equal(
    device.connection.chain[0].usbIdNames,
    undefined,
    'original metadata stays unchanged',
  );
  assert.strictEqual(
    enrichUsbNames({ ...device, transport: 'PCIe' }, lookup).connection,
    device.connection,
  );
  assert.strictEqual(
    enrichUsbNames({ ...device, connection: { ...device.connection, verified: false } }, lookup)
      .connection.chain,
    device.connection.chain,
  );
  assert.strictEqual(enrichUsbNames({ ...device, connection: null }, lookup).connection, null);
});

test('unknown or unavailable database is harmless and does not force device probing', () => {
  const unavailable = createUsbIdLookup({
    file: 'does-not-exist',
    read: () => {
      throw new Error('ENOENT');
    },
  });
  assert.equal(unavailable.lookup('174c', '55aa'), null);
  const corrupted = createUsbIdLookup({ read: () => Buffer.from('{bad') });
  assert.equal(corrupted.lookup('174c', '55aa'), null);
  const huge = createUsbIdLookup({ read: () => Buffer.alloc(2 * 1024 * 1024 + 1) });
  assert.equal(huge.lookup('174c', '55aa'), null);
});
