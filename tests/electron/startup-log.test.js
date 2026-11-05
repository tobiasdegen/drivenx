'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startupLog, MAX_SIZE } = require('../../electron/data/startup-log.js');
test('startup logging omits sensitive paths and rotates existing log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-log-'));
  try {
    const file = path.join(dir, 'startup.log');
    fs.writeFileSync(file, 'x'.repeat(MAX_SIZE));
    startupLog(dir, 'renderer-console', 'C:\\Users\\Alice\\secret.exe');
    assert.ok(fs.existsSync(path.join(dir, 'startup.previous.log')));
    assert.ok(!fs.readFileSync(file, 'utf8').includes('Alice'));
    startupLog(dir, 'launch', 'DriveNX 0.9.5, win32/x64, packaged=true');
    assert.match(fs.readFileSync(file, 'utf8'), /win32\/x64/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scan timing log keeps numbers only and never persists device identifiers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-timing-'));
  try {
    startupLog(dir, 'scan-timing', 8040);
    startupLog(dir, 'main-init-timing', 261);
    startupLog(dir, 'settings-timing', 14);
    startupLog(dir, 'bootstrap-timing', 438);
    startupLog(dir, 'window-visible-timing', 550);
    startupLog(dir, 'splash-visible', 'C:\\Users\\Alice\\secret');
    startupLog(dir, 'windows-metadata-timing', 'C:\\Users\\User\\secret');
    const text = fs.readFileSync(path.join(dir, 'startup.log'), 'utf8');
    assert.match(text, /\[scan-timing\] 8040ms/);
    assert.match(text, /\[main-init-timing\] 261ms/);
    assert.match(text, /\[settings-timing\] 14ms/);
    assert.match(text, /\[bootstrap-timing\] 438ms/);
    assert.match(text, /\[window-visible-timing\] 550ms/);
    assert.match(text, /\[splash-visible\] startup-hint/);
    assert.match(text, /\[windows-metadata-timing\] 0ms/);
    assert.doesNotMatch(text, /secret|Users/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('early portable boot and instance-lock failures are logged without user paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-early-log-'));
  try {
    startupLog(dir, 'pre-ready', 'portable');
    startupLog(dir, 'instance-lock-unavailable', 'C:\\Users\\Alice\\private');
    startupLog(dir, 'startup-failed', 'C:\\Users\\Alice\\private');
    const log = fs.readFileSync(path.join(dir, 'startup.log'), 'utf8');
    assert.match(log, /\[pre-ready\] portable/);
    assert.match(log, /\[instance-lock-unavailable\] another-instance-or-lock-error/);
    assert.match(log, /\[startup-failed\] main-process-startup-failed/);
    assert.doesNotMatch(log, /Users|Alice|private/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
