'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { watchSystemTheme } = require('../../src/system-theme.mjs');

function stubMedia(initial = false) {
  const listeners = new Set();
  const media = {
    matches: initial,
    addEventListener(event, callback) {
      assert.equal(event, 'change');
      listeners.add(callback);
    },
    removeEventListener(event, callback) {
      assert.equal(event, 'change');
      listeners.delete(callback);
    },
    change(matches) {
      this.matches = matches;
      for (const listener of listeners) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
  return media;
}

test('system theme follows OS changes and detaches its listener', () => {
  const media = stubMedia(false);
  const seen = [];
  const stop = watchSystemTheme(
    'system',
    (value) => seen.push(value),
    (query) => {
      assert.equal(query, '(prefers-color-scheme: dark)');
      return media;
    },
  );
  assert.deepEqual(seen, ['light']);
  assert.equal(media.listenerCount, 1);
  media.change(true);
  media.change(false);
  assert.deepEqual(seen, ['light', 'dark', 'light']);
  stop();
  assert.equal(media.listenerCount, 0);
  media.change(true);
  assert.deepEqual(seen, ['light', 'dark', 'light']);
});

test('explicit theme never subscribes to OS changes', () => {
  const seen = [];
  const fail = () => {
    throw Error('matchMedia not expected');
  };
  watchSystemTheme('dark', (value) => seen.push(value), fail)();
  watchSystemTheme('light', (value) => seen.push(value), fail)();
  assert.deepEqual(seen, ['dark', 'light']);
});

test('switching away from system removes the previous watcher', () => {
  const media = stubMedia(true);
  const seen = [];
  const stop = watchSystemTheme(
    'system',
    (value) => seen.push(value),
    () => media,
  );
  stop();
  watchSystemTheme(
    'light',
    (value) => seen.push(value),
    () => media,
  );
  media.change(false);
  assert.deepEqual(seen, ['dark', 'light']);
  assert.equal(media.listenerCount, 0);
});
