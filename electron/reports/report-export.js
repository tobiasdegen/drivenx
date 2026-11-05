// @ts-check
'use strict';
/** @typedef {import('../backend-contracts').ReportExportDependencies} ReportExportDependencies */
const { backendError } = require('../security/user-errors.js');
const { stagedExport } = require('./staged-export.js');
const { getCatalogSection } = require('../ui/translator.js');

/** Build an export handler without coupling report generation to IPC registration.
 * @param {ReportExportDependencies} dependencies
 */
function createReportExporter({
  validateRequest,
  assertDevice,
  reports,
  deviceKey,
  showSaveDialog,
  createPdfWindow,
  writeFile,
  renameFile,
  removeFile,
  generateHTML,
  getSettings,
}) {
  /** @param {unknown} device @param {unknown} format @param {unknown} locale @param {unknown} reportId */
  return async function exportReport(device, format, locale = 'de-DE', reportId) {
    const request = validateRequest(device, format, locale, reportId);
    const { format: exportFormat, locale: exportLocale } = request;
    const selected = assertDevice(request.device);
    const report = reports.get(deviceKey(selected));
    if (!report) throw backendError('noCurrentReport');
    if (report.reportId !== request.reportId) {
      throw backendError('staleDisplayedReport');
    }
    // The validated diagnostic snapshot is authoritative for every output.
    // Re-evaluating raw SMART data here could silently diverge from the UI
    // and history when interpretation rules or inputs evolve.
    if (!report.health?.diagnosis || !Array.isArray(report.health.diagnosis.evidence))
      throw backendError('invalidDiagnosisSnapshot');

    const save = await showSaveDialog({
      defaultPath: suggestedFilename(report, exportFormat, exportLocale),
      filters: [{ name: exportFormat.toUpperCase(), extensions: [exportFormat] }],
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    // A refreshed scan must not change the report while the save dialog is open.
    function assertCurrent() {
      if (reports.get(deviceKey(selected)) !== report)
        throw backendError('reportChangedDuringExport');
    }
    assertCurrent();

    /** @param {string | Uint8Array} data */
    const saveSnapshot = (data) =>
      stagedExport(save.filePath, data, { writeFile, renameFile, removeFile, assertCurrent });

    if (exportFormat === 'html') {
      const html = generateHTML(report, exportLocale, getSettings());
      await saveSnapshot(html);
      return { canceled: false, path: save.filePath };
    }
    if (exportFormat === 'json') {
      await saveSnapshot(JSON.stringify(report.raw, null, 2));
      return { canceled: false, path: save.filePath };
    }

    const window = createPdfWindow();
    try {
      const html = generateHTML(report, exportLocale, getSettings());
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await window.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        preferCSSPageSize: true,
      });
      // Rendering the PDF is asynchronous. A rescan or refresh may revoke
      // the report while Chromium is producing it: never save stale output.
      assertCurrent();
      await saveSnapshot(pdf);
      return { canceled: false, path: save.filePath };
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  };
}

/** @param {import('../backend-contracts').Report} data @param {'pdf'|'json'|'html'} format @param {string} [locale] */
function suggestedFilename(data, format, locale = 'en-US') {
  /** @param {unknown} value */
  const safe = (value) =>
    String(value || getCatalogSection(locale, 'report').unknownPlaceholder)
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 75);
  const rawDate = new Date(data.capturedAt || Date.now());
  const date = Number.isNaN(rawDate.getTime()) ? new Date() : rawDate;
  const stamp =
    date.getFullYear() +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0') +
    '_' +
    String(date.getHours()).padStart(2, '0') +
    String(date.getMinutes()).padStart(2, '0');
  return `DriveNX_${safe(data.raw?.model_name)}_${safe(data.raw?.serial_number || data.device?.name)}_${stamp}.${format}`;
}

module.exports = { createReportExporter, suggestedFilename };
