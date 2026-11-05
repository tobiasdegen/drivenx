'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDetailCache } = require('../../electron/diagnostics/detail-cache.js');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
test('simultaneous requests to one drive share one operation', async () => {
  const cache = createDetailCache();
  const task = deferred();
  let calls = 0;
  const first = cache.load('diskA', () => {
    calls++;
    return task.promise;
  });
  const second = cache.load('diskA', () => {
    calls++;
    return task.promise;
  });
  task.resolve({ serial: 'A' });
  assert.deepEqual(await Promise.all([first, second]), [{ serial: 'A' }, { serial: 'A' }]);
  assert.equal(calls, 1);
  assert.deepEqual(cache.get('diskA'), { serial: 'A' });
});
test('an old scan cannot overwrite the new report cache', async () => {
  const cache = createDetailCache(),
    old = deferred(),
    current = deferred();
  const previousRequest = cache.load('diskA', () => old.promise);
  cache.reset();
  const newRequest = cache.load('diskA', () => current.promise);
  current.resolve({ revision: 2 });
  await newRequest;
  old.resolve({ revision: 1 });
  await previousRequest;
  assert.deepEqual(cache.get('diskA'), { revision: 2 });
});
test('reset invalidates reports even if old work completes', async () => {
  const cache = createDetailCache(),
    task = deferred();
  const running = cache.load('diskA', () => task.promise);
  cache.reset();
  task.resolve({ revision: 1 });
  await running;
  assert.equal(cache.get('diskA'), undefined);
});
test('rejected reads are not cached, and retries work', async () => {
  const cache = createDetailCache();
  await assert.rejects(cache.load('diskA', () => Promise.reject(new Error('offline'))));
  const report = await cache.load('diskA', () => ({ ok: true }));
  assert.deepEqual(report, { ok: true });
  assert.deepEqual(cache.get('diskA'), report);
});

test('invalidating one device evicts its report and blocks an in-flight cache repopulation', async () => {
  const cache = createDetailCache();
  await cache.load('diskA', async () => ({ old: true }));
  await cache.load('diskB', async () => ({ other: true }));
  const pending = deferred();
  const earlier = cache.load('diskA', () => pending.promise);
  await Promise.resolve();
  cache.invalidate('diskA');
  assert.equal(cache.get('diskA'), undefined);
  assert.deepEqual(cache.get('diskB'), { other: true });
  pending.resolve({ stale: true });
  await earlier;
  assert.equal(cache.get('diskA'), undefined);
});

test('a refresh revokes an older snapshot before the new read finishes', async () => {
  const cache = createDetailCache();
  const previous = { revision: 1 };
  await cache.load('diskA', () => previous);
  const waiting = deferred();
  const refresh = cache.load('diskA', () => waiting.promise);
  assert.equal(cache.get('diskA'), undefined);
  waiting.resolve({ revision: 2 });
  await refresh;
  assert.deepEqual(cache.get('diskA'), { revision: 2 });
});

test('failed refresh cannot resurrect an older, potentially misleading diagnosis', async () => {
  const cache = createDetailCache();
  await cache.load('diskA', () => ({ revision: 1 }));
  const waiting = deferred();
  const refresh = cache.load('diskA', () => waiting.promise);
  waiting.reject(new Error('SMART transport disconnected'));
  await assert.rejects(refresh, /disconnected/);
  assert.equal(cache.get('diskA'), undefined);
});
