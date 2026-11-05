'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ataDefectEvidence,
  plainAtaCount,
  firstDecimal,
} = require('../../electron/diagnostics/ata-raw.js');

const raw = (string, value) => ({
  raw: { ...(string === undefined ? {} : { string }), ...(value === undefined ? {} : { value }) },
});

test('ATA count: accept only an unambiguous plain decimal value', () => {
  for (const [string, value, count] of [
    ['0', 0, 0],
    ['  19  ', 19, 19],
    ['0007', 7, 7],
    ['4294967295', 4294967295, 4294967295],
  ]) {
    assert.deepEqual(ataDefectEvidence(raw(string, value)), { kind: 'count', count });
    assert.equal(plainAtaCount(raw(string, value)), count);
  }
});
test('ATA packed multi-fields are opaque, even when first component looks numeric', () => {
  for (const string of ['19 (1986 14)', '5; 8', '7:2', '1 2', '2 invalid', '1.5', '1,234']) {
    const result = ataDefectEvidence(raw(string));
    assert.notEqual(result.kind, 'count', string);
    assert.equal(plainAtaCount(raw(string)), null, string);
  }
});
test('ATA oversized, mismatched or unsafe raw values cannot become sector counts', () => {
  for (const item of [
    raw('281470681948207', 281470681948207),
    raw('4294967296'),
    raw('2', 8589934592),
    raw('2', '8589934592'),
    raw('2', 7),
    raw('2', Number.MAX_SAFE_INTEGER + 1),
    raw('2', NaN),
  ]) {
    assert.equal(ataDefectEvidence(item).kind, 'vendor');
    assert.equal(plainAtaCount(item), null);
  }
});
test('ATA unknown representations never fall back to raw.value', () => {
  for (const item of [
    raw(undefined, 3),
    raw('n/a', 3),
    raw('0x0004', 4),
    raw('-3', -3),
    raw('9007199254740992'),
    {},
  ]) {
    assert.deepEqual(ataDefectEvidence(item), { kind: 'unknown' });
    assert.equal(plainAtaCount(item), null);
  }
});
test('firstDecimal stays available for diagnostics but is not a safe counter parser', () => {
  assert.equal(firstDecimal(raw('19 (1986 14)')), 19);
  assert.equal(plainAtaCount(raw('19 (1986 14)')), null);
  assert.equal(firstDecimal(raw(undefined, 19)), null);
});
