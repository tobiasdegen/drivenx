'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
// Share the same pure decision as the React UI without duplicating assumptions.
const { macUsbScsiSmartLimitation } = require('../../src/mac-usb-smart-limitation.mjs');

test('unsupported USB/SCSI SMART note needs macOS UASP, an identified path and an actual failed read', () => {
  const device = { transport: 'USB', connection: { verified: true, usbDriver: 'uasp' } };
  assert.equal(macUsbScsiSmartLimitation(device, 'darwin', 'fehlgeschlagen'), true);
  assert.equal(macUsbScsiSmartLimitation(device, 'darwin', undefined, true), true);
  assert.equal(macUsbScsiSmartLimitation(device, 'darwin', 'vollstaendig'), false);
  assert.equal(macUsbScsiSmartLimitation(device, 'darwin', 'eingeschraenkt'), false);
  assert.equal(macUsbScsiSmartLimitation(device, 'win32', 'fehlgeschlagen'), false);
  assert.equal(
    macUsbScsiSmartLimitation(
      { ...device, connection: { verified: false, usbDriver: 'uasp' } },
      'darwin',
      'fehlgeschlagen',
    ),
    false,
  );
  assert.equal(
    macUsbScsiSmartLimitation(
      { ...device, connection: { verified: true } },
      'darwin',
      'fehlgeschlagen',
    ),
    false,
  );
});

test('macOS USB read failure explains possible passthrough restriction without assuming NVMe', () => {
  const de = require('../../locales/de-DE.json').smartView.macUsbScsiReadUnavailable;
  const en = require('../../locales/en-US.json').smartView.macUsbScsiReadUnavailable;
  assert.match(de, /möglicherweise|Möglicherweise/);
  assert.match(en, /may not/i);
  assert.doesNotMatch(de, /externe NVMe-SSDs/);
  assert.doesNotMatch(en, /external USB NVMe SSDs/);
});
