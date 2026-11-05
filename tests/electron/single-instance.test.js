'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { enableSingleInstance } = require('../../electron/data/single-instance.js');
function fakeApp(lock) {
  const handlers = new Map();
  let quits = 0;
  return {
    requestSingleInstanceLock: () => lock,
    quit: () => {
      quits++;
    },
    on: (event, callback) => handlers.set(event, callback),
    trigger: (event) => handlers.get(event)?.(),
    get quits() {
      return quits;
    },
    handlers,
  };
}
function fakeWindow() {
  const counts = { restore: 0, show: 0, focus: 0 };
  return {
    counts,
    isDestroyed: () => false,
    isMinimized: () => true,
    isVisible: () => false,
    restore: () => counts.restore++,
    show: () => counts.show++,
    focus: () => counts.focus++,
  };
}
test('second instance exits before any window bootstrapping', () => {
  const app = fakeApp(false);
  assert.equal(
    enableSingleInstance(app, () => {
      throw Error('unexpected');
    }),
    false,
  );
  assert.equal(app.quits, 1);
  assert.equal(app.handlers.size, 0);
});
test('existing window is restored and focused on second launch', () => {
  const app = fakeApp(true),
    win = fakeWindow();
  assert.equal(
    enableSingleInstance(app, () => ({ main: win })),
    true,
  );
  app.trigger('second-instance');
  assert.deepEqual(win.counts, { restore: 1, show: 1, focus: 1 });
});
test('preferences window used if main window unavailable', () => {
  const app = fakeApp(true),
    win = fakeWindow();
  enableSingleInstance(app, () => ({ main: null, preferences: win }));
  app.trigger('second-instance');
  assert.equal(win.counts.focus, 1);
});
test('launch during initial window creation is tolerated', () => {
  const app = fakeApp(true);
  enableSingleInstance(app, () => ({ main: null, preferences: null }));
  assert.doesNotThrow(() => app.trigger('second-instance'));
});
