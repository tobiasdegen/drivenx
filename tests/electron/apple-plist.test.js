'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseApplePlist } = require('../../electron/platform/apple-plist.js');

test('plist parser handles nested real diskutil values without external dependencies', () => {
  const value =
    parseApplePlist(`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0">
  <dict><key>WholeDisks</key><array><string>disk0</string><string>disk4</string></array>
  <key>Size</key><integer>320072933376</integer><key>Internal</key><false/>
  <key>Empty</key><string/><key>Description</key><string>USB &amp; SATA &#x2F; Bridge</string>
  <key>Options</key><dict><key>enabled</key><true/></dict></dict></plist>`);
  assert.deepEqual(value.WholeDisks, ['disk0', 'disk4']);
  assert.equal(value.Size, 320072933376);
  assert.equal(value.Internal, false);
  assert.equal(value.Empty, '');
  assert.equal(value.Description, 'USB & SATA / Bridge');
  assert.equal(value.Options.enabled, true);
});
test('plist parser rejects unknown entities, broken nesting, runaway or oversized structures', () => {
  assert.throws(
    () => parseApplePlist('<dict><key>A</key><string>&secret;</string></dict>'),
    /XML-Entität/,
  );
  assert.throws(() => parseApplePlist('<dict><key>A</key><string>oops</dict>'), /PLIST/);
  assert.throws(() => parseApplePlist('<!ENTITY test "value"><dict/>'), /XML-Konstrukt/);
  assert.throws(
    () => parseApplePlist('<array>' + '<array>'.repeat(40) + '</array>'.repeat(41)),
    /tief/,
  );
  assert.throws(() => parseApplePlist('x'.repeat(4 * 1024 * 1024 + 1)), /zu groß/);
});
test('plist parser avoids prototype pollution from unexpected dictionary keys', () => {
  const value = parseApplePlist(
    '<dict><key>__proto__</key><dict><key>compromised</key><true/></dict></dict>',
  );
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal({}.compromised, undefined);
  assert.equal(value.__proto__.compromised, true);
});
