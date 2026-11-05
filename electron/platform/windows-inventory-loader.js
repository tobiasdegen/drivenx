'use strict';
// Windows storage metadata is optional and must never delay the SMART device list.
// One Windows inventory process per discovery; serialize refreshes to avoid
// launching multiple expensive PowerShell/PnP enumerations simultaneously.
const path = require('node:path');
const { getCatalogSection } = require('../ui/translator.js');
const { runTextProcess } = require('../security/text-process.js');
const { INVENTORY_SCRIPT, parseInventoryOutput } = require('./windows-connection.js');
const { sessionQueryLog } = require('../data/query-log.js');

async function readWindowsInventory({ env = process.env, run = runTextProcess } = {}) {
  const systemRoot = env.SystemRoot || env.windir;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot))
    throw new Error('Windows-Systemverzeichnis nicht verfügbar');
  const powershell = path.win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script = Buffer.from(INVENTORY_SCRIPT, 'utf16le').toString('base64');
  const output = await sessionQueryLog.trackSystem('windows-inventory', () =>
    run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', script], {
      timeout: 30000,
      maxOutput: 4 * 1024 * 1024,
    }),
  );
  return parseInventoryOutput(output);
}

function inventoryWarning(error, locale = 'de-DE') {
  const labels = getCatalogSection(locale, 'backendErrors');
  // Display no absolute PowerShell path or untrusted process-output text.
  const message = String(error?.message || '');
  if (/Zeitüberschreitung|timed?\s*out/i.test(message)) {
    return labels.inventoryTimeout;
  }
  return labels.inventoryFailed;
}

function createWindowsInventoryLoader(read = readWindowsInventory) {
  let tail = Promise.resolve();
  function start(locale = 'de-DE') {
    // Failures do not poison the next scan, and all rejections are consumed
    // even if the user closes the window before requesting enrichment.
    const job = tail.then(async () => {
      const startedAt = Date.now();
      try {
        return { inventory: await read(), warning: null, durationMs: Date.now() - startedAt };
      } catch (err) {
        return {
          inventory: null,
          warning: inventoryWarning(err, locale),
          durationMs: Date.now() - startedAt,
        };
      }
    });
    tail = job.then(() => undefined);
    return job;
  }
  return { start };
}

const loader = createWindowsInventoryLoader();
module.exports = {
  readWindowsInventory,
  createWindowsInventoryLoader,
  startWindowsInventory: (locale) => loader.start(locale),
};
