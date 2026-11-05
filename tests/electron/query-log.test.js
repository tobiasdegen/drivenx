'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createQueryLog, describe } = require('../../electron/data/query-log.js');

test('all common smartctl operations are identified without retaining the DriveDB path', () => {
  const db = 'C:\\Users\\Private\\drivedb.h';
  assert.deepEqual(describe(['-B', db, '-x', '-j', '-d', 'sat', '/dev/sdb']), {
    mode: 'extended',
    device: '/dev/sdb',
    kind: null,
    command: 'smartctl -x -j -d sat /dev/sdb',
  });
  for (const [args, mode] of [
    [['--scan-open', '-j'], 'scan-open'],
    [['--scan', '-j'], 'scan'],
    [['-i', '-j', '-d', 'nvme', '/dev/nvme0'], 'identify'],
    [['-a', '-j', '-d', 'sat,12', '/dev/sdb'], 'standard'],
    [['--version'], 'version'],
    [['-t', 'short', '-j', '-d', 'sat', '/dev/sdb'], 'self-test'],
  ])
    assert.equal(describe(args).mode, mode);
  assert.equal(describe(['-x', '-j', 'C:\\Users\\private\\drive']).device, null);
});

test('session query log tracks running, successful, SMART finding and failed invocations', async () => {
  let current = 1700000000000;
  const log = createQueryLog({ now: () => current });
  let notifications = 0;
  const unsubscribe = log.subscribe(() => notifications++);
  let finish;
  const pending = log.track(
    ['-x', '-j', '-d', 'sat', '/dev/sda'],
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  assert.equal(log.entries()[0].status, 'running');
  current += 23;
  finish({ exitCode: 192, json: { smartctl: { exit_status: 192 }, serial_number: 'SECRET' } });
  await pending;
  assert.equal(log.entries()[0].status, 'finding');
  assert.equal(log.entries()[0].durationMs, 23);
  assert.equal(JSON.stringify(log.entries()).includes('SECRET'), false);
  await log.track(['-a', '-j', '-d', 'sat', '/dev/sda'], async () => ({ exitCode: 0 }));
  assert.equal(log.entries()[0].status, 'ok');
  await log.track(['-a', '-j', '-d', 'sat', '/dev/sdb'], async () => ({ exitCode: 2 }));
  assert.equal(log.entries()[0].status, 'error');
  await assert.rejects(
    log.track(['--scan', '-j'], async () => {
      throw Object.assign(new Error('Private details'), { code: 'ETIMEDOUT' });
    }),
    /Private details/,
  );
  assert.equal(log.entries()[0].errorCode, 'ETIMEDOUT');
  assert.doesNotMatch(JSON.stringify(log.entries()), /Private details/);
  assert.equal(notifications, 8);
  unsubscribe();
});

test('session log is bounded, immutable to consumers and can be cleared', async () => {
  const log = createQueryLog({ maxEntries: 2 });
  for (let i = 0; i < 3; i++) await log.track(['--scan', '-j'], async () => ({ exitCode: 0 }));
  assert.deepEqual(
    log.entries().map((entry) => entry.id),
    [3, 2],
  );
  log.entries()[0].status = 'error';
  assert.equal(log.entries()[0].status, 'ok');
  log.clear();
  assert.equal(log.entries().length, 0);
});

test('global log UI is reachable without a selected disk; renderer cannot submit commands to run', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (file) => fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, '..', file), 'utf8');
  const app = read('src/App.tsx');
  assert.match(app, /location\.hash === '#query-log'/);
  assert.doesNotMatch(app, /logOpen/);
  assert.match(read('electron/main.js'), /function openQueryLog\(\)/);
  assert.match(read('electron/ui/app-menu.js'), /click: openQueryLog/);
  const preload = read('electron/preload.js');
  assert.match(preload, /queryLog:\s*\(\)\s*=>\s*invoke\('queryLog'\)/);
  assert.doesNotMatch(preload, /runSmartctl:\s*\(/);
  assert.match(read('electron/main.js'), /registerQueryLogIpc\(/);
  assert.match(read('electron/ipc/query-log-ipc.js'), /register\('diagnostics:queryLog'/);
});

test('log window cannot issue SMART operations over IPC', () => {
  const { queryLogChannelAllowed } = require('../../electron/data/query-log-access.js');
  const logWindow = { isDestroyed: () => false, webContents: { id: 42 } };
  for (const channel of [
    'diagnostics:queryLogAppearance',
    'diagnostics:queryLog',
    'diagnostics:queryLogResult',
    'diagnostics:clearQueryLog',
    'diagnostics:exportQueryLog',
  ])
    assert.equal(queryLogChannelAllowed(42, logWindow, channel), true);
  for (const channel of [
    'diagnostics:scan',
    'diagnostics:detail',
    'diagnostics:test',
    'diagnostics:saveSettings',
    'diagnostics:openPreferences',
    'diagnostics:settings',
  ])
    assert.equal(queryLogChannelAllowed(42, logWindow, channel), false);
  assert.equal(queryLogChannelAllowed(3, logWindow, 'diagnostics:detail'), true);
});

test('smartctl command/checksum bit 2 is an execution failure while bit 6 is an error-log finding', async () => {
  const log = createQueryLog();
  await log.track(['-x', '-j', '-d', 'sat', '/dev/sdb'], async () => ({ exitCode: 4 }));
  assert.equal(log.entries()[0].status, 'error');
  await log.track(['-x', '-j', '-d', 'sat', '/dev/sdb'], async () => ({ exitCode: 64 }));
  assert.equal(log.entries()[0].status, 'finding');
  await log.track(['-x', '-j', '-d', 'sat', '/dev/sdb'], async () => ({ exitCode: 68 }));
  assert.equal(log.entries()[0].status, 'error');
});

test('Windows inventory is logged without executable path, script or PowerShell error details', async () => {
  let current = 1700000000000;
  const log = createQueryLog({ now: () => current });
  let complete;
  const pending = log.trackSystem(
    'windows-inventory',
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  assert.equal(log.entries()[0].status, 'running');
  assert.equal(log.entries()[0].mode, 'windows-inventory');
  current += 250;
  complete('{"drives":[]}');
  assert.equal(await pending, '{"drives":[]}');
  assert.equal(log.entries()[0].durationMs, 250);
  assert.equal(log.entries()[0].status, 'ok');
  await assert.rejects(
    log.trackSystem('windows-inventory', () => {
      throw new Error('C:\\Users\\Secret\\PowerShell.exe: Zeitüberschreitung');
    }),
    /Zeitüberschreitung/,
  );
  assert.equal(log.entries()[0].errorCode, 'ETIMEDOUT');
  assert.equal(log.entries()[0].exitCode, null);
  assert.doesNotMatch(JSON.stringify(log.entries()), /Secret|EncodedCommand|\.exe/);
  assert.throws(() => log.trackSystem('user-supplied', () => {}), /Unbekannte Systemabfrage/);
});

test('per-query raw results are kept separately from list metadata and opt-in export', async () => {
  const log = createQueryLog();
  const raw = {
    smartctl: { exit_status: 4 },
    serial_number: 'PRIVATE-123',
    nvme_smart_health_information_log: { media_errors: 0 },
  };
  await log.track(['-x', '-j', '/dev/disk0'], async () => ({ json: raw, exitCode: 4 }));
  const [entry] = log.entries();
  assert.equal(entry.hasResult, true);
  assert.equal(entry.resultTruncated, false);
  assert.doesNotMatch(JSON.stringify(log.entries()), /PRIVATE-123/);
  assert.equal(JSON.parse(log.result(entry.id).text).serial_number, 'PRIVATE-123');
  assert.doesNotMatch(JSON.stringify(log.exportEntries(false)), /PRIVATE-123/);
  assert.match(JSON.stringify(log.exportEntries(true)), /PRIVATE-123/);
  assert.equal(log.result(0), null);
  assert.equal(log.result('1'), null);
  log.clear();
  assert.equal(log.result(entry.id), null);
});

test('bounded result storage discards old details without losing metadata', async () => {
  const log = createQueryLog({ maxEntries: 3, maxResultBytes: 12, maxSessionBytes: 20 });
  await log.trackSystem('diskutil-list', async () => 'FIRST-CONTENT');
  const first = log.entries()[0].id;
  assert.equal(log.result(first).truncated, true);
  await log.trackSystem('diskutil-info', async () => '<plist>SECOND</plist>', '/dev/disk1');
  const second = log.entries()[0];
  assert.equal(second.device, '/dev/disk1');
  assert.equal(log.result(first), null, 'old payload is evicted but metadata remains');
  assert.equal(log.entries().length, 2);
  assert.equal(log.entries().find((row) => row.id === first).hasResult, false);
  assert.equal(log.result(second.id).truncated, true);
  await log.trackSystem('ioreg-usb', async () => 'third');
  await log.trackSystem('system-profiler-usb', async () => '{"usb":true}');
  assert.equal(log.entries().length, 3);
  assert.ok(!log.entries().some((row) => row.id === first));
  assert.throws(() => log.trackSystem('evil-mode', async () => ''), /Unbekannte Systemabfrage/);
  assert.equal(log.entries().find((r) => r.mode === 'system-profiler-usb').hasResult, true);
});

test('concurrent completed calls after retention trim do not resurrect removed output', async () => {
  const log = createQueryLog({ maxEntries: 1 });
  let finish;
  const pending = log.track(
    ['--scan', '-j'],
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const oldest = log.entries()[0].id;
  await log.track(['--version'], async () => 'smartctl 7.5');
  finish({ json: { serial_number: 'PRIVATE' }, exitCode: 0 });
  await pending;
  assert.equal(log.result(oldest), null);
  assert.doesNotMatch(JSON.stringify(log.exportEntries(true)), /PRIVATE/);
});

test('readable NVMe health with an unavailable additional log is marked partial, not device failed', async () => {
  const log = createQueryLog();
  await log.track(['-x', '-j', '/dev/disk0'], async () => ({
    exitCode: 4,
    json: {
      smartctl: { exit_status: 4, messages: [{ severity: 'error', string: 'GetLogPage failed' }] },
      smart_status: { passed: true },
      nvme_smart_health_information_log: { critical_warning: 0, media_errors: 0 },
    },
  }));
  assert.equal(log.entries()[0].status, 'partial');
  assert.match(log.result(log.entries()[0].id).text, /GetLogPage failed/);
  await assert.rejects(
    log.trackSystem(
      'diskutil-info',
      async () => {
        throw Object.assign(new Error('diskutil: permission denied'), { code: 'EACCES' });
      },
      '/dev/disk0',
    ),
  );
  assert.equal(log.entries()[0].status, 'error');
  assert.equal(log.entries()[0].errorCode, 'EACCES');
  assert.match(log.result(log.entries()[0].id).text, /permission denied/);
  assert.doesNotMatch(JSON.stringify(log.entries()), /permission denied/);
});

test('macOS structured disk list and compatibility fallback are logged as distinct actual commands', async () => {
  const log = createQueryLog();
  await log.trackSystem('diskutil-list', async () => '<plist><dict/></plist>');
  await log.trackSystem('diskutil-list-text', async () => '/dev/disk0 (internal, physical):');
  await log.trackSystem('ioreg-usb', async () => '+-o USB');
  const records = log.entries();
  assert.match(records[2].command, /diskutil list -plist physical/);
  assert.equal(records[1].command, 'macOS diskutil list');
  assert.match(records[0].command, /-r -c IOUSBHostDevice/);
});

test('query log retains validated hybrid JMicron -d argument', async () => {
  const log = createQueryLog();
  await log.track(['-x', '-j', '-d', 'sntjmicron/sat', '/dev/sdb'], async () => ({
    exitCode: 4,
    json: {
      smartctl: { exit_status: 4 },
      device: { type: 'sat', protocol: 'ATA' },
      ata_smart_attributes: { table: [{ id: 9, raw: { value: 1860 } }] },
    },
  }));
  const result = log.entries()[0];
  assert.match(result.command, /-d sntjmicron\/sat \/dev\/sdb$/);
  assert.equal(result.exitCode, 4);
  assert.equal(result.status, 'partial');
});
