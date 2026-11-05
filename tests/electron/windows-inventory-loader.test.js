'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createWindowsInventoryLoader,
  readWindowsInventory,
} = require('../../electron/platform/windows-inventory-loader.js');
const { sessionQueryLog } = require('../../electron/data/query-log.js');

test('Windows inventory runs independently from the initial smartctl scan', async () => {
  let complete;
  let begun = 0;
  const loader = createWindowsInventoryLoader(() => {
    begun++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const job = loader.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(begun, 1);
  assert.equal(typeof complete, 'function');
  complete({ drives: [] });
  assert.deepEqual((await job).inventory, { drives: [] });
  assert.equal((await job).warning, null);
});

test('refreshes are serialized and each performs a fresh read', async () => {
  let finishFirst;
  let reads = 0;
  const loader = createWindowsInventoryLoader(() => {
    reads++;
    return reads === 1
      ? new Promise((resolve) => {
          finishFirst = resolve;
        })
      : Promise.resolve({ drives: [{ index: 2 }] });
  });
  const first = loader.start();
  const second = loader.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 1, 'no concurrent PowerShell processes');
  finishFirst({ drives: [{ index: 1 }] });
  assert.equal((await first).inventory.drives[0].index, 1);
  assert.equal((await second).inventory.drives[0].index, 2);
  assert.equal(reads, 2, 'never reuse stale metadata from an earlier scan');
});

test('failed optional inventory is reported without rejecting or blocking future scans', async () => {
  let reads = 0;
  const loader = createWindowsInventoryLoader(() => {
    if (++reads === 1) throw new Error('Get-PnpDevice failed');
    return { drives: [] };
  });
  const failed = await loader.start();
  assert.equal(failed.inventory, null);
  assert.match(failed.warning, /Optionale Windows-Gerätezuordnung fehlgeschlagen/);
  assert.doesNotMatch(failed.warning, /Get-PnpDevice/);
  assert.equal((await loader.start()).inventory.drives.length, 0);
});

test('PowerShell is launched via absolute SystemRoot with bounded output and no shell', async () => {
  let captured;
  const inventory = await readWindowsInventory({
    env: { SystemRoot: 'C:\\Windows' },
    run: async (exe, args, options) => {
      captured = { exe, args, options };
      return '{"drives":[]}';
    },
  });
  assert.deepEqual(inventory, { drives: [] });
  assert.equal(
    captured.exe.toLowerCase(),
    'c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe',
  );
  assert.deepEqual(captured.args.slice(0, 2), ['-NoProfile', '-NonInteractive']);
  assert.equal(captured.options.timeout, 30000);
  assert.equal(captured.options.maxOutput, 4 * 1024 * 1024);
  await assert.rejects(
    () => readWindowsInventory({ env: { SystemRoot: 'relative' } }),
    /Windows-Systemverzeichnis/,
  );
});

test('optional PowerShell inventory appears in the global query log, even on timeout', async () => {
  sessionQueryLog.clear();
  await readWindowsInventory({
    env: { SystemRoot: 'C:\\Windows' },
    run: async () => '{"drives":[]}',
  });
  assert.equal(sessionQueryLog.entries()[0].mode, 'windows-inventory');
  assert.equal(sessionQueryLog.entries()[0].status, 'ok');
  await assert.rejects(
    readWindowsInventory({
      env: { SystemRoot: 'C:\\Windows' },
      run: async () => {
        throw new Error('powershell.exe: Zeitüberschreitung');
      },
    }),
    /Zeitüberschreitung/,
  );
  assert.equal(sessionQueryLog.entries()[0].errorCode, 'ETIMEDOUT');
  const {
    createWindowsInventoryLoader,
  } = require('../../electron/platform/windows-inventory-loader.js');
  const timed = await createWindowsInventoryLoader(async () => {
    throw new Error('C:\\Windows\\powershell.exe: Zeitüberschreitung');
  }).start();
  assert.match(timed.warning, /SMART-Diagnose bleibt verfügbar/);
  assert.doesNotMatch(timed.warning, /powershell.exe|C:\\Windows/);
  sessionQueryLog.clear();
});
