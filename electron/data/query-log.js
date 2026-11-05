'use strict';

// Query results can contain serial numbers, user paths and system inventory.
// They stay in process memory, are never sent in the list IPC and are only
// exposed on explicit per-entry requests. Export includes them only by opt-in.
const LIMIT = 400;
const MAX_DEVICE = 160;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_SESSION_BYTES = 12 * 1024 * 1024;
const SYSTEM_COMMANDS = Object.freeze({
  'windows-inventory': 'Windows PowerShell · CIM/PnP',
  'windows-privilege': 'Windows whoami /groups',
  'diskutil-list': 'macOS diskutil list -plist physical',
  'diskutil-list-text': 'macOS diskutil list',
  'diskutil-info': 'macOS diskutil info -plist',
  'ioreg-usb': 'macOS ioreg -p IOService -r -c IOUSBHostDevice -l -w0',
  'mac-host-io': 'macOS ioreg -p IOService -r -c IOBlockStorageDriver -l -w0',
  'system-profiler-usb': 'macOS system_profiler SPUSBDataType -json',
});
function deviceFromArgs(args) {
  const value = args.find(
    (arg) =>
      typeof arg === 'string' && (/^\/dev\//.test(arg) || /^\\\\\.\\PhysicalDrive\d+$/i.test(arg)),
  );
  if (!value) return null;
  return value.length <= MAX_DEVICE && !/[\x00-\x1f\x7f]/.test(value) ? value : '[device]';
}
function describe(args) {
  const flags = args
    .filter((arg, index) => index === 0 || args[index - 1] !== '-B')
    .filter((arg) => arg !== '-B');
  const device = deviceFromArgs(flags);
  const mode = flags.includes('--scan-open')
    ? 'scan-open'
    : flags.includes('--scan')
      ? 'scan'
      : flags.includes('--version')
        ? 'version'
        : flags.includes('-t')
          ? 'self-test'
          : flags.includes('-x')
            ? 'extended'
            : flags.includes('-a')
              ? 'standard'
              : flags.includes('-i')
                ? 'identify'
                : 'other';
  const kind =
    mode === 'self-test'
      ? flags[flags.indexOf('-t') + 1] === 'short'
        ? 'short'
        : flags[flags.indexOf('-t') + 1] === 'long'
          ? 'long'
          : 'other'
      : null;
  const type = flags.includes('-d') ? flags[flags.indexOf('-d') + 1] : null;
  const allowedType =
    typeof type === 'string' && /^(?:[\w,+-]{1,60}|snt(?:jmicron|asmedia|realtek)\/sat)$/.test(type)
      ? type
      : null;
  const modeLabel = {
    'scan-open': '--scan-open -j',
    scan: '--scan -j',
    version: '--version',
    'self-test': `-t ${kind || 'other'} -j`,
    extended: '-x -j',
    standard: '-a -j',
    identify: '-i -j',
    other: '[other]',
  }[mode];
  const command = `smartctl ${modeLabel}${allowedType ? ` -d ${allowedType}` : ''}${device ? ` ${device}` : ''}`;
  return { mode, device, kind, command };
}
function resultAsText(result) {
  if (typeof result === 'string') return { text: result, format: 'text' };
  if (result && typeof result === 'object') {
    const value = result.json ?? result;
    try {
      return { text: JSON.stringify(value, null, 2), format: 'json' };
    } catch {
      /* An unsupported value should not break a device query. */
    }
  }
  return null;
}
function createQueryLog({
  maxEntries = LIMIT,
  maxResultBytes = MAX_RESULT_BYTES,
  maxSessionBytes = MAX_SESSION_BYTES,
  now = () => Date.now(),
} = {}) {
  const entries = [];
  const results = new Map();
  const listeners = new Set();
  let nextId = 0;
  let resultBytes = 0;
  let clearRevision = 0;
  function notify() {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* logging must never break device reads */
      }
    }
  }
  function dropResult(id) {
    const previous = results.get(id);
    if (!previous) return;
    resultBytes -= previous.bytes;
    results.delete(id);
  }
  function storeResult(record, result) {
    const data = resultAsText(result);
    if (!data) return;
    const bytes = Buffer.from(data.text, 'utf8');
    // Do not corrupt UTF-8 when truncating. The truncated result is a text
    // preview, never advertised as a complete, machine-readable JSON document.
    const clipped = bytes.length > maxResultBytes;
    const output = clipped ? bytes.subarray(0, maxResultBytes).toString('utf8') : data.text;
    const size = Buffer.byteLength(output, 'utf8');
    if (size > maxSessionBytes) return;
    while (resultBytes + size > maxSessionBytes && results.size) {
      dropResult(results.keys().next().value);
    }
    results.set(record.id, { text: output, format: data.format, bytes: size, truncated: clipped });
    resultBytes += size;
  }
  function prune() {
    while (entries.length > maxEntries) {
      const old = entries.pop();
      dropResult(old.id);
    }
  }
  async function recordCall(description, execute, interpretExitCode) {
    const start = now();
    const record = {
      id: ++nextId,
      startedAt: new Date(start).toISOString(),
      finishedAt: null,
      durationMs: null,
      ...description,
      status: 'running',
      exitCode: null,
      errorCode: null,
    };
    entries.unshift(record);
    prune();
    notify();
    try {
      const result = await execute();
      if (interpretExitCode) {
        const code = result?.json?.smartctl?.exit_status ?? result?.exitCode;
        record.exitCode = Number.isInteger(code) ? code : null;
        record.status =
          record.exitCode === null || record.exitCode === 0
            ? 'ok'
            : (record.exitCode & 0x03) !== 0
              ? 'error'
              : (record.exitCode & 0x04) !== 0
                ? result?.json?.nvme_smart_health_information_log ||
                  result?.json?.ata_smart_attributes?.table?.length
                  ? 'partial'
                  : 'error'
                : 'finding';
      } else record.status = 'ok';
      // An earlier running call may have been trimmed from the log by newer calls.
      if (entries.includes(record)) storeResult(record, result);
      return result;
    } catch (error) {
      record.status = 'error';
      const code =
        typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(error.code)
          ? error.code
          : null;
      record.errorCode =
        code ||
        (/Zeitüberschreitung|timed?\s*out/i.test(String(error?.message))
          ? 'ETIMEDOUT'
          : 'EXECUTION_ERROR');
      // On failed OS/smartctl processes the error is the only available output.
      // Preserve it only in the protected, bounded, on-demand result store.
      if (entries.includes(record)) {
        const pieces = [String(error?.message || 'Execution failed')];
        if (typeof error?.stdout === 'string' && error.stdout)
          pieces.push(`stdout:\n${error.stdout}`);
        if (typeof error?.stderr === 'string' && error.stderr)
          pieces.push(`stderr:\n${error.stderr}`);
        storeResult(record, pieces.join('\n\n'));
      }
      throw error;
    } finally {
      const end = now();
      record.finishedAt = new Date(end).toISOString();
      record.durationMs = Math.max(0, end - start);
      notify();
    }
  }
  function track(args, execute) {
    return recordCall(describe(args), execute, true);
  }
  function trackSystem(mode, execute, device = null) {
    if (!Object.hasOwn(SYSTEM_COMMANDS, mode)) throw new Error('Unbekannte Systemabfrage');
    const safeDevice =
      typeof device === 'string' && /^\/dev\/disk\d+$/.test(device) ? device : null;
    return recordCall(
      {
        mode,
        device: safeDevice,
        kind: null,
        command: SYSTEM_COMMANDS[mode] + (safeDevice ? ` ${safeDevice}` : ''),
      },
      execute,
      false,
    );
  }
  function entriesList() {
    return entries.map((entry) => ({
      ...entry,
      hasResult: results.has(entry.id),
      resultTruncated: results.get(entry.id)?.truncated ?? false,
    }));
  }
  function result(id) {
    if (!Number.isSafeInteger(id) || id < 1 || !entries.some((entry) => entry.id === id))
      return null;
    const data = results.get(id);
    return data ? { text: data.text, format: data.format, truncated: data.truncated } : null;
  }
  function exportEntries(includeRaw = false) {
    return entriesList().map((entry) =>
      includeRaw ? { ...entry, result: result(entry.id) } : entry,
    );
  }
  return Object.freeze({
    track,
    trackSystem,
    entries: entriesList,
    result,
    exportEntries,
    clearRevision: () => clearRevision,
    clear() {
      clearRevision++;
      entries.length = 0;
      results.clear();
      resultBytes = 0;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
const sessionQueryLog = createQueryLog();
module.exports = { createQueryLog, sessionQueryLog, describe };
