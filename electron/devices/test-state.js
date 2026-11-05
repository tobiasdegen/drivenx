'use strict';
// Starting a test is transient. The device's SMART data is authoritative for progress.
function selfTestRunning(raw) {
  const nv = raw?.nvme_self_test_log?.current_self_test_operation;
  if (nv && typeof nv.value === 'number') return nv.value !== 0;
  const ata = raw?.ata_smart_data?.self_test?.status;
  if (ata && typeof ata.value === 'number') return (ata.value & 0xf0) === 0xf0;
  const scsi = raw?.scsi_self_test_log?.current_self_test_operation;
  if (scsi && typeof scsi.value === 'number') return scsi.value !== 0;
  return false;
}
module.exports = { selfTestRunning };
