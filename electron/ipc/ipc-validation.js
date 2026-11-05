// @ts-check
'use strict';
const { backendError } = require('../security/user-errors.js');
const { MAX_DEVICE_NAME_LENGTH, MAX_DEVICE_TYPE_LENGTH } = require('../../shared/device-limits.js');
// Validate untrusted structured-clone payloads before entering device operations.
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {unknown} value @returns {{name: string; type: string}} */
function device(value) {
  if (!record(value) || typeof value.name !== 'string' || typeof value.type !== 'string')
    throw backendError('invalidDeviceSelection');
  if (value.name.length > MAX_DEVICE_NAME_LENGTH || value.type.length > MAX_DEVICE_TYPE_LENGTH)
    throw backendError('deviceIdentifierTooLong');
  return { name: value.name, type: value.type };
}
/** @param {unknown} v @param {number} max @returns {string} */
function smallText(v, max) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > max) throw backendError('invalidCompanyData');
  return v.trim();
}
// The <img> renderer only accepts actual PNG/JPEG content. Enforce the
// decoded 1 MiB limit, not an approximate base64 character limit.
const MAX_LOGO_BYTES = 1024 * 1024;
/** @param {unknown} value @returns {string} */
function validatedLogo(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw backendError('invalidCompanyLogo');
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > Math.ceil(MAX_LOGO_BYTES / 3) * 4)
    throw backendError('logoFormatOrSize');
  const content = Buffer.from(match[2], 'base64');
  // Buffer.from(base64) tolerates some illegal padding. Canonical round-trip
  // makes sure malformed data is not silently accepted.
  if (!content.length || content.length > MAX_LOGO_BYTES || content.toString('base64') !== match[2])
    throw backendError('logoFormatOrSize');
  const png =
    content.length >= 8 &&
    content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    content.length >= 3 && content[0] === 255 && content[1] === 216 && content[2] === 255;
  if ((match[1] === 'png' && !png) || (match[1] === 'jpeg' && !jpeg))
    throw backendError('logoSignatureMismatch');
  return value;
}
/** @param {unknown} value */
function settings(value) {
  if (!record(value)) throw backendError('invalidSettings');
  if (
    (value.locale !== 'de-DE' && value.locale !== 'en-US') ||
    (value.theme !== 'light' && value.theme !== 'dark' && value.theme !== 'system') ||
    (value.attributeMode !== 'friendly' && value.attributeMode !== 'technical')
  )
    throw backendError('invalidSettingsValues');
  if (value.backgroundDetails !== undefined && typeof value.backgroundDetails !== 'boolean')
    throw backendError('invalidBackgroundSettings');
  if (value.autoSaveHistory !== undefined && typeof value.autoSaveHistory !== 'boolean')
    throw backendError('invalidAutoHistorySettings');
  if (value.autoBackupHistory !== undefined && typeof value.autoBackupHistory !== 'boolean')
    throw backendError('invalidAutoHistorySettings');
  const companyName = smallText(value.companyName, 150),
    companyAddress = smallText(value.companyAddress, 700),
    companyContact = smallText(value.companyContact, 250);
  const companyLogo = validatedLogo(value.companyLogo);
  return {
    backgroundDetails: value.backgroundDetails === true,
    autoSaveHistory: value.autoSaveHistory === true,
    autoBackupHistory: value.autoBackupHistory === true,
    locale: value.locale,
    theme: value.theme,
    attributeMode: value.attributeMode,
    companyName,
    companyAddress,
    companyContact,
    companyLogo,
  };
}
/** @param {unknown} value @returns {string} */
function reportIdToken(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw backendError('invalidReportId');
  return value;
}
/** @param {unknown} data @param {unknown} kind @param {unknown} reportId */
function testRequest(data, kind, reportId) {
  return { device: device(data), kind: testKind(kind), reportId: reportIdToken(reportId) };
}
/** @param {unknown} data @param {unknown} format @param {unknown} locale @param {unknown} reportId */
function exportRequest(data, format, locale, reportId) {
  if (
    (format !== 'pdf' && format !== 'json' && format !== 'html') ||
    (locale !== 'de-DE' && locale !== 'en-US')
  )
    throw backendError('invalidExportFormat');
  return { device: device(data), format, locale, reportId: reportIdToken(reportId) };
}
/** @param {unknown} kind @returns {'short'|'long'} */
function testKind(kind) {
  if (kind !== 'short' && kind !== 'long') throw backendError('invalidSelfTestKind');
  return kind;
}
module.exports = {
  device,
  settings,
  exportRequest,
  testRequest,
  testKind,
  validatedLogo,
  reportIdToken,
};
