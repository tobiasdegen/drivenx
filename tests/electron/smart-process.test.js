'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { runSmartProcess } = require('../../electron/devices/smart-process.js');
function fakeProcess(callback) {
  let child,
    killed = false;
  const spawnProcess = () => {
    child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    child.kill = () => {
      killed = true;
      return true;
    };
    queueMicrotask(() => callback(child));
    return child;
  };
  return { spawnProcess, wasKilled: () => killed };
}
test('smartctl returns JSON even for nonzero SMART bitmask', async () => {
  const fake = fakeProcess((c) => {
    c.stdout.emit('data', '{"smartctl":{"exit_status":4}}');
    c.emit('close', 4);
  });
  const r = await runSmartProcess('/absolute/smartctl', ['-j'], {
    spawnProcess: fake.spawnProcess,
  });
  assert.equal(r.exitCode, 4);
  assert.equal(r.json.smartctl.exit_status, 4);
});
test('unresponsive smartctl is killed and rejected on timeout', async () => {
  const fake = fakeProcess(() => {});
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], { spawnProcess: fake.spawnProcess, timeout: 15 }),
    /Zeitüberschreitung/,
  );
  assert.equal(fake.wasKilled(), true);
});
test('excess smartctl stdout is killed without waiting for close', async () => {
  const fake = fakeProcess((c) => c.stdout.emit('data', 'x'.repeat(120)));
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], { spawnProcess: fake.spawnProcess, maxBytes: 100 }),
    /4 MiB/,
  );
  assert.equal(fake.wasKilled(), true);
});
test('excess smartctl stderr is also bounded', async () => {
  const fake = fakeProcess((c) => c.stderr.emit('data', 'x'.repeat(120)));
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], { spawnProcess: fake.spawnProcess, maxBytes: 100 }),
    /4 MiB/,
  );
  assert.equal(fake.wasKilled(), true);
});
test('malformed output is not treated as SMART health data', async () => {
  const fake = fakeProcess((c) => {
    c.stdout.emit('data', 'not json');
    c.emit('close', 1);
  });
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], { spawnProcess: fake.spawnProcess }),
    /Keine gültige JSON/,
  );
});

test('killed smartctl releases its operation only after process close', async () => {
  let closeWasSeen = false;
  const fake = fakeProcess((child) => {
    // Trigger an oversized output; the child emits close in response to SIGKILL.
    const original = child.kill;
    child.kill = (signal) => {
      const value = original(signal);
      setTimeout(() => {
        closeWasSeen = true;
        child.emit('close', null);
      }, 10);
      return value;
    };
    child.stdout.emit('data', 'x'.repeat(128));
  });
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], { spawnProcess: fake.spawnProcess, maxBytes: 100 }),
    /überschreitet/,
  );
  assert.equal(closeWasSeen, true);
});

test('structurally invalid smartctl JSON never enters diagnostic pipeline', async () => {
  const fake = fakeProcess((c) => {
    c.stdout.emit('data', '[{"smartctl":{}}]');
    c.emit('close', 0);
  });
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], { spawnProcess: fake.spawnProcess }),
    /kein JSON-Objekt/,
  );
});

test('timeout without confirmed close marks process error to quarantine drive', async () => {
  const fake = fakeProcess(() => {});
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], { spawnProcess: fake.spawnProcess, timeout: 5 }),
    (error) => error.processCloseUnconfirmed === true && /Zeitüberschreitung/.test(error.message),
  );
});

test('stdout pipe error aborts smartctl and waits for confirmed close', async () => {
  let closed = false;
  const fake = fakeProcess((child) => {
    const originalKill = child.kill;
    child.kill = (signal) => {
      originalKill(signal);
      setTimeout(() => {
        closed = true;
        child.emit('close', null);
      }, 10);
      return true;
    };
    child.stdout.emit('error', new Error('broken pipe'));
  });
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], { spawnProcess: fake.spawnProcess }),
    (error) => /Ausgabestream/.test(error.message) && !error.processCloseUnconfirmed,
  );
  assert.equal(fake.wasKilled(), true);
  assert.equal(closed, true);
});

test('unconfirmed stderr pipe failure quarantines device like other failed terminations', async () => {
  const fake = fakeProcess((child) => child.stderr.emit('error', new Error('pipe unreadable')));
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], { spawnProcess: fake.spawnProcess }),
    (error) => error.processCloseUnconfirmed === true && /Ausgabestream/.test(error.message),
  );
  assert.equal(fake.wasKilled(), true);
});

test('async child error waits for close before freeing SMART operation', async () => {
  let closed = false;
  const fake = fakeProcess((child) => {
    child.kill = () => {
      setTimeout(() => {
        closed = true;
        child.emit('close', null);
      }, 12);
      return true;
    };
    child.emit('error', Object.assign(new Error('access denied by OS'), { code: 'EACCES' }));
  });
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], { spawnProcess: fake.spawnProcess }),
    (error) => error.code === 'executable_blocked' && !error.processCloseUnconfirmed,
  );
  assert.equal(closed, true);
});

test('unconfirmed async child error quarantines the disk', async () => {
  const fake = fakeProcess((child) => {
    child.emit('error', Object.assign(new Error('I/O failed'), { code: 'EIO' }));
  });
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], { spawnProcess: fake.spawnProcess }),
    (error) => error.processCloseUnconfirmed === true && /I\/O failed/.test(error.message),
  );
  assert.equal(fake.wasKilled(), true);
});

test('non-Error thrown during smartctl spawn has a controlled message', async () => {
  await assert.rejects(
    runSmartProcess('/absolute/smartctl', [], {
      spawnProcess: () => {
        throw 'broken spawn';
      },
    }),
    /broken spawn/,
  );
});
