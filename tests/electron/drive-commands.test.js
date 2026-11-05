'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequestTracker } = require('../../src/request-tracker.mjs');
const { exportSelectedReport, runSelectedSelfTest } = require('../../src/drive-commands.mjs');

const first = { name: '/dev/disk3', type: 'sat' };
const key = `${first.name}\0${first.type}`;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function context() {
  const tracker = createRequestTracker();
  tracker.beginScan();
  tracker.select(key);
  const pendingTests = new Set();
  const events = [];
  const state = {
    device: first,
    selectedKey: key,
    reportId: 'snapshot-1',
    kind: 'short',
    tracker,
    pendingTests,
    scanRunning: () => false,
    confirm: () => true,
    execute: async () => {},
    invalidate: (...args) => events.push(['invalidate', ...args]),
    reload: async () => events.push(['reload']),
    onRunning: (running) => events.push(['running', running]),
    onNotice: () => events.push(['notice']),
    onError: (message) => events.push(['error', message]),
    onShowTests: () => events.push(['tests']),
  };
  return { state, events, tracker };
}

test('an export never presents a late result for a different selected drive', async () => {
  const { tracker } = context();
  const gate = deferred();
  const notices = [],
    errors = [];
  const request = exportSelectedReport({
    device: first,
    selectedKey: key,
    reportId: 'snapshot-1',
    format: 'pdf',
    locale: 'de-DE',
    tracker,
    exportReport: () => gate.promise,
    onNotice: (text) => notices.push(text),
    onError: (text) => errors.push(text),
  });
  tracker.select('/dev/disk4\0sat');
  gate.resolve({ canceled: false, path: '/tmp/old.pdf' });
  await request;
  assert.deepEqual(notices, []);
  assert.deepEqual(errors, []);
});

test('an export does not show canceled results and reports errors for current selection', async () => {
  const { tracker } = context();
  const notices = [],
    errors = [];
  const base = {
    device: first,
    selectedKey: key,
    reportId: 'snap',
    format: 'json',
    locale: 'en-US',
    tracker,
    onNotice: (value) => notices.push(value),
    onError: (value) => errors.push(value),
  };
  await exportSelectedReport({
    ...base,
    exportReport: async () => ({ canceled: true, path: '/tmp/unused' }),
  });
  await exportSelectedReport({
    ...base,
    exportReport: async () => {
      throw new Error('save failed');
    },
  });
  assert.deepEqual(notices, []);
  assert.match(errors[0], /save failed/);
});

test('self-test refuses a stale confirmation without contacting the device', async () => {
  const { state, tracker, events } = context();
  let executions = 0;
  await runSelectedSelfTest({
    ...state,
    confirm: () => {
      tracker.select('/dev/disk4\0sat');
      return true;
    },
    execute: async () => {
      executions++;
    },
  });
  assert.equal(executions, 0);
  assert.deepEqual(events, []);
});

test('self-test refuses to start when a scan began while confirmation was open', async () => {
  const { state, tracker, events } = context();
  let executions = 0;
  await runSelectedSelfTest({
    ...state,
    confirm: () => {
      tracker.beginScan();
      return true;
    },
    execute: async () => {
      executions++;
    },
  });
  assert.equal(executions, 0);
  assert.deepEqual(events, []);
});

test('parallel self-test is locked until the selected drive has reloaded', async () => {
  const { state, events } = context();
  const gate = deferred();
  let executions = 0;
  const firstJob = runSelectedSelfTest({
    ...state,
    execute: async () => {
      executions++;
      await gate.promise;
    },
  });
  const secondJob = runSelectedSelfTest({
    ...state,
    execute: async () => {
      executions++;
    },
  });
  await secondJob;
  assert.equal(executions, 1);
  assert.equal(state.pendingTests.has(key), true);
  gate.resolve();
  await firstJob;
  assert.equal(state.pendingTests.has(key), false);
  assert.deepEqual(
    events.map((event) => event[0]),
    ['running', 'invalidate', 'notice', 'reload', 'tests', 'running'],
  );
});

test('a selection change during a self-test invalidates the old snapshot but not the new screen', async () => {
  const { state, tracker, events } = context();
  const gate = deferred();
  const request = runSelectedSelfTest({ ...state, execute: () => gate.promise });
  tracker.select('/dev/disk4\0sat');
  gate.resolve();
  await request;
  assert.deepEqual(
    events.map((event) => event[0]),
    ['running', 'invalidate', 'running'],
  );
});

test('failed self-test still invalidates the old snapshot and releases its lock', async () => {
  const { state, events } = context();
  await runSelectedSelfTest({
    ...state,
    execute: async () => {
      throw new Error('device busy');
    },
  });
  assert.deepEqual(
    events.map((event) => event[0]),
    ['running', 'invalidate', 'error', 'running'],
  );
  assert.equal(state.pendingTests.size, 0);
});

test('an export completion is ignored after same-drive refresh, including late errors', async () => {
  const { tracker } = context();
  tracker.beginDetail(key);
  const notices = [],
    errors = [];
  const gate = deferred();
  const exporting = exportSelectedReport({
    device: first,
    selectedKey: key,
    reportId: 'snapshot-1',
    format: 'pdf',
    locale: 'de-DE',
    tracker,
    exportReport: () => gate.promise,
    onNotice: (text) => notices.push(text),
    onError: (text) => errors.push(text),
  });
  tracker.beginDetail(key);
  gate.resolve({ canceled: false, path: '/tmp/old-report.pdf' });
  await exporting;
  assert.deepEqual(notices, []);
  assert.deepEqual(errors, []);
  const failed = deferred();
  const failedExport = exportSelectedReport({
    device: first,
    selectedKey: key,
    reportId: 'snapshot-2',
    format: 'pdf',
    locale: 'de-DE',
    tracker,
    exportReport: () => failed.promise,
    onNotice: (text) => notices.push(text),
    onError: (text) => errors.push(text),
  });
  tracker.invalidateDetail(key);
  failed.reject(new Error('stale report'));
  await failedExport;
  assert.deepEqual(errors, []);
});

test('self-test confirmation rejects an old snapshot when a refresh occurs on the same drive', async () => {
  const { state, tracker, events } = context();
  tracker.beginDetail(key);
  let executions = 0;
  await runSelectedSelfTest({
    ...state,
    confirm: () => {
      tracker.beginDetail(key);
      return true;
    },
    execute: async () => {
      executions++;
    },
  });
  assert.equal(executions, 0);
  assert.deepEqual(events, []);
});

test('the self-test revokes the visible snapshot before the device command starts', async () => {
  const { state, tracker, events } = context();
  tracker.beginDetail(key);
  const previous = tracker.snapshotTicket(key);
  const command = runSelectedSelfTest({
    ...state,
    invalidate: () => {
      tracker.invalidateDetail(key);
      events.push(['invalidated']);
    },
    execute: async () => {
      assert.equal(tracker.isSnapshotCurrent(previous), false);
      events.push(['command']);
    },
  });
  await command;
  assert.deepEqual(
    events.slice(0, 3).map((item) => item[0]),
    ['running', 'invalidated', 'command'],
  );
});
