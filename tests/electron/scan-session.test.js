'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequestTracker } = require('../../src/request-tracker.mjs');
const { beginScanSession, keepVisibleDriveEntries } = require('../../src/scan-session.mjs');
const { chooseScannedDevice } = require('../../src/scan-followups.mjs');

const drive = (name, type = 'sat') => ({ name, type });
const key = (device) => `${device.name}\0${device.type}`;

test('renderer invalidates old devices and selection synchronously when a rescan begins', () => {
  const old = drive('/dev/sda');
  const other = drive('/dev/sdb');
  const tracker = createRequestTracker();
  tracker.select(key(old));
  const pending = tracker.beginDetail(key(old));
  const deviceRef = { current: [old, other] };
  const selectedRef = { current: key(old) };
  const previous = beginScanSession(tracker, deviceRef, selectedRef);
  assert.equal(previous.previousKey, key(old));
  assert.equal(previous.previousName, old.name);
  assert.deepEqual(deviceRef.current, []);
  assert.equal(selectedRef.current, '');
  assert.equal(tracker.isCurrentSelection(''), true);
  assert.equal(tracker.isDetailCurrent(pending), false);
  assert.equal(tracker.isScanCurrent(previous.epoch), true);
});

test('new scan may restore previous selection by identity, but never reuse its old metadata', () => {
  const old = { ...drive('/dev/sda'), info_name: 'Outdated device', capacityBytes: 99 };
  const tracker = createRequestTracker();
  tracker.select(key(old));
  const deviceRef = { current: [old] };
  const selectedRef = { current: key(old) };
  const transition = beginScanSession(tracker, deviceRef, selectedRef);
  const fresh = drive('/dev/sda', 'usbjmicron');
  const selected = chooseScannedDevice(
    [drive('/dev/sdb'), fresh],
    transition.previousKey,
    transition.previousName,
  );
  assert.equal(selected, fresh);
  assert.equal(selected.info_name, undefined);
  assert.equal(selected.capacityBytes, undefined);
});

test('verified alias collapse prunes orphaned detail and error caches', () => {
  const nvme = drive('/dev/nvme0', 'nvme');
  const alias = drive('/dev/sda', 'nvme');
  const entries = { [key(nvme)]: 1, [key(alias)]: 2, [key(drive('/dev/sdb'))]: 3 };
  assert.deepEqual(keepVisibleDriveEntries(entries, [nvme, drive('/dev/sdb')]), {
    [key(nvme)]: 1,
    [key(drive('/dev/sdb'))]: 3,
  });
  assert.deepEqual(entries[key(alias)], 2, 'input cache is not mutated');
});
