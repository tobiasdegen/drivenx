// @ts-check
'use strict';
/** @typedef {import('../backend-contracts').QueryLogIpcDependencies} QueryLogIpcDependencies */
const { backendError } = require('../security/user-errors.js');
const { getCatalogSection } = require('../ui/translator.js');
const { stagedExport } = require('../reports/staged-export.js');

/** Query log IPC, using the main process's existing sender authorization.
 * @param {QueryLogIpcDependencies} dependencies
 */
function registerQueryLogIpc({
  register,
  queryLog,
  exportIndividual,
  getSettings,
  getDialogOwner,
  showSaveDialog,
  writeFile,
  renameFile,
  removeFile,
}) {
  register('diagnostics:queryLogAppearance', async () => ({
    locale: getSettings().locale,
    theme: getSettings().theme,
  }));
  register('diagnostics:queryLog', async () => queryLog.entries());
  register('diagnostics:queryLogResult', async (id) => queryLog.result(id));
  register('diagnostics:saveQueryLogResult', async (id) => {
    const exportData = exportIndividual(queryLog, id);
    if (!exportData) throw backendError('queryResultUnavailable');
    const result = await showSaveDialog(getDialogOwner(), {
      title: getCatalogSection(getSettings().locale, 'dialogs').saveQueryResult,
      defaultPath: exportData.filename,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    // A cleared/pruned/modified result must never overwrite an existing export.
    const assertCurrent = () => {
      const current = exportIndividual(queryLog, id);
      if (!current || current.body !== exportData.body || current.filename !== exportData.filename)
        throw backendError('queryResultUnavailable');
    };
    assertCurrent();
    await stagedExport(result.filePath, exportData.body, {
      writeFile,
      renameFile,
      removeFile,
      assertCurrent,
    });
    return { canceled: false };
  });
  register('diagnostics:clearQueryLog', async () => {
    queryLog.clear();
    return true;
  });
  register('diagnostics:exportQueryLog', async (includeRaw = false) => {
    if (typeof includeRaw !== 'boolean') throw backendError('invalidQueryExportMode');
    const result = await showSaveDialog(getDialogOwner(), {
      title: getCatalogSection(getSettings().locale, 'dialogs').saveQueryLog,
      defaultPath: `DriveNX-Queries-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const revision = queryLog.clearRevision?.();
    const body = JSON.stringify(
      {
        app: 'DriveNX',
        exportedAt: new Date().toISOString(),
        includesRaw: includeRaw,
        entries: queryLog.exportEntries(includeRaw),
      },
      null,
      2,
    );
    // The complete log is a snapshot taken after the dialog; later queries
    // should not mutate the serialized JSON while it is being written.
    await stagedExport(result.filePath, body, {
      writeFile,
      renameFile,
      removeFile,
      assertCurrent: () => {
        if (revision !== undefined && revision !== queryLog.clearRevision?.())
          throw backendError('queryResultUnavailable');
      },
    });
    return { canceled: false };
  });
}
module.exports = { registerQueryLogIpc };
