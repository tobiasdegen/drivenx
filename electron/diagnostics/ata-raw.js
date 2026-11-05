'use strict';
// One conservative interpretation for ATA raw *defect* and cycle counters.
// smartctl raw.value can be a vendor-packed field. Never infer a sector count
// from the leading component of a formatted/multi-field raw.string.
const MAX_PLAIN_ATA_COUNTER = 0xffffffff;
function firstDecimal(attribute) {
  const rawString = attribute?.raw?.string;
  if (typeof rawString !== 'string') return null;
  const match = rawString.match(/^\s*(\d+)(?:\s|$)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function ataDefectEvidence(attribute) {
  const string = attribute?.raw?.string;
  if (typeof string !== 'string') return { kind: 'unknown' };
  const leading = firstDecimal(attribute);
  if (leading === null) return { kind: 'unknown' };
  const rawValue = attribute.raw.value;
  const plain = /^\s*\d+\s*$/.test(string);
  // A >32-bit raw counter can represent packed fields even when smartctl
  // displays just a decimal string. Treat it conservatively as vendor data.
  const parsedRawValue =
    typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string' && /^\d+$/.test(rawValue.trim())
        ? Number(rawValue.trim())
        : null;
  const mismatch =
    rawValue !== undefined &&
    (parsedRawValue === null ||
      !Number.isSafeInteger(parsedRawValue) ||
      parsedRawValue !== leading);
  const packed = !plain || leading > MAX_PLAIN_ATA_COUNTER || mismatch;
  return packed ? { kind: 'vendor', nonzero: leading > 0 } : { kind: 'count', count: leading };
}
function plainAtaCount(attribute) {
  const evidence = ataDefectEvidence(attribute);
  return evidence.kind === 'count' ? evidence.count : null;
}
module.exports = { firstDecimal, ataDefectEvidence, plainAtaCount };
