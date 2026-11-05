'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const trackerModule = import('../../src/request-tracker.mjs');

test('switching to a cached drive rejects late foreground state from previous drive', async () => {
  const { createRequestTracker } = await trackerModule;
  const t = createRequestTracker();
  t.select('A');
  const pendingA = t.beginDetail('A');
  t.select('B'); // no B detail request is required: it may already be cached
  assert.equal(t.isDetailCurrent(pendingA), false);
  const freshB = t.beginDetail('B');
  assert.equal(t.isDetailCurrent(freshB), true);
});

test('scan invalidates old details and later generations only', async () => {
  const { createRequestTracker } = await trackerModule;
  const t = createRequestTracker();
  t.select('A');
  const beforeScan = t.beginDetail('A');
  const generation = t.beginScan();
  assert.equal(t.isDetailCurrent(beforeScan), false);
  assert.equal(t.isScanCurrent(generation), true);
  const current = t.beginDetail('A');
  assert.equal(t.isDetailCurrent(current), true);
  t.beginScan();
  assert.equal(t.isScanCurrent(generation), false);
  assert.equal(t.isDetailCurrent(current), false);
});

test('background sidebar reads survive selection changes but not new scans', async () => {
  const { createRequestTracker } = await trackerModule;
  const t = createRequestTracker();
  t.select('A');
  const sidebar = t.beginDetail('B', false);
  t.select('C');
  assert.equal(t.isDetailCurrent(sidebar), true);
  t.beginScan();
  assert.equal(t.isDetailCurrent(sidebar), false);
});

test('a newer detail request for one drive supersedes older request for that drive only', async () => {
  const { createRequestTracker } = await trackerModule;
  const t = createRequestTracker();
  t.select('A');
  const a1 = t.beginDetail('A');
  const b = t.beginDetail('B', false);
  const a2 = t.beginDetail('A');
  assert.equal(t.isDetailCurrent(a1), false);
  assert.equal(t.isDetailCurrent(a2), true);
  assert.equal(t.isDetailCurrent(b), true);
});

test('selection ticket becomes invalid when leaving and returning to same device', async () => {
  const { createRequestTracker } = await trackerModule;
  const t = createRequestTracker();
  t.select('A');
  const testTicket = t.selectedTicket('A');
  t.select('B');
  t.select('A');
  assert.equal(t.isSelected(testTicket), false);
});

test('current selection can be checked without creating or invalidating tickets', async () => {
  const { createRequestTracker } = await trackerModule;
  const tracker = createRequestTracker();
  tracker.select('A');
  const ticket = tracker.selectedTicket('A');
  assert.equal(tracker.isCurrentSelection('A'), true);
  assert.equal(tracker.isCurrentSelection('B'), false);
  assert.equal(tracker.isSelected(ticket), true);
  tracker.select('B');
  assert.equal(tracker.isCurrentSelection('A'), false);
  assert.equal(tracker.isDetailCurrent(tracker.beginDetail('B')), true);
});

test('a refresh of the same selected drive revokes prior export and self-test snapshot tickets', async () => {
  const { createRequestTracker } = await trackerModule;
  const tracker = createRequestTracker();
  tracker.beginScan();
  tracker.select('A');
  tracker.beginDetail('A');
  const original = tracker.snapshotTicket('A');
  assert.equal(tracker.isSnapshotCurrent(original), true);
  tracker.beginDetail('A');
  assert.equal(tracker.isSelected(original), true, 'device selection itself did not change');
  assert.equal(tracker.isSnapshotCurrent(original), false, 'old report was superseded');
  const current = tracker.snapshotTicket('A');
  assert.equal(tracker.isSnapshotCurrent(current), true);
  tracker.invalidateDetail('A');
  assert.equal(tracker.isSnapshotCurrent(current), false, 'a self-test invalidates the report');
});

test('a scan invalidates snapshot tickets even if a device returns with the same access path', async () => {
  const { createRequestTracker } = await trackerModule;
  const tracker = createRequestTracker();
  tracker.beginScan();
  tracker.select('A');
  const old = tracker.snapshotTicket('A');
  tracker.beginScan();
  tracker.select('A');
  assert.equal(tracker.isSnapshotCurrent(old), false);
});
