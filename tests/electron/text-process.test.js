'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { runTextProcess } = require('../../electron/security/text-process.js');
function fake(callback) {
  let killed = false,
    options;
  return {
    spawnProcess: (_exec, _args, opts) => {
      options = opts;
      const c = new EventEmitter();
      for (const name of ['stdout', 'stderr']) {
        c[name] = new EventEmitter();
        c[name].setEncoding = () => {};
      }
      c.kill = () => {
        killed = true;
      };
      queueMicrotask(() => callback(c));
      return c;
    },
    killed: () => killed,
    options: () => options,
  };
}
test('successful command uses shell:false', async () => {
  const f = fake((c) => {
    c.stdout.emit('data', 'data');
    c.emit('close', 0);
  });
  assert.equal(await runTextProcess('/usr/bin/test', [], { spawnProcess: f.spawnProcess }), 'data');
  assert.equal(f.options().shell, false);
});
test('stderr is bounded and process killed', async () => {
  const f = fake((c) => c.stderr.emit('data', 'x'.repeat(150)));
  await assert.rejects(
    runTextProcess('cmd', [], { spawnProcess: f.spawnProcess, maxError: 100 }),
    /Fehlerausgabe zu groß/,
  );
  assert.equal(f.killed(), true);
});
test('stdout is bounded and process killed', async () => {
  const f = fake((c) => c.stdout.emit('data', 'x'.repeat(150)));
  await assert.rejects(
    runTextProcess('cmd', [], { spawnProcess: f.spawnProcess, maxOutput: 100 }),
    /Standardausgabe zu groß/,
  );
  assert.equal(f.killed(), true);
});
test('timeout kills hung process', async () => {
  const f = fake(() => {});
  await assert.rejects(
    runTextProcess('cmd', [], { spawnProcess: f.spawnProcess, timeout: 10 }),
    /Zeitüberschreitung/,
  );
  assert.equal(f.killed(), true);
});
test('nonzero code has bounded error description', async () => {
  const f = fake((c) => {
    c.stderr.emit('data', 'failure');
    c.emit('close', 1);
  });
  await assert.rejects(runTextProcess('cmd', [], { spawnProcess: f.spawnProcess }), /failure/);
});

test('killed text process waits until close before reporting an abort', async () => {
  let closeWasSeen = false;
  const f = fake((c) => {
    const original = c.kill;
    c.kill = (signal) => {
      original(signal);
      setTimeout(() => {
        closeWasSeen = true;
        c.emit('close', null);
      }, 10);
    };
    c.stdout.emit('data', 'x'.repeat(150));
  });
  await assert.rejects(
    runTextProcess('cmd', [], { spawnProcess: f.spawnProcess, maxOutput: 100 }),
    /zu groß/,
  );
  assert.equal(closeWasSeen, true);
});

test('OS command pipe errors reject gracefully rather than emitting an uncaught exception', async () => {
  const f = fake((child) => child.stdout.emit('error', new Error('closed pipe')));
  await assert.rejects(
    runTextProcess('cmd', [], { spawnProcess: f.spawnProcess }),
    /Ausgabestream fehlgeschlagen: closed pipe/,
  );
  assert.equal(f.killed(), true);
});

test('text command child error waits for confirmed process close', async () => {
  let closed = false;
  const f = fake((child) => {
    child.kill = () => {
      setTimeout(() => {
        closed = true;
        child.emit('close', null);
      }, 12);
    };
    child.emit('error', new Error('OS failure'));
  });
  await assert.rejects(runTextProcess('cmd', [], { spawnProcess: f.spawnProcess }), /OS failure/);
  assert.equal(closed, true);
});

test('non-Error thrown during text command spawn is reported', async () => {
  await assert.rejects(
    runTextProcess('cmd', [], {
      spawnProcess: () => {
        throw 'spawn threw a string';
      },
    }),
    /spawn threw a string/,
  );
});
