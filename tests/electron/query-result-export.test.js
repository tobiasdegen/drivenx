'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createQueryLog } = require('../../electron/data/query-log.js');
const { individualQueryExport } = require('../../electron/reports/query-result-export.js');

test('individual SMART JSON export preserves the original JSON object', async () => {
  const log = createQueryLog();
  const json = { smartctl: { exit_status: 4 }, serial_number: 'PRIVATE-123' };
  await log.track(['-x', '-j', '/dev/disk4'], async () => ({ json, exitCode: 4 }));
  const id = log.entries()[0].id;
  const exported = individualQueryExport(log, id);
  assert.deepEqual(JSON.parse(exported.body), json);
  assert.match(exported.filename, /^DriveNX-.*_dev_disk4-extended-\d+\.json$/);
  assert.doesNotMatch(JSON.stringify(log.entries()), /PRIVATE-123/);
});

test('individual system text output becomes a valid JSON envelope with metadata', async () => {
  const log = createQueryLog();
  await log.trackSystem(
    'diskutil-info',
    async () => '<?xml version="1.0"?><plist></plist>',
    '/dev/disk4',
  );
  const exported = JSON.parse(individualQueryExport(log, log.entries()[0].id).body);
  assert.equal(exported.outputFormat, 'text');
  assert.equal(exported.truncated, false);
  assert.match(exported.output, /plist/);
  assert.match(exported.query.command, /diskutil info/);
});

test('JSON returned as OS process text exports as actual JSON, not an envelope', async () => {
  const log = createQueryLog();
  await log.trackSystem(
    'system-profiler-usb',
    async () => '{"SPUSBDataType":[{"name":"Adapter"}]}',
  );
  const exported = JSON.parse(individualQueryExport(log, log.entries()[0].id).body);
  assert.deepEqual(exported, { SPUSBDataType: [{ name: 'Adapter' }] });
});

test('truncated JSON never masquerades as complete machine-readable source', async () => {
  const log = createQueryLog({ maxResultBytes: 28 });
  await log.track(['-x', '-j', '/dev/disk0'], async () => ({
    json: { serial_number: 'A'.repeat(100) },
    exitCode: 0,
  }));
  const exported = JSON.parse(individualQueryExport(log, log.entries()[0].id).body);
  assert.equal(exported.truncated, true);
  assert.equal(exported.outputFormat, 'json');
  assert.equal(typeof exported.output, 'string');
});

test('missing, invalid or cleared IDs cannot be exported', async () => {
  const log = createQueryLog();
  assert.equal(individualQueryExport(log, NaN), null);
  assert.equal(individualQueryExport(log, '1'), null);
  await log.track(['--version'], async () => 'smartctl 7.5');
  const id = log.entries()[0].id;
  log.clear();
  assert.equal(individualQueryExport(log, id), null);
});

test('query-log window may save individual results but remains unable to initiate device operations', () => {
  const { queryLogChannelAllowed } = require('../../electron/data/query-log-access.js');
  const window = { isDestroyed: () => false, webContents: { id: 45 } };
  assert.equal(queryLogChannelAllowed(45, window, 'diagnostics:saveQueryLogResult'), true);
  assert.equal(queryLogChannelAllowed(45, window, 'diagnostics:detail'), false);
  const preload = fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, 'preload.js'), 'utf8');
  assert.match(
    preload,
    /saveQueryLogResult:\s*\(id\)\s*=>\s*invoke\(\s*'saveQueryLogResult',\s*id\s*\)/,
  );
  const main = fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, 'main.js'), 'utf8');
  assert.match(main, /registerQueryLogIpc\(/);
  const moduleSource = fs.readFileSync(
    path.join(ELECTRON_SOURCE_DIR, 'ipc/query-log-ipc.js'),
    'utf8',
  );
  assert.match(moduleSource, /register\('diagnostics:saveQueryLogResult'/);
});
