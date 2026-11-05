'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSettingsSaver } = require('../../electron/data/settings-save.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('settings file writes, menu changes and notifications remain in request order', async () => {
  const firstWrite = deferred();
  const firstPublish = deferred();
  const calls = [];
  const saver = createSettingsSaver({
    validate: (raw) => ({ locale: raw.locale }),
    persist: async (value) => {
      calls.push(`persist:${value.locale}`);
      if (value.locale === 'de-DE') await firstWrite.promise;
    },
    apply: (value) => calls.push(`apply:${value.locale}`),
    publish: async (value) => {
      calls.push(`publish:${value.locale}`);
      if (value.locale === 'de-DE') await firstPublish.promise;
      return value;
    },
  });
  const original = { locale: 'de-DE' };
  const a = saver(original);
  original.locale = 'en-US'; // An IPC request must be snapshotted before it queues.
  const b = saver({ locale: 'en-US' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['persist:de-DE']);
  firstWrite.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['persist:de-DE', 'apply:de-DE', 'publish:de-DE']);
  firstPublish.resolve();
  assert.deepEqual(await a, { locale: 'de-DE' });
  assert.deepEqual(await b, { locale: 'en-US' });
  assert.deepEqual(calls, [
    'persist:de-DE',
    'apply:de-DE',
    'publish:de-DE',
    'persist:en-US',
    'apply:en-US',
    'publish:en-US',
  ]);
});

test('failed persistence leaves the active settings untouched and does not block next save', async () => {
  const applied = [];
  const saver = createSettingsSaver({
    validate: (raw) => {
      if (typeof raw !== 'string') throw Error('invalid');
      return raw;
    },
    persist: async (value) => {
      if (value === 'broken') throw Error('disk full');
    },
    apply: (value) => applied.push(value),
    publish: async (value) => value,
  });
  assert.throws(() => saver(null), /invalid/);
  const bad = saver('broken');
  const good = saver('current');
  await assert.rejects(bad, /disk full/);
  assert.equal(await good, 'current');
  assert.deepEqual(applied, ['current']);
});
