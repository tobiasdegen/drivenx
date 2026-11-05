'use strict';
const { ataDefectEvidence } = require('./ata-raw.js');

// Only an explicitly identified ATA SSD gets these manufacturer-named rules.
// Numeric SMART IDs alone are not stable across drive vendors or device types.
const KNOWN_SSD_COUNTERS = Object.freeze([
  { id: 171, names: ['Program_Fail_Count'], code: 'ssdProgramFailures' },
  { id: 181, names: ['Program_Fail_Cnt_Total', 'Program_Fail_Count'], code: 'ssdProgramFailures' },
  { id: 172, names: ['Erase_Fail_Count'], code: 'ssdEraseFailures' },
  { id: 182, names: ['Erase_Fail_Count_Total', 'Erase_Fail_Count'], code: 'ssdEraseFailures' },
  { id: 179, names: ['Used_Rsvd_Blk_Cnt_Tot'], code: 'ssdReservedBlocksUsed' },
  { id: 183, names: ['Runtime_Bad_Block'], code: 'ssdRuntimeBadBlocks' },
]);

function percent(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
}

function isAtaSsd(raw) {
  return (
    raw?.rotation_rate === 0 &&
    (raw?.device?.protocol === 'ATA' || Array.isArray(raw?.ata_smart_attributes?.table))
  );
}

function ssdFindings(raw) {
  if (!isAtaSsd(raw)) return [];
  const findings = [];
  const add = (level, code, values) => findings.push({ level, code, values });
  const attributes = Array.isArray(raw.ata_smart_attributes?.table)
    ? raw.ata_smart_attributes.table
    : [];
  for (const { id, names, code } of KNOWN_SSD_COUNTERS) {
    const row = attributes.find((item) => item?.id === id && names.includes(item?.name));
    if (!row) continue;
    const interpreted = ataDefectEvidence(row);
    if (interpreted.kind === 'count' && interpreted.count > 0)
      add('warnung', code, { id, count: interpreted.count });
    else if (interpreted.kind === 'vendor' && interpreted.nonzero)
      add('warnung', 'ssdPackedErrorCounter', { id });
  }

  // A named SMART 252 attribute can include historical flash-block information. It is not a count of bad *user sectors* and a
  // standalone raw value does not establish ongoing media failure.
  const flashBlocks = attributes.find(
    (row) => row?.id === 252 && row?.name === 'Added_Bad_Flash_Blk_Ct',
  );
  if (flashBlocks) {
    const value = ataDefectEvidence(flashBlocks);
    if (value.kind === 'count' && value.count > 0)
      add('info', 'ssdFlashBlockHistory', { id: 252, count: value.count });
    else if (value.kind === 'vendor' && value.nonzero)
      add('info', 'ssdPackedFlashBlocks', { id: 252 });
  }

  // These are *device-provided* values, not inferred remaining lifetime.
  const spare = percent(raw?.spare_available?.current_percent);
  const threshold = percent(raw?.spare_available?.threshold_percent);
  if (spare !== null && threshold !== null && spare < threshold)
    add('warnung', 'ssdReserveLow', { spare, threshold });

  // The endurance estimate may legitimately exceed 100% in smartctl JSON.
  const rawUsed = raw?.endurance_used?.current_percent;
  if (Number.isSafeInteger(rawUsed) && rawUsed >= 100)
    add('warnung', 'ssdEnduranceUsed', { used: rawUsed });
  return findings;
}

module.exports = { isAtaSsd, ssdFindings };
