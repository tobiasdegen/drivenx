'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerHistoryIpc } = require('../../electron/ipc/history-ipc.js');
const { registerQueryLogIpc } = require('../../electron/ipc/query-log-ipc.js');

const registerHandlers = (setup, options) => {
  const handlers = new Map();
  setup({ register: (name, callback) => handlers.set(name, callback), ...options });
  return handlers;
};

test('history import refuses a changed report after the file dialog, before reading or writing', async () => {
  const original = { reportId: 'first', raw: { serial_number: 'a' } };
  let selected = original;
  let imports = 0;
  let reads = 0;
  const handlers = registerHandlers(registerHistoryIpc, {
    currentReport: () => selected,
    history: {
      identity: () => 'a'.repeat(64),
      importBackup: async () => {
        imports++;
      },
    },
    getUserDataPath: () => '/tmp',
    ipcValidate: { reportIdToken: (v) => v },
    showSaveDialog: () => {
      throw new Error('unexpected');
    },
    showOpenDialog: async () => {
      selected = null;
      return { canceled: false, filePaths: ['/tmp/history.json'] };
    },
    getMainWindow: () => null,
    getSettings: () => ({ locale: 'de-DE' }),
    readLimitedJson: async () => {
      reads++;
      return {};
    },
    writeFile: async () => {
      throw new Error('unexpected');
    },
  });
  await assert.rejects(
    handlers.get('diagnostics:importHistory')({ name: '/dev/disk1' }, 'first'),
    /nicht mehr aktuell/,
  );
  assert.equal(imports, 0);
  assert.equal(reads, 0);
});

test('history import also refuses a rescan while the backup is being read', async () => {
  const original = { reportId: 'first', raw: { serial_number: 'a' } };
  let selected = original;
  let imports = 0;
  const handlers = registerHandlers(registerHistoryIpc, {
    currentReport: () => selected,
    history: {
      identity: () => 'a'.repeat(64),
      importBackup: async () => {
        imports++;
      },
    },
    getUserDataPath: () => '/tmp',
    ipcValidate: { reportIdToken: (v) => v },
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/history.json'] }),
    getMainWindow: () => null,
    getSettings: () => ({ locale: 'en-US' }),
    readLimitedJson: async () => {
      selected = null;
      return {};
    },
    writeFile: async () => {},
  });
  await assert.rejects(
    handlers.get('diagnostics:importHistory')({ name: '/dev/disk1' }, 'first'),
    /nicht mehr aktuell/,
  );
  assert.equal(imports, 0);
});

test('query log keeps the authorized channel names and rejects invalid export mode', async () => {
  let written = false;
  const handlers = registerHandlers(registerQueryLogIpc, {
    queryLog: { entries: () => [], result: () => null, clear: () => {}, exportEntries: () => [] },
    exportIndividual: () => null,
    getSettings: () => ({ locale: 'de-DE', theme: 'dark' }),
    getDialogOwner: () => null,
    showSaveDialog: async () => ({ canceled: false, filePath: '/tmp/log.json' }),
    writeFile: async () => {
      written = true;
    },
  });
  assert.deepEqual(
    [...handlers.keys()],
    [
      'diagnostics:queryLogAppearance',
      'diagnostics:queryLog',
      'diagnostics:queryLogResult',
      'diagnostics:saveQueryLogResult',
      'diagnostics:clearQueryLog',
      'diagnostics:exportQueryLog',
    ],
  );
  await assert.rejects(handlers.get('diagnostics:exportQueryLog')('yes'), /Ungültiger Exportmodus/);
  await assert.rejects(handlers.get('diagnostics:saveQueryLogResult')(1), /nicht mehr verfügbar/);
  assert.equal(written, false);
});

test('history IPC discards results of an outdated asynchronous read', async () => {
  const original = { reportId: 'initial', raw: { serial_number: 'A' } };
  let selected = original;
  const handlers = registerHandlers(registerHistoryIpc, {
    currentReport: () => selected,
    history: {
      identity: () => 'a'.repeat(64),
      read: async () => {
        selected = null;
        return [];
      },
    },
    getUserDataPath: () => '/tmp',
    ipcValidate: { reportIdToken: (v) => v },
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true }),
    getMainWindow: () => null,
    getSettings: () => ({ locale: 'de-DE' }),
    readLimitedJson: async () => null,
    writeFile: async () => {},
  });
  await assert.rejects(
    handlers.get('diagnostics:history')({ name: '/dev/sda' }, 'initial'),
    /nicht mehr aktuell/,
  );
});

test('history backup export refuses to write after report changes in the save dialog', async () => {
  const original = { reportId: 'initial', raw: { serial_number: 'A' } };
  let selected = original;
  let writes = 0;
  const handlers = registerHandlers(registerHistoryIpc, {
    currentReport: () => selected,
    history: { identity: () => 'a'.repeat(64), read: async () => [], exportBackup: () => ({}) },
    getUserDataPath: () => '/tmp',
    ipcValidate: { reportIdToken: (v) => v },
    showSaveDialog: async () => {
      selected = null;
      return { filePath: '/tmp/history.json' };
    },
    showOpenDialog: async () => ({ canceled: true }),
    getMainWindow: () => null,
    getSettings: () => ({ locale: 'de-DE' }),
    readLimitedJson: async () => null,
    writeFile: async () => {
      writes++;
    },
  });
  await assert.rejects(
    handlers.get('diagnostics:exportHistory')({ name: '/dev/sda' }, 'initial'),
    /nicht mehr aktuell/,
  );
  assert.equal(writes, 0);
});

test('query log save dialogs and history backup dialogs use the selected language', async () => {
  const titles = [];
  const queryHandlers = registerHandlers(registerQueryLogIpc, {
    queryLog: { entries: () => [], result: () => null, clear() {}, exportEntries: () => [] },
    exportIndividual: () => ({ filename: 'sample.json', body: '{}' }),
    getSettings: () => ({ locale: 'en-US', theme: 'dark' }),
    getDialogOwner: () => null,
    showSaveDialog: async (_owner, options) => {
      titles.push(options.title);
      return { canceled: true };
    },
    writeFile: async () => {
      throw new Error('Unexpected write');
    },
  });
  await queryHandlers.get('diagnostics:saveQueryLogResult')(1);
  await queryHandlers.get('diagnostics:exportQueryLog')(false);
  const report = { reportId: 'a', raw: { serial_number: 'a' } };
  const historyHandlers = registerHandlers(registerHistoryIpc, {
    currentReport: () => report,
    history: { identity: () => 'a'.repeat(64), read: async () => [] },
    getUserDataPath: () => '/tmp',
    ipcValidate: { reportIdToken: (v) => v },
    getMainWindow: () => null,
    getSettings: () => ({ locale: 'en-US' }),
    showSaveDialog: async (_owner, options) => {
      titles.push(options.title);
      return { canceled: true };
    },
    showOpenDialog: async (_owner, options) => {
      titles.push(options.title);
      return { canceled: true };
    },
    readLimitedJson: async () => {
      throw new Error('Unexpected read');
    },
    writeFile: async () => {
      throw new Error('Unexpected write');
    },
  });
  await historyHandlers.get('diagnostics:exportHistory')({ name: '/dev/disk2' }, 'a');
  await historyHandlers.get('diagnostics:importHistory')({ name: '/dev/disk2' }, 'a');
  assert.deepEqual(titles, [
    'Save individual query result',
    'Save query log',
    'Back up measurement history',
    'Restore measurement history',
  ]);
});

test('all history IPC calls refuse an older report on the same drive before any I/O', async () => {
  const report = { reportId: 'new', raw: { model_name: 'SSD', serial_number: 'S1' } };
  let sideEffects = 0;
  const handlers = registerHandlers(registerHistoryIpc, {
    currentReport: () => report,
    history: {
      identity: () => {
        sideEffects++;
        return 'a'.repeat(64);
      },
      read: async () => {
        sideEffects++;
        return [];
      },
      save: async () => {
        sideEffects++;
        return [];
      },
      importBackup: async () => {
        sideEffects++;
        return [];
      },
      exportBackup: () => {
        sideEffects++;
        return {};
      },
    },
    getUserDataPath: () => '/tmp',
    ipcValidate: { reportIdToken: (v) => v },
    getMainWindow: () => null,
    getSettings: () => ({ locale: 'de-DE' }),
    showSaveDialog: async () => {
      sideEffects++;
      return { canceled: true };
    },
    showOpenDialog: async () => {
      sideEffects++;
      return { canceled: true };
    },
    readLimitedJson: async () => {
      sideEffects++;
      return {};
    },
    writeFile: async () => {
      sideEffects++;
    },
  });
  for (const command of ['history', 'saveHistory', 'exportHistory', 'importHistory']) {
    await assert.rejects(
      handlers.get(`diagnostics:${command}`)({ name: '/dev/sda', type: 'sat' }, 'old'),
      /nicht mehr aktuell/,
    );
    assert.equal(sideEffects, 0, command);
  }
});

test('history IPC rejects missing or malformed report tokens before touching disk', async () => {
  const { reportIdToken } = require('../../electron/ipc/ipc-validation.js');
  let reportLookups = 0;
  const handlers = registerHandlers(registerHistoryIpc, {
    currentReport: () => {
      reportLookups++;
      return null;
    },
    history: {},
    ipcValidate: { reportIdToken },
  });
  for (const command of ['history', 'saveHistory', 'exportHistory', 'importHistory']) {
    await assert.rejects(
      handlers.get(`diagnostics:${command}`)({ name: '/dev/sda' }),
      /Messungskennung/,
    );
  }
  assert.equal(reportLookups, 0);
});

test('history loading is bound to a report even when the drive stays selected', async () => {
  const first = { reportId: 'first', raw: { serial_number: 'S' } };
  const second = { reportId: 'second', raw: { serial_number: 'S' } };
  let active = first;
  let finishRead;
  const reading = new Promise((resolve) => {
    finishRead = resolve;
  });
  const handlers = registerHandlers(registerHistoryIpc, {
    currentReport: () => active,
    history: { identity: () => 'a'.repeat(64), read: async () => reading },
    getUserDataPath: () => '/tmp',
    ipcValidate: { reportIdToken: (v) => v },
  });
  const pending = handlers.get('diagnostics:history')({ name: '/dev/sda' }, 'first');
  active = second;
  finishRead([]);
  await assert.rejects(pending, /nicht mehr aktuell/);
});

test('history backup cannot overwrite an existing file if the report is revoked while staging', async () => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-backup-revoke-'));
  try {
    const destination = path.join(directory, 'history.json');
    await fs.writeFile(destination, 'KEEP THE EXISTING BACKUP');
    const snapshot = { reportId: 'initial', raw: { serial_number: 'A' } };
    let selected = snapshot;
    const handlers = registerHandlers(registerHistoryIpc, {
      currentReport: () => selected,
      history: {
        identity: () => 'a'.repeat(64),
        read: async () => [],
        exportBackup: () => ({ schema: 'drivenx.history.v1', records: [] }),
      },
      getUserDataPath: () => directory,
      ipcValidate: { reportIdToken: (v) => v },
      showSaveDialog: async () => ({ canceled: false, filePath: destination }),
      showOpenDialog: async () => ({ canceled: true }),
      getMainWindow: () => null,
      getSettings: () => ({ locale: 'de-DE' }),
      readLimitedJson: async () => [],
      writeFile: async (file, data, options) => {
        await fs.writeFile(file, data, options);
        selected = null;
      },
    });
    await assert.rejects(
      handlers.get('diagnostics:exportHistory')({ name: '/dev/sda' }, 'initial'),
      /nicht mehr aktuell/,
    );
    assert.equal(await fs.readFile(destination, 'utf8'), 'KEEP THE EXISTING BACKUP');
    assert.deepEqual(await fs.readdir(directory), ['history.json']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
