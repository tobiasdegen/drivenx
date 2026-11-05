// @ts-check
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyDirectory, readLimitedJson, atomicWrite } = require('./safe-files.js');
const { backendError } = require('../security/user-errors.js');
const { errorCode, errorMessage } = require('../security/process-error-details.js');
/** @typedef {import('../backend-contracts').SmartRaw} SmartRaw */
/** @typedef {import('../backend-contracts').HistoryRecord} HistoryRecord */
/** @typedef {import('../backend-contracts').HistoryRecordInput} HistoryRecordInput */
/** @typedef {import('../backend-contracts').HistoryEntry} HistoryEntry */
/** @typedef {import('../backend-contracts').Report} Report */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @typedef {{raw: SmartRaw; capturedAt: string; metrics?: Report['metrics']; health?: Report['health']}} HistoryReport */
const { plainAtaCount } = require('../diagnostics/ata-raw.js');
const { ataErrorLog } = require('../diagnostics/ata-logs.js');
const { identify } = require('../devices/device-identity.js');
const { METRICS, validHistoryTimestamp } = require('../../shared/diagnostic-metrics.mjs');
const { overviewMetrics } = require('../../shared/overview-metrics.mjs');
const MAX_RECORDS = 100;
const MAX_FILE_BYTES = 1024 * 1024;
const HISTORY_SCHEMA = 'drivenx.history.v1';
// Serialize writes to the same drive inside this process to prevent lost measurements.
/** @type {Map<string, Promise<HistoryRecord[]>>} */
const pendingWrites = new Map();

/** @param {unknown} value @returns {number | null} */
function numeric(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  return null;
}
// Only identifiers that are actually specific to a physical device may be used
// for persistent histories. Some USB bridges return generic placeholder serials.
/** @param {unknown} serial */
function reliableSerial(serial) {
  return identify({ serial_number: serial }).serial !== null;
}
// Physical identity deliberately excludes OS paths, bridge access modes and
// display aliases. Capacity is included to reject a misleading shared serial.
// Namespace lists, when available, distinguish distinct NVMe configurations.
/** @param {SmartRaw} raw @returns {string | null} */
function identity(raw) {
  const id = identify(raw);
  const model = id.model.replace(/\s+/g, ' ');
  if (
    !model ||
    /^(?:UNKNOWN|UNDEFINED|GENERIC|USB DISK|USB STORAGE|MASS STORAGE|STORAGE DEVICE|DISK DRIVE|EXTERNAL USB|BRIDGE)(?: DEVICE| DRIVE| DISK| STORAGE)?$/.test(
      model,
    )
  )
    return null;
  if (!id.serial && !id.wwn) return null;
  // If the controller exposes several namespaces but not the selected NSID,
  // model/serial/capacity may refer to multiple distinct logical drives.
  // Do not merge them into a shared history in that ambiguous case.
  const namespaces = raw?.nvme_namespaces;
  const multipleNamespaces = Array.isArray(namespaces) && namespaces.length > 1;
  const nsid = raw?.nvme_namespace_id;
  const selectedNamespace =
    typeof nsid === 'number' && Number.isSafeInteger(nsid) && nsid > 0 ? nsid : null;
  if (multipleNamespaces && (!selectedNamespace || !namespaces.some((ns) => ns?.id === nsid)))
    return null;
  // Prefer a reliable serial for continuity across transport modes that hide
  // WWN information. Use a reliable WWN only when a serial is unavailable.
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([model, id.serial || id.wwn, id.capacity, selectedNamespace]))
    .digest('hex');
}
/** @param {HistoryReport} report @returns {HistoryEntry | null} */
function snapshot(report) {
  const raw = report?.raw;
  const id = identity(raw);
  if (!id || !validHistoryTimestamp(report.capturedAt)) return null;
  const nv = raw.nvme_smart_health_information_log;
  const scsi = raw.scsi_error_counter_log;
  const ata = raw.ata_smart_attributes?.table;
  /** @param {number} attributeId */
  const counter = (attributeId) => {
    const item = Array.isArray(ata) ? ata.find((a) => a.id === attributeId) : null;
    // Same conservative ATA semantics as the health assessment and PDF.
    return plainAtaCount(item);
  };
  const summary = report.metrics ?? overviewMetrics(raw);
  /** @param {number} id @param {RegExp} names */
  const knownCounter = (id, names) => {
    const row = Array.isArray(ata)
      ? ata.find((r) => r?.id === id && names.test(String(r.name || '')))
      : null;
    return row ? plainAtaCount(row) : null;
  };
  const programFailures =
    knownCounter(171, /^Program_Fail_Count$/) ??
    knownCounter(181, /^(?:Program_Fail_Count|Program_Fail_Cnt_Total)$/);
  // History persists exact, safe integer counters. Larger exact ATA
  // byte volumes remain displayable, but cannot be rounded into history JSON.
  // Older or partial callers may supply metrics without this optional field.
  // A missing or malformed value must not throw during history persistence.
  const written = summary.ataWrittenBytes;
  const bytes = typeof written === 'string' && /^\d+$/.test(written) ? BigInt(written) : null;
  const ataWrittenBytes =
    bytes !== null && bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : null;
  const metrics = nv
    ? {
        powerOnHours: summary.powerOnHours,
        powerCycles: summary.powerCycles,
        wearPercent: summary.wearPercent,
        mediaErrors: numeric(nv.media_errors),
        availableSparePercent: numeric(nv.available_spare),
        nvmeReadUnits: numeric(nv.data_units_read),
        nvmeWrittenUnits: numeric(nv.data_units_written),
        nvmeErrorLogEntries: numeric(nv.num_err_log_entries),
        unsafeShutdowns: numeric(nv.unsafe_shutdowns),
      }
    : scsi
      ? {
          powerOnHours: summary.powerOnHours,
          powerCycles: summary.powerCycles,
          scsiReadErrors: numeric(scsi.read?.total_uncorrected_errors),
          scsiWriteErrors: numeric(scsi.write?.total_uncorrected_errors),
          scsiVerifyErrors: numeric(scsi.verify?.total_uncorrected_errors),
        }
      : {
          powerOnHours: summary.powerOnHours,
          powerCycles: summary.powerCycles,
          wearPercent: summary.wearPercent,
          ataWrittenBytes,
          reallocatedSectors: counter(5),
          pendingSectors: counter(197),
          offlineUncorrectable: counter(198),
          ataErrorCount: numeric(ataErrorLog(raw)?.count),
          ataCrcErrors: knownCounter(199, /(?:CRC|UDMA_CRC)/i),
          reportedUncorrectable: knownCounter(
            187,
            /^(?:Reported_Uncorrect|Uncorrectable_Error_Cnt)$/,
          ),
          ssdProgramFailures: raw.rotation_rate === 0 ? programFailures : null,
        };
  const diagnosis = report.health?.diagnosis;
  if (!diagnosis) return null;
  const status =
    diagnosis.domains?.media === null &&
    !['critical', 'defective'].includes(diagnosis.overallAlert ?? '')
      ? 'unassessable'
      : (diagnosis.overallAlert ?? 'unassessable');
  if (!['ok', 'observe', 'warning', 'critical', 'defective', 'unassessable'].includes(status))
    return null;
  const normalized = Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [key, numeric(value)]),
  );
  return { id, capturedAt: report.capturedAt, status, metrics: normalized };
}
/** @param {string} directory */
function historyDirectory(directory) {
  return path.join(directory, 'history');
}
/** @param {string} directory @param {string} id */
function historyFile(directory, id) {
  return path.join(historyDirectory(directory), `${id}.json`);
}
/** @param {string} directory @param {string} id */
function localBackupFile(directory, id) {
  return path.join(historyDirectory(directory), '_Backups', `${id}.json`);
}
// Never traverse a symlinked history directory: the application is elevated on
// Windows and its persistent storage may reside on writable portable media.
/** @param {string} directory @param {boolean} [create] */
async function checkHistoryDirectory(directory, create = false) {
  try {
    await verifyDirectory(directory, create);
    await verifyDirectory(historyDirectory(directory), create);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT' && !create) return false;
    if (errorMessage(error) === 'Unsicheres Datenverzeichnis')
      throw backendError('historyUnsafeFolder');
    throw error;
  }
}
/** @param {unknown} item @returns {item is HistoryRecordInput} */
function validRecord(item) {
  if (!isRecord(item) || !validHistoryTimestamp(item.capturedAt) || !isRecord(item.metrics))
    return false;
  if (
    typeof item.status !== 'string' ||
    !['ok', 'observe', 'warning', 'critical', 'defective', 'unassessable'].includes(item.status)
  )
    return false;
  return Object.entries(item.metrics).every(
    ([key, value]) => Object.hasOwn(METRICS, key) && (value === null || numeric(value) !== null),
  );
}
/** @param {HistoryRecordInput} row @returns {HistoryRecord} */
function normalizeRecord(row) {
  return {
    capturedAt: row.capturedAt,
    status: row.status,
    metrics: Object.fromEntries(
      Object.entries(row.metrics).map(([key, value]) => [key, numeric(value)]),
    ),
  };
}
/** @param {string} directory @param {string} id @returns {Promise<HistoryRecord[]>} */
async function read(directory, id) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw backendError('historyInvalidIdentity');
  try {
    const present = await checkHistoryDirectory(directory);
    if (!present) return [];
    const p = historyFile(directory, id);
    const info = await fs.lstat(p);
    if (!info.isFile() || info.isSymbolicLink()) throw backendError('historyFileType');
    const data = await readLimitedJson(p, MAX_FILE_BYTES);
    if (!Array.isArray(data) || data.length > MAX_RECORDS) throw backendError('historyInvalid');
    if (!data.every(validRecord)) throw backendError('historyInvalid');
    return data
      .map(normalizeRecord)
      .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return [];
    throw e;
  }
}
// Recheck the scan/snapshot while a write is waiting in the per-disk queue.
// A permission to save an earlier snapshot must not outlive a new discovery.
/** @param {(() => boolean) | undefined} canWrite */
function assertCurrent(canWrite) {
  if (!canWrite) return;
  let allowed = false;
  try {
    allowed = canWrite() === true;
  } catch {
    /* revocation is expected on rescan */
  }
  if (!allowed) {
    const error = /** @type {Error & {code?: string}} */ (backendError('staleDiagnosisData'));
    error.code = 'STALE_DIAGNOSIS';
    throw error;
  }
}
/** @param {string} directory @param {HistoryEntry} entry @param {(() => boolean) | undefined} canWrite @param {boolean} autoBackup @returns {Promise<HistoryRecord[]>} */
async function saveUnlocked(directory, entry, canWrite, autoBackup) {
  assertCurrent(canWrite);
  const file = historyFile(directory, entry.id);
  const previous = await read(directory, entry.id);
  assertCurrent(canWrite);
  const list = [
    ...previous.filter((p) => p.capturedAt !== entry.capturedAt),
    { capturedAt: entry.capturedAt, status: entry.status, metrics: entry.metrics },
  ]
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
    .slice(-MAX_RECORDS);
  await checkHistoryDirectory(directory, true);
  assertCurrent(canWrite);
  await atomicWrite(file, JSON.stringify(list, null, 2), MAX_FILE_BYTES, () =>
    assertCurrent(canWrite),
  );
  assertCurrent(canWrite);
  if (autoBackup) {
    await checkHistoryDirectory(directory, true);
    await verifyDirectory(path.join(historyDirectory(directory), '_Backups'), true);
    await atomicWrite(
      localBackupFile(directory, entry.id),
      JSON.stringify(exportBackup(entry.id, list), null, 2),
      MAX_FILE_BYTES,
      () => assertCurrent(canWrite),
    );
  }
  return list;
}
/** @param {string} directory @param {HistoryReport} report @param {(() => boolean)} [canWrite] @param {boolean} [autoBackup] @returns {Promise<HistoryRecord[]>} */
async function save(directory, report, canWrite, autoBackup = false) {
  const entry = snapshot(report);
  if (!entry) throw backendError('historyIdentityRequired');
  const file = historyFile(directory, entry.id);
  const previous = pendingWrites.get(file) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(() => saveUnlocked(directory, entry, canWrite, autoBackup));
  pendingWrites.set(file, job);
  try {
    return await job;
  } finally {
    if (pendingWrites.get(file) === job) pendingWrites.delete(file);
  }
}
// Portable history backups are scoped to one verified physical drive. Never
// accept another drive's records, unknown metrics or unchecked file structures.
/** @param {string} directory @param {string} expectedId @param {unknown} backup @param {(() => boolean)} [canWrite] @returns {Promise<HistoryRecord[]>} */
async function importBackup(directory, expectedId, backup, canWrite) {
  if (
    !/^[a-f0-9]{64}$/.test(expectedId) ||
    !isRecord(backup) ||
    backup.schema !== HISTORY_SCHEMA ||
    backup.id !== expectedId ||
    !Array.isArray(backup.records) ||
    backup.records.length > MAX_RECORDS ||
    !backup.records.every(validRecord)
  )
    throw backendError('historyWrongDrive');
  // Freeze the validated backup rows before the asynchronous read/commit.
  // Do not keep consulting a mutable caller-owned IPC object after awaits.
  const backupRecords = backup.records.map(normalizeRecord);
  const file = historyFile(directory, expectedId);
  const previous = pendingWrites.get(file) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(async () => {
      assertCurrent(canWrite);
      const current = await read(directory, expectedId);
      assertCurrent(canWrite);
      const merged = new Map(current.map((r) => [r.capturedAt, r]));
      for (const row of backupRecords) merged.set(row.capturedAt, row);
      const list = [...merged.values()]
        .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
        .slice(-MAX_RECORDS);
      await checkHistoryDirectory(directory, true);
      assertCurrent(canWrite);
      await atomicWrite(file, JSON.stringify(list, null, 2), MAX_FILE_BYTES, () =>
        assertCurrent(canWrite),
      );
      assertCurrent(canWrite);
      return list;
    });
  pendingWrites.set(file, job);
  try {
    return await job;
  } finally {
    if (pendingWrites.get(file) === job) pendingWrites.delete(file);
  }
}
/** @param {string} id @param {unknown} records */
function exportBackup(id, records) {
  if (
    !/^[a-f0-9]{64}$/.test(id) ||
    !Array.isArray(records) ||
    records.length > MAX_RECORDS ||
    !records.every(validRecord)
  )
    throw new Error('Messhistorie ist ungültig.');
  return {
    schema: HISTORY_SCHEMA,
    id,
    exportedAt: new Date().toISOString(),
    records: records.map(normalizeRecord),
  };
}
// Local copies are stored outside the live history files so that a lost live
// file can be explicitly restored. Do not restore automatically or trust a
// symlink, incorrect drive identity, or unsupported record schema.
/** @param {string} directory @param {string} id */
async function readLocalBackup(directory, id) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw backendError('historyInvalidIdentity');
  const folder = path.join(historyDirectory(directory), '_Backups');
  try {
    await verifyDirectory(directory);
    await verifyDirectory(historyDirectory(directory));
    await verifyDirectory(folder);
    const source = localBackupFile(directory, id);
    const backup = await readLimitedJson(source, MAX_FILE_BYTES);
    if (
      !isRecord(backup) ||
      backup.schema !== HISTORY_SCHEMA ||
      backup.id !== id ||
      !Array.isArray(backup.records) ||
      backup.records.length > MAX_RECORDS ||
      !backup.records.every(validRecord)
    )
      throw backendError('historyInvalidBackup');
    return backup;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}
/** @param {string} directory @param {string} id */
async function hasLocalBackup(directory, id) {
  return (await readLocalBackup(directory, id)) !== null;
}
/** @param {string} directory @param {string} id @param {(() => boolean)} [canWrite] */
async function restoreLocalBackup(directory, id, canWrite) {
  assertCurrent(canWrite);
  const backup = await readLocalBackup(directory, id);
  if (!backup) throw backendError('historyBackupMissing');
  return importBackup(directory, id, backup, canWrite);
}
// Explicit registry: every metric requires a stable meaning. Do not infer units
// or a fault condition from arbitrary vendor attributes.
/** @param {Array<{capturedAt?: string; metrics?: Record<string, unknown>}>} records */
function deltas(records) {
  if (!Array.isArray(records) || records.length < 2) return [];
  const ordered = records.filter((r) => r && typeof r === 'object').slice();
  // In-memory comparisons may not have timestamps. Preserve insertion order
  // unless all records have valid timestamps.
  if (ordered.every((r) => validHistoryTimestamp(r.capturedAt)))
    ordered.sort((a, b) => Date.parse(a.capturedAt ?? '') - Date.parse(b.capturedAt ?? ''));
  if (ordered.length < 2) return [];
  const [before, after] = ordered.slice(-2);
  const old = before?.metrics || {},
    current = after?.metrics || {};
  return Object.entries(METRICS).flatMap(([key, definition]) => {
    const previous = numeric(old[key]),
      value = numeric(current[key]);
    if (previous === null || value === null) return [];
    const change = value - previous;
    return [
      {
        key,
        previous,
        current: value,
        change,
        reset: definition.kind === 'counter' && change < 0,
        kind: definition.kind,
        unit: definition.unit,
      },
    ];
  });
}

module.exports = {
  identity,
  reliableSerial,
  snapshot,
  read,
  save,
  deltas,
  numeric,
  validRecord,
  METRICS,
  MAX_RECORDS,
  importBackup,
  exportBackup,
  readLocalBackup,
  hasLocalBackup,
  restoreLocalBackup,
};
