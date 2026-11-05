'use strict';
/** smartmontools remains the authoritative vendor-profile interpreter.
 * Never execute or eval drivedb.h in JavaScript, or turn its presets into
 * arbitrary commands.  The only permitted use is smartctl -B FILE.
 */
const path = require('node:path');
const { verifyFileSync, verifyFileAsync } = require('../security/file-integrity.js');
const DB_SHA256 = '428f9d56357cd35056719e1ef3fe2eff87b5ae7499e7797e0811c38b2dbb7079';
const DB_VERSION = '7.5/6293 2026-09-09';
function driveDatabasePath({
  packaged = false,
  resourcesPath = process.resourcesPath,
  projectRoot = path.resolve(__dirname, '..', '..'),
} = {}) {
  return path.join(
    packaged ? resourcesPath : path.join(projectRoot, 'vendor'),
    'smartmontools',
    'drivedb.h',
  );
}
function verifiedDriveDatabase(options = {}) {
  const file = driveDatabasePath(options);
  return verifyFileSync(file, DB_SHA256, { maxSize: 5 * 1024 * 1024 }) ? file : null;
}
async function verifiedDriveDatabaseAsync(options = {}) {
  const file = driveDatabasePath(options);
  return (await verifyFileAsync(file, DB_SHA256, { maxSize: 5 * 1024 * 1024 })) ? file : null;
}
/** Do not infer numeric units or drive health from a model-family match. */
function driveProfile(report) {
  const ata = Array.isArray(report?.ata_smart_attributes?.table);
  const family = typeof report?.model_family === 'string' ? report.model_family.trim() : '';
  return Object.freeze({
    protocol: report?.nvme_smart_health_information_log
      ? 'NVMe'
      : ata
        ? 'ATA'
        : report?.device?.protocol || 'unknown',
    model: typeof report?.model_name === 'string' ? report.model_name : '',
    firmware: typeof report?.firmware_version === 'string' ? report.firmware_version : '',
    family: family || null,
    databaseMatch:
      typeof report?.in_smartctl_database === 'boolean' ? report.in_smartctl_database : null,
    attributeDefinitions: ata ? 'smartctl' : null,
    rawEncoding: 'vendor-specific',
  });
}
module.exports = {
  DB_SHA256,
  DB_VERSION,
  driveDatabasePath,
  verifiedDriveDatabase,
  verifiedDriveDatabaseAsync,
  driveProfile,
};
