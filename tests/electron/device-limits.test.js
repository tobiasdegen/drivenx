'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { device } = require('../../electron/ipc/ipc-validation.js');
const { MAX_DEVICE_NAME_LENGTH, MAX_DEVICE_TYPE_LENGTH } = require('../../shared/device-limits.js');

test('IPC accepts detected device path length and rejects oversized path', () => {
  const name = '/dev/' + 'x'.repeat(MAX_DEVICE_NAME_LENGTH - 5);
  assert.equal(device({ name, type: 'auto' }).name.length, MAX_DEVICE_NAME_LENGTH);
  assert.throws(() => device({ name: name + 'x', type: 'auto' }));
});

test('IPC rejects oversized device type and malformed payloads', () => {
  assert.equal(
    device({ name: '/dev/sda', type: 'a'.repeat(MAX_DEVICE_TYPE_LENGTH) }).type.length,
    MAX_DEVICE_TYPE_LENGTH,
  );
  assert.throws(() => device({ name: '/dev/sda', type: 'a'.repeat(MAX_DEVICE_TYPE_LENGTH + 1) }));
  assert.throws(() => device({ name: '/dev/sda' }));
});
