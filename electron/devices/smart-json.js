// @ts-check
'use strict';
// smartctl is an external process. JSON.parse alone is not a trust boundary:
// a valid JSON scalar, a malformed table or a vendor-specific output shape
// must never reach health evaluation or the renderer as a valid measurement.
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * smartctl JSON is vendor-extensible: only the structures used by the UI are
 * validated; unknown vendor fields remain dynamic after this entry boundary.
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function validateSmartctlJson(value) {
  if (!record(value)) throw new Error('smartctl liefert kein JSON-Objekt.');

  // Only fields consumed as objects / arrays by the current application are
  // checked. Unknown vendor extensions are deliberately kept intact.
  for (const key of [
    'smartctl',
    'device',
    'smart_status',
    'ata_smart_attributes',
    'ata_smart_error_log',
    'ata_smart_self_test_log',
    'nvme_smart_health_information_log',
    'nvme_error_information_log',
    'nvme_self_test_log',
    'scsi_error_counter_log',
    'scsi_self_test_log',
  ]) {
    if (value[key] != null && !record(value[key]))
      throw new Error(`smartctl-Datenfeld ungültig: ${key}`);
  }
  if (value.devices != null && (!Array.isArray(value.devices) || !value.devices.every(record)))
    throw new Error('smartctl-Tabelle ungültig: devices');
  const smartctl = value.smartctl;
  if (
    record(smartctl) &&
    smartctl.messages != null &&
    (!Array.isArray(smartctl.messages) || !smartctl.messages.every(record))
  )
    throw new Error('smartctl-Tabelle ungültig: smartctl.messages');
  const nvme = value.nvme_smart_health_information_log;
  const temperatures = record(nvme) ? nvme.temperature_sensors : undefined;
  if (
    temperatures != null &&
    (!Array.isArray(temperatures) ||
      !temperatures.every((n) => typeof n === 'number' && Number.isFinite(n)))
  )
    throw new Error('smartctl-Datenfeld ungültig: temperature_sensors');
  /** @param {unknown} parent @param {string} key @param {string} label @returns {Record<string, unknown> | undefined} */
  function objectAt(parent, key, label) {
    const field = record(parent) ? parent[key] : undefined;
    if (field != null && !record(field)) throw new Error(`smartctl-Datenfeld ungültig: ${label}`);
    return record(field) ? field : undefined;
  }
  /** @param {unknown} parent @param {string} label */
  function tableAt(parent, label) {
    const table = record(parent) ? parent.table : undefined;
    if (table == null) return;
    if (!Array.isArray(table) || !table.every(record))
      throw new Error(`smartctl-Tabelle ungültig: ${label}`);
  }
  tableAt(value.ata_smart_attributes, 'ata_smart_attributes.table');
  const ataErrorSummary = objectAt(
    value.ata_smart_error_log,
    'summary',
    'ata_smart_error_log.summary',
  );
  tableAt(ataErrorSummary, 'ata_smart_error_log.summary.table');
  // -x adds extended ATA logs. Check the same tabular structure without
  // rejecting unknown, vendor-specific fields from smartctl.
  const ataErrorExtended = objectAt(
    value.ata_smart_error_log,
    'extended',
    'ata_smart_error_log.extended',
  );
  tableAt(ataErrorExtended, 'ata_smart_error_log.extended.table');
  const ataTestStandard = objectAt(
    value.ata_smart_self_test_log,
    'standard',
    'ata_smart_self_test_log.standard',
  );
  tableAt(ataTestStandard, 'ata_smart_self_test_log.standard.table');
  const ataTestExtended = objectAt(
    value.ata_smart_self_test_log,
    'extended',
    'ata_smart_self_test_log.extended',
  );
  tableAt(ataTestExtended, 'ata_smart_self_test_log.extended.table');
  tableAt(value.nvme_error_information_log, 'nvme_error_information_log.table');
  tableAt(value.nvme_self_test_log, 'nvme_self_test_log.table');
  const scsiTestStandard = objectAt(
    value.scsi_self_test_log,
    'standard',
    'scsi_self_test_log.standard',
  );
  tableAt(scsiTestStandard, 'scsi_self_test_log.standard.table');
  return value;
}
module.exports = { validateSmartctlJson };
