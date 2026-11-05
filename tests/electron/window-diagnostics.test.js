const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  attachStartupDiagnostics,
  showBootError,
} = require('../../electron/ui/window-diagnostics.js');
test('boot diagnostics installs listeners without Electron global dependencies', () => {
  const contents = new EventEmitter();
  contents.getURL = () => 'data:text/html';
  contents.isDestroyed = () => false;
  const window = { webContents: contents, isDestroyed: () => false };
  const logs = [];
  attachStartupDiagnostics(window, 'main', (tag, msg) => logs.push([tag, msg]));
  contents.emit('console-message', { level: 'error', message: 'Sensitive internal error' });
  assert.ok(logs.some(([tag]) => tag === 'renderer-console'));
  assert.equal(contents.listeners('console-message')[0].length, 1);
});

test('new Electron console event logs CSP failures but ignores normal output', () => {
  const contents = new EventEmitter();
  contents.getURL = () => 'file:///app/index.html';
  contents.isDestroyed = () => false;
  const logs = [];
  const window = { webContents: contents, isDestroyed: () => false };
  attachStartupDiagnostics(window, 'main', (tag, value) => logs.push([tag, value]));
  contents.emit('console-message', { level: 'info', message: 'Loaded UI' });
  contents.emit('console-message', {
    level: 'warning',
    message: 'Content Security Policy blocked an inline script',
  });
  assert.deepEqual(logs, [['renderer-console', 'CSP']]);
});
test('boot error HTML encodes message', () => {
  let shown = '';
  const window = {
    isDestroyed: () => false,
    loadURL: (value) => {
      shown = value;
    },
  };
  showBootError(window, '<script>');
  assert.ok(decodeURIComponent(shown).includes('&lt;script&gt;'));
});

test('React health check runs after each load, but obsolete scheduled checks are ignored', async () => {
  const checks = [];
  const scheduled = [];
  const logs = [];
  const contents = new EventEmitter();
  contents.getURL = () => 'file:///app/index.html';
  contents.isDestroyed = () => false;
  contents.executeJavaScript = async () => {
    checks.push('ran');
    return { root: true, mounted: true, api: 'object' };
  };
  const window = { webContents: contents, isDestroyed: () => false };
  attachStartupDiagnostics(window, 'main', (tag) => logs.push(tag), {
    schedule: (fn) => scheduled.push(fn),
  });
  contents.emit('did-finish-load');
  contents.emit('did-start-loading');
  contents.emit('did-finish-load');
  assert.equal(scheduled.length, 2);
  await scheduled[0]();
  await scheduled[1]();
  assert.deepEqual(checks, ['ran']);
  assert.equal(logs.filter((tag) => tag === 'react-check').length, 1);
});

test('in-flight React health check cannot overwrite a subsequent successful page', async () => {
  const contents = new EventEmitter();
  let resolveCheck;
  const scheduled = [];
  let bootErrors = 0;
  contents.getURL = () => 'file:///app/index.html';
  contents.isDestroyed = () => false;
  contents.executeJavaScript = () =>
    new Promise((resolve) => {
      resolveCheck = resolve;
    });
  const window = {
    webContents: contents,
    isDestroyed: () => false,
    loadURL: () => {
      bootErrors++;
      return Promise.resolve();
    },
  };
  attachStartupDiagnostics(window, 'main', () => {}, { schedule: (fn) => scheduled.push(fn) });
  contents.emit('did-finish-load');
  const pending = scheduled.shift()();
  contents.emit('did-start-loading');
  contents.emit('did-finish-load');
  resolveCheck({ root: true, mounted: false, api: 'missing', url: 'file:///app/index.html' });
  await pending;
  assert.equal(bootErrors, 0);
});

test('aborted navigation is not reported as a boot failure', () => {
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  const logs = [];
  let bootErrors = 0;
  const window = {
    webContents: contents,
    isDestroyed: () => false,
    loadURL: () => {
      bootErrors++;
      return Promise.resolve();
    },
  };
  attachStartupDiagnostics(window, 'main', (tag) => logs.push(tag));
  contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', '', true);
  assert.equal(bootErrors, 0);
  assert.deepEqual(logs, []);
  contents.emit('did-fail-load', {}, -6, 'FILE_NOT_FOUND', '', true);
  assert.equal(bootErrors, 1);
  assert.deepEqual(logs, ['load-failed']);
});

test('error page loading rejects safely after the renderer is destroyed', async () => {
  const window = {
    isDestroyed: () => false,
    loadURL: () => Promise.reject(new Error('renderer destroyed')),
  };
  assert.doesNotThrow(() => showBootError(window, 'Test'));
  await new Promise((resolve) => setImmediate(resolve));
});
