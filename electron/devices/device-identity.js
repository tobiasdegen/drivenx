'use strict';
const { backendError } = require('../security/user-errors.js');
// Reliable SMART identifiers only. Model and capacity can disprove a match,
// but cannot prove identity on their own (e.g. identical USB disks).
function trustworthySerial(value) {
  if (typeof value !== 'string') return null;
  const serial = value.trim();
  if (!serial || serial.length > 128) return null;
  const simplified = serial.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (
    !simplified ||
    /^(unknown|undefined|none|null|na|notavailable|noserial|default|defaultstring|serialnumber|tobefilledbyoem|anonymized|1234567890)$/.test(
      simplified,
    )
  )
    return null;
  if (/^(.)\1{3,}$/.test(simplified)) return null;
  return serial.toUpperCase();
}
function trustworthyWwn(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  // smartctl reports numeric NAA/OUI/ID components for ATA devices.
  const { naa, oui, id } = value;
  if (!Number.isSafeInteger(naa) || !Number.isSafeInteger(oui) || !Number.isSafeInteger(id))
    return null;
  if (naa <= 0 || oui < 0 || id <= 0) return null;
  return `${naa}:${oui}:${id}`;
}
function identify(raw) {
  return {
    serial: trustworthySerial(raw?.serial_number),
    wwn: trustworthyWwn(raw?.wwn),
    model: typeof raw?.model_name === 'string' ? raw.model_name.trim().toUpperCase() : '',
    capacity:
      Number.isSafeInteger(raw?.user_capacity?.bytes) && raw.user_capacity.bytes > 0
        ? raw.user_capacity.bytes
        : null,
  };
}
function assertSameDevice(expectedRaw, actualRaw) {
  const expected = identify(expectedRaw);
  const actual = identify(actualRaw);
  // A reliable identifier must be available in BOTH readings.
  const serialMatch = !!(expected.serial && actual.serial && expected.serial === actual.serial);
  const wwnMatch = !!(expected.wwn && actual.wwn && expected.wwn === actual.wwn);
  if (
    (expected.serial && actual.serial && !serialMatch) ||
    (expected.wwn && actual.wwn && !wwnMatch)
  )
    throw backendError('driveReplaced');
  if (
    (expected.model && actual.model && expected.model !== actual.model) ||
    (expected.capacity !== null &&
      actual.capacity !== null &&
      expected.capacity !== actual.capacity)
  )
    throw backendError('driveMetadataChanged');
  if (!serialMatch && !wwnMatch) throw backendError('driveIdentityUnverifiable');
  return true;
}
module.exports = { identify, assertSameDevice, trustworthySerial, trustworthyWwn };
