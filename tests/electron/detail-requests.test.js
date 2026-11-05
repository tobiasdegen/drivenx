'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDetailRequests } = require('../../src/detail-requests.mjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const disk = (name, type = 'sat') => ({ name, type });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('background and foreground share one ongoing smartctl detail read per device', async () => {
  let started = 0;
  const pending = deferred();
  const requests = createDetailRequests(async () => {
    started++;
    return pending.promise;
  });
  const first = requests.read(disk('/dev/sdb'));
  const second = requests.read(disk('/dev/sdb'));
  assert.strictEqual(first, second);
  await settle();
  assert.equal(started, 1);
  pending.resolve({ reportId: 'shared' });
  assert.equal((await second).reportId, 'shared');
});

test('failed reads can be retried and different smartctl access types remain independent', async () => {
  let attempts = 0;
  const requests = createDetailRequests(async (device) => {
    attempts++;
    if (device.type === 'sat' && attempts === 1) throw new Error('temporary USB failure');
    return { reportId: device.type };
  });
  await assert.rejects(requests.read(disk('/dev/sdb')), /temporary USB failure/);
  assert.equal((await requests.read(disk('/dev/sdb'))).reportId, 'sat');
  assert.equal((await requests.read(disk('/dev/sdb', 'sat,12'))).reportId, 'sat,12');
  assert.equal(attempts, 3);
});

test('a new scan does not reuse an older read or lose its own pending request', async () => {
  const old = deferred();
  const latest = deferred();
  let calls = 0;
  const requests = createDetailRequests(() => (++calls === 1 ? old.promise : latest.promise));
  const previous = requests.read(disk('/dev/sdb'));
  await settle();
  requests.clear();
  const newRead = requests.read(disk('/dev/sdb'));
  await settle();
  assert.equal(calls, 2);
  old.resolve({ reportId: 'old' });
  await previous;
  assert.strictEqual(requests.read(disk('/dev/sdb')), newRead);
  latest.resolve({ reportId: 'new' });
  assert.equal((await newRead).reportId, 'new');
});

test('explicit refresh bypasses an older in-flight read on the same device', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const requests = createDetailRequests(() => (++calls === 1 ? first.promise : second.promise));
  const old = requests.read(disk('/dev/disk6'));
  await settle();
  const updated = requests.read(disk('/dev/disk6'), { fresh: true });
  await settle();
  assert.equal(calls, 2);
  assert.notStrictEqual(updated, old);
  first.resolve({ reportId: 'old' });
  await old;
  assert.strictEqual(
    requests.read(disk('/dev/disk6')),
    updated,
    'old completion must not release the active refresh',
  );
  second.resolve({ reportId: 'fresh' });
  assert.equal((await updated).reportId, 'fresh');
});

test('invalidating one device read does not discard other running device requests', async () => {
  const a = deferred();
  const b = deferred();
  const reads = createDetailRequests((device) => (device.name === 'A' ? a.promise : b.promise));
  const oldA = reads.read(disk('A'));
  const firstB = reads.read(disk('B'));
  reads.invalidate('A\0sat');
  assert.strictEqual(reads.read(disk('B')), firstB);
  a.resolve({ reportId: 'A' });
  b.resolve({ reportId: 'B' });
  await Promise.all([oldA, firstB]);
});
