'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { identify, assertSameDevice } = require('../../electron/devices/device-identity.js');
const drive = (serial, model = 'Disk 1', capacity = 1000000) => ({
  serial_number: serial,
  model_name: model,
  user_capacity: { bytes: capacity },
});
test('identical strong serial and device parameters permit a test', () => {
  assert.equal(assertSameDevice(drive('ABCD0123'), drive(' ABCD0123 ')), true);
});
test('different physical disk sharing same path is blocked', () => {
  assert.throws(() => assertSameDevice(drive('ABCD0123'), drive('ZZZZ9123')), /ausgetauscht/);
});
test('model or capacity change blocks even when serial agrees', () => {
  assert.throws(
    () => assertSameDevice(drive('ABCD0123'), drive('ABCD0123', 'Disk 2')),
    /Laufwerksdaten/,
  );
  assert.throws(
    () => assertSameDevice(drive('ABCD0123'), drive('ABCD0123', 'Disk 1', 2000000)),
    /Laufwerksdaten/,
  );
});
test('missing, placeholder or weak identities cannot authorize a test', () => {
  for (const serial of [null, '', 'UNKNOWN', '00000000', '1234567890', 'NO SERIAL']) {
    const expected = drive(serial);
    assert.equal(identify(expected).serial, null);
    assert.throws(() => assertSameDevice(expected, drive(serial)), /nicht zuverlässig/);
  }
});
test('structured WWN can authorize even without a serial number', () => {
  const a = { ...drive(null), wwn: { naa: 5, oui: 123, id: 456 } };
  const b = { ...drive(null), wwn: { naa: 5, oui: 123, id: 456 } };
  assert.equal(assertSameDevice(a, b), true);
  b.wwn.id = 789;
  assert.throws(() => assertSameDevice(a, b), /ausgetauscht/);
});
test('single surviving reliable identity is enough if other identifier is missing', () => {
  assert.equal(assertSameDevice(drive('ABCD0123'), { serial_number: 'ABCD0123' }), true);
});
