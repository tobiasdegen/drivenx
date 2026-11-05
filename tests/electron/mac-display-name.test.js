'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { macDisplayName, usefulName } = require('../../electron/platform/mac-display-name.js');

test('macOS picks an exact, verified IOMedia model when smartctl only found the disk path', () => {
  const device = { name: '/dev/disk6', info_name: '/dev/disk6' };
  const basic = { osMetadata: { mediaName: 'USB Storage Device' } };
  const connection = {
    verified: true,
    chain: [
      { category: 'usb', name: 'USB Storage Device' },
      { category: 'disk', name: 'WD Blue SN580 500GB 2810 Media' },
    ],
  };
  assert.equal(macDisplayName(device, basic, connection), 'WD Blue SN580 500GB 2810');
  assert.equal(
    macDisplayName(device, { osMetadata: { mediaName: 'WD Blue SN580 500GB Media' } }, connection),
    'WD Blue SN580 500GB',
  );
});

test('diskutil and SMART identification are preserved in the intended priority order', () => {
  assert.equal(
    macDisplayName(
      { name: '/dev/disk4', info_name: 'Samsung SSD 860 EVO' },
      { osMetadata: { mediaName: 'Generic USB Media' } },
      null,
    ),
    'Samsung SSD 860 EVO',
  );
  assert.equal(
    macDisplayName(
      { name: '/dev/disk4' },
      { osMetadata: { mediaName: 'Crucial X9 Pro Media' } },
      null,
    ),
    'Crucial X9 Pro',
  );
  assert.equal(
    macDisplayName(
      { name: '/dev/disk6', info_name: '/dev/disk6' },
      {},
      { verified: false, chain: [{ category: 'disk', name: 'Other model Media' }] },
    ),
    '/dev/disk6',
  );
  assert.equal(usefulName('/dev/disk6'), null);
  assert.equal(usefulName('USB Storage Device'), null);
  assert.equal(usefulName('disk6'), null);
});
