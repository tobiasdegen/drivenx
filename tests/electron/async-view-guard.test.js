'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAsyncViewGuard } = require('../../src/async-view-guard.mjs');

test('history fetch cannot overwrite the result of a newer exclusive action', () => {
  const guard = createAsyncViewGuard();
  const reading = guard.begin('load');
  assert.equal(guard.begin('import', { exclusive: true }), null);
  assert.equal(guard.finish(reading), true);
  const importing = guard.begin('import', { exclusive: true });
  assert.ok(importing);
  assert.equal(guard.begin('save', { exclusive: true }), null);
  assert.equal(guard.begin('export', { exclusive: true }), null);
  assert.equal(guard.finish(importing), true);
  assert.ok(guard.begin('save', { exclusive: true }));
});

test('a device or report change invalidates every late panel completion', () => {
  const guard = createAsyncViewGuard();
  const old = guard.begin('mac-io');
  const sample = guard.begin('file-sample');
  assert.ok(old && sample);
  guard.invalidate();
  assert.equal(guard.isCurrent(old), false);
  assert.equal(guard.finish(sample), false);
  const current = guard.begin('mac-io');
  assert.ok(current);
  assert.equal(guard.isCurrent(current), true);
  assert.equal(guard.isCurrent(old), false);
});

test('independent I/O and read-sample queries cannot be started twice', () => {
  const guard = createAsyncViewGuard();
  const io = guard.begin('mac-io');
  const sample = guard.begin('file-sample');
  assert.ok(io && sample);
  assert.equal(guard.begin('mac-io'), null);
  assert.equal(guard.begin('file-sample'), null);
  assert.equal(guard.finish(io), true);
  assert.ok(guard.begin('mac-io'));
  assert.equal(guard.isCurrent(sample), true);
});

test('outdated completion cannot release a newer operation in the same lane', () => {
  const guard = createAsyncViewGuard();
  const old = guard.begin('load');
  guard.invalidate();
  const current = guard.begin('load');
  assert.equal(guard.finish(old), false);
  assert.equal(guard.isBusy(), true);
  assert.equal(guard.finish(current), true);
  assert.equal(guard.isBusy(), false);
});
