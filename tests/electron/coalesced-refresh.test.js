'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCoalescedRefresh } = require('../../src/coalesced-refresh.mjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('burst of notifications performs one trailing read and publishes only newest data', async () => {
  const reads = [];
  const published = [];
  const first = deferred();
  const refresh = createCoalescedRefresh(
    () => {
      reads.push(reads.length + 1);
      return reads.length === 1 ? first.promise : Promise.resolve(['current']);
    },
    (data) => published.push(data),
    () => assert.fail('unexpected failure'),
  );
  const initial = refresh.refresh();
  const late1 = refresh.refresh();
  const late2 = refresh.refresh();
  assert.equal(initial, late1);
  assert.equal(initial, late2);
  assert.equal(reads.length, 1);
  first.resolve(['stale']);
  await initial;
  assert.deepEqual(reads, [1, 2]);
  assert.deepEqual(published, [['current']]);
});

test('unmounted view ignores pending success or failure and does not refetch', async () => {
  const first = deferred();
  const published = [];
  const errors = [];
  let reads = 0;
  const updater = createCoalescedRefresh(
    () => {
      reads++;
      return first.promise;
    },
    (data) => published.push(data),
    (e) => errors.push(e),
  );
  const pending = updater.refresh();
  void updater.refresh();
  updater.dispose();
  first.reject(Error('closed window'));
  await pending;
  await updater.refresh();
  assert.equal(reads, 1);
  assert.deepEqual(published, []);
  assert.deepEqual(errors, []);
});

test('temporary IPC error remains recoverable on the next refresh', async () => {
  const errors = [];
  const values = [];
  let count = 0;
  const updater = createCoalescedRefresh(
    async () => {
      if (++count === 1) throw Error('read failure');
      return [3];
    },
    (value) => values.push(value),
    (error) => errors.push(error.message),
  );
  await updater.refresh();
  await updater.refresh();
  assert.deepEqual(errors, ['read failure']);
  assert.deepEqual(values, [[3]]);
});
