'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDeviceOperations } = require('../../electron/devices/device-operations.js');
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
test('operations for the same disk are strictly ordered', async () => {
  const operations = createDeviceOperations();
  const block = deferred();
  const order = [];
  const first = operations.run('diskA', async () => {
    order.push('read-start');
    await block.promise;
    order.push('read-end');
  });
  const second = operations.run('diskA', async () => order.push('test'));
  await Promise.resolve();
  assert.deepEqual(order, ['read-start']);
  block.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['read-start', 'read-end', 'test']);
});
test('different disks can operate concurrently', async () => {
  const operations = createDeviceOperations();
  const block = deferred();
  let secondRan = false;
  const first = operations.run('diskA', async () => block.promise);
  await operations.run('diskB', async () => {
    secondRan = true;
  });
  assert.equal(secondRan, true);
  block.resolve();
  await first;
});
test('failure does not stall the next command', async () => {
  const operations = createDeviceOperations();
  await assert.rejects(
    operations.run('diskA', async () => {
      throw Error('read failure');
    }),
  );
  assert.equal(await operations.run('diskA', async () => 42), 42);
});

test('an unconfirmed process exit quarantines only the affected device path', async () => {
  const operations = createDeviceOperations();
  let attempts = 0;
  await assert.rejects(
    operations.run('/dev/sda', async () => {
      attempts++;
      const error = new Error('Zeitüberschreitung');
      error.processCloseUnconfirmed = true;
      throw error;
    }),
    /Zeitüberschreitung/,
  );
  await assert.rejects(
    operations.run('/dev/sda', async () => {
      attempts++;
    }),
    /neu starten/,
  );
  assert.equal(attempts, 1);
  assert.equal(await operations.run('/dev/sdb', async () => 'ok'), 'ok');
});

test('a normal process error does not block the next operation', async () => {
  const operations = createDeviceOperations();
  await assert.rejects(
    operations.run('/dev/sda', async () => {
      throw new Error('unreadable');
    }),
  );
  assert.equal(await operations.run('/dev/sda', async () => 42), 42);
});
