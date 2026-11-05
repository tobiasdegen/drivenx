// @ts-check
'use strict';
/** @typedef {import('../backend-contracts').HistoryIpcDependencies} HistoryIpcDependencies */
const { backendError } = require('../security/user-errors.js');
const { getCatalogSection } = require('../ui/translator.js');
const { stagedExport } = require('../reports/staged-export.js');

/** History IPC. Import validates snapshot identity again after file dialogs.
 * @param {HistoryIpcDependencies} dependencies
 */
function registerHistoryIpc({
  register,
  currentReport,
  history,
  getUserDataPath,
  ipcValidate,
  showSaveDialog,
  showOpenDialog,
  getMainWindow,
  getSettings,
  readLimitedJson,
  writeFile,
  renameFile,
  removeFile,
}) {
  // Every history operation is bound to the same immutable diagnosis snapshot
  // as self-tests and exports. A refresh of the SAME drive revokes old UI actions.
  /** @param {unknown} device @param {unknown} reportId */
  function requireSnapshot(device, reportId) {
    const token = ipcValidate.reportIdToken(reportId);
    const report = currentReport(device);
    if (!report || report.reportId !== token) throw backendError('staleDiagnosisData');
    return report;
  }
  register('diagnostics:history', async (device, reportId) => {
    const report = requireSnapshot(device, reportId);
    const id = history.identity(report.raw);
    if (!id) return { available: false, records: [] };
    const records = await history.read(getUserDataPath(), id);
    let backupAvailable = false;
    let backupWarning = false;
    try {
      backupAvailable = history.hasLocalBackup
        ? await history.hasLocalBackup(getUserDataPath(), id)
        : false;
    } catch {
      // A damaged optional backup must never hide the primary measurements.
      backupWarning = true;
    }
    if (currentReport(device) !== report) throw backendError('staleDiagnosisData');
    return { available: true, records, backupAvailable, backupWarning };
  });
  register('diagnostics:saveHistory', async (device, reportId) => {
    const report = requireSnapshot(device, reportId);
    const rows = await history.save(
      getUserDataPath(),
      report,
      () => currentReport(device) === report,
      getSettings().autoBackupHistory === true,
    );
    if (currentReport(device) !== report) throw backendError('staleDiagnosisData');
    return rows;
  });
  register('diagnostics:restoreLocalHistory', async (device, reportId) => {
    const report = requireSnapshot(device, reportId);
    const id = history.identity(report.raw);
    if (!id) throw backendError('driveIdentityMissing');
    const records = await history.restoreLocalBackup(
      getUserDataPath(),
      id,
      () => currentReport(device) === report,
    );
    if (currentReport(device) !== report) throw backendError('staleDiagnosisData');
    return { records };
  });
  register('diagnostics:exportHistory', async (device, reportId) => {
    const report = requireSnapshot(device, reportId);
    const id = history.identity(report.raw);
    if (!id) throw backendError('driveIdentityMissing');
    const records = await history.read(getUserDataPath(), id);
    if (currentReport(device) !== report) throw backendError('staleDiagnosisData');
    const result = await showSaveDialog(getMainWindow(), {
      title: getCatalogSection(getSettings().locale, 'dialogs').historyBackup,
      defaultPath: `DriveNX-History-${id.slice(0, 12)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    if (currentReport(device) !== report) throw backendError('staleDiagnosisData');
    await stagedExport(
      result.filePath,
      JSON.stringify(history.exportBackup(id, records), null, 2),
      {
        writeFile,
        renameFile,
        removeFile,
        assertCurrent: () => {
          if (currentReport(device) !== report) throw backendError('staleDiagnosisData');
        },
      },
    );
    return { canceled: false };
  });
  register('diagnostics:importHistory', async (device, reportId) => {
    const report = requireSnapshot(device, reportId);
    const id = history.identity(report.raw);
    if (!id) throw backendError('driveIdentityMissing');
    const result = await showOpenDialog(getMainWindow(), {
      title: getCatalogSection(getSettings().locale, 'dialogs').historyRestore,
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    // The user may have switched devices or rescanned while the picker was open.
    if (currentReport(device) !== report) throw backendError('staleDiagnosisData');
    const backup = await readLimitedJson(result.filePaths[0], 1024 * 1024);
    if (currentReport(device) !== report) throw backendError('staleDiagnosisData');
    const records = await history.importBackup(
      getUserDataPath(),
      id,
      backup,
      () => currentReport(device) === report,
    );
    if (currentReport(device) !== report) throw backendError('staleDiagnosisData');
    return { canceled: false, records };
  });
}
module.exports = { registerHistoryIpc };
