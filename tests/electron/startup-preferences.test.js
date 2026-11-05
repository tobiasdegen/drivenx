'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startWithPreferences } = require('../../src/startup-preferences.mjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup(settingsPromise) {
  let listener = null;
  let subscriptions = 0;
  const events = [];
  const api = {
    settings: () => settingsPromise,
    onPreferencesChanged: (callback) => {
      listener = callback;
      return () => {
        subscriptions++;
        listener = null;
      };
    },
  };
  const stop = startWithPreferences({
    api,
    onPreferences: (settings) => events.push(`settings:${settings.locale}`),
    onScan: () => {
      events.push('scan');
    },
  });
  return {
    events,
    stop,
    get subscriptions() {
      return subscriptions;
    },
    update: (settings) => {
      if (listener) listener(settings);
    },
  };
}

const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

test('the initial scan starts after stored preferences are applied', async () => {
  const pending = deferred();
  const app = setup(pending.promise);
  await settle();
  assert.deepEqual(app.events, []);
  pending.resolve({ locale: 'de-DE', backgroundDetails: true });
  await settle();
  assert.deepEqual(app.events, ['settings:de-DE', 'scan']);
  app.stop();
});

test('preferences changes arriving before a late read are not overwritten', async () => {
  const pending = deferred();
  const app = setup(pending.promise);
  app.update({ locale: 'en-US' });
  pending.resolve({ locale: 'de-DE' });
  await settle();
  assert.deepEqual(app.events, ['settings:en-US', 'scan']);
  app.stop();
});

test('a failed settings read still starts scanning', async () => {
  const pending = deferred();
  const app = setup(pending.promise);
  pending.reject(new Error('damaged preferences'));
  await settle();
  assert.deepEqual(app.events, ['scan']);
  app.stop();
});

test('unmount prevents late settings and scan callbacks and removes the listener', async () => {
  const pending = deferred();
  const app = setup(pending.promise);
  app.stop();
  pending.resolve({ locale: 'de-DE' });
  await settle();
  app.update({ locale: 'en-US' });
  assert.deepEqual(app.events, []);
  assert.equal(app.subscriptions, 1);
});
