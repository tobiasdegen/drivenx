'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { registerQueryLogIpc } = require('../../electron/ipc/query-log-ipc.js');

async function withDestination(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drivenx-query-export-'));
  const destination = path.join(dir, 'existing.json');
  try {
    await fs.writeFile(destination, 'original');
    await run(destination, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function make(destination, overrides = {}) {
  const handlers = new Map();
  let available = true;
  let content = '{"serial":"123"}';
  let revision = 0;
  const log = {
    entries: () => [],
    result: () => null,
    clear() {
      available = false;
      revision++;
    },
    clearRevision: () => revision,
    exportEntries: () => [{ id: 1, status: 'ok' }],
  };
  const deps = {
    register: (channel, fn) => handlers.set(channel, fn),
    queryLog: log,
    exportIndividual: (_log, id) =>
      available && id === 1 ? { filename: 'one.json', body: content } : null,
    getSettings: () => ({ locale: 'de-DE', theme: 'dark' }),
    getDialogOwner: () => null,
    showSaveDialog: async () => ({ canceled: false, filePath: destination }),
    writeFile: fs.writeFile,
    renameFile: fs.rename,
    removeFile: fs.rm,
    ...overrides,
  };
  registerQueryLogIpc(deps);
  return {
    handlers,
    log,
    change: (next) => {
      content = next;
    },
  };
}

test('single query result leaves an existing file untouched if it is cleared in the save dialog', async () => {
  await withDestination(async (destination) => {
    let writes = 0;
    const h = make(destination, {
      showSaveDialog: async () => {
        h.log.clear();
        return { filePath: destination };
      },
      writeFile: async (...args) => {
        writes++;
        await fs.writeFile(...args);
      },
    });
    await assert.rejects(
      h.handlers.get('diagnostics:saveQueryLogResult')(1),
      (error) => error.userMessageKey === 'queryResultUnavailable',
    );
    assert.equal(writes, 0);
    assert.equal(await fs.readFile(destination, 'utf8'), 'original');
  });
});

test('single query result is never committed after it disappears while staging', async () => {
  await withDestination(async (destination, dir) => {
    const h = make(destination, {
      writeFile: async (...args) => {
        await fs.writeFile(...args);
        h.log.clear();
      },
    });
    await assert.rejects(
      h.handlers.get('diagnostics:saveQueryLogResult')(1),
      (error) => error.userMessageKey === 'queryResultUnavailable',
    );
    assert.equal(await fs.readFile(destination, 'utf8'), 'original');
    assert.deepEqual(await fs.readdir(dir), ['existing.json']);
  });
});

test('changing a query result during staging prevents committing the earlier JSON', async () => {
  await withDestination(async (destination) => {
    const h = make(destination, {
      writeFile: async (...args) => {
        await fs.writeFile(...args);
        h.change('{"serial":"new"}');
      },
    });
    await assert.rejects(
      h.handlers.get('diagnostics:saveQueryLogResult')(1),
      (error) => error.userMessageKey === 'queryResultUnavailable',
    );
    assert.equal(await fs.readFile(destination, 'utf8'), 'original');
  });
});

test('both query export formats stage and replace the chosen file only after writing finishes', async () => {
  await withDestination(async (destination, dir) => {
    const stagedPaths = [];
    const h = make(destination, {
      writeFile: async (file, data, opts) => {
        assert.equal(
          await fs.readFile(destination, 'utf8'),
          stagedPaths.length === 0 ? 'original' : '{"serial":"123"}',
        );
        stagedPaths.push(file);
        assert.notEqual(file, destination);
        assert.equal(opts.flag, 'wx');
        await fs.writeFile(file, data, opts);
      },
    });
    const one = await h.handlers.get('diagnostics:saveQueryLogResult')(1);
    assert.deepEqual(one, { canceled: false });
    assert.deepEqual(JSON.parse(await fs.readFile(destination, 'utf8')), { serial: '123' });
    const all = await h.handlers.get('diagnostics:exportQueryLog')(true);
    assert.deepEqual(all, { canceled: false });
    assert.equal(JSON.parse(await fs.readFile(destination, 'utf8')).includesRaw, true);
    assert.equal(stagedPaths.length, 2);
    assert.deepEqual(await fs.readdir(dir), ['existing.json']);
  });
});

test('failed query export preserves an existing file and removes a partially written temp file', async () => {
  await withDestination(async (destination, dir) => {
    const h = make(destination, {
      writeFile: async (file, _data, opts) => {
        await fs.writeFile(file, 'partial', opts);
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      },
    });
    await assert.rejects(h.handlers.get('diagnostics:exportQueryLog')(false), /disk full/);
    assert.equal(await fs.readFile(destination, 'utf8'), 'original');
    assert.deepEqual(await fs.readdir(dir), ['existing.json']);
  });
});

test('query result revoked during an already started rename is not reported as exported', async () => {
  await withDestination(async (destination) => {
    const h = make(destination, {
      renameFile: async (source, target) => {
        await fs.rename(source, target);
        h.log.clear();
      },
    });
    await assert.rejects(
      h.handlers.get('diagnostics:saveQueryLogResult')(1),
      (error) => error.userMessageKey === 'queryResultUnavailable',
    );
    // A filesystem rename already in progress cannot be undone safely.
  });
});

test('clearing the full query log during staging revokes the export without changing its destination', async () => {
  await withDestination(async (destination, dir) => {
    const h = make(destination, {
      writeFile: async (...args) => {
        await fs.writeFile(...args);
        h.log.clear();
      },
    });
    await assert.rejects(
      h.handlers.get('diagnostics:exportQueryLog')(true),
      (error) => error.userMessageKey === 'queryResultUnavailable',
    );
    assert.equal(await fs.readFile(destination, 'utf8'), 'original');
    assert.deepEqual(await fs.readdir(dir), ['existing.json']);
  });
});
