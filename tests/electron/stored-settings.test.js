'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultSettings,
  normalizeStoredSettings,
} = require('../../electron/data/stored-settings.js');

test('stored settings supply independent, predictable defaults', () => {
  assert.deepEqual(normalizeStoredSettings(null), defaultSettings());
  assert.deepEqual(normalizeStoredSettings([]), defaultSettings());
  const one = defaultSettings();
  one.locale = 'en-US';
  assert.equal(defaultSettings().locale, 'en-US');
});

test('stored settings are normalized without retaining unsafe or unrecognized fields', () => {
  const value = normalizeStoredSettings({
    locale: 'en-US',
    theme: 'system',
    attributeMode: 'technical',
    reportMode: 'technical',
    backgroundDetails: true,
    companyName: 'A'.repeat(180),
    companyAddress: 'B'.repeat(760),
    companyContact: 'C'.repeat(300),
    companyLogo: 'data:image/svg+xml;base64,AAAA',
    customBinary: '/tmp/untrusted',
  });
  assert.deepEqual(
    [value.locale, value.theme, value.attributeMode],
    ['en-US', 'system', 'technical'],
  );
  assert.equal(value.backgroundDetails, true);
  assert.equal(value.companyName.length, 150);
  assert.equal(value.companyAddress.length, 700);
  assert.equal(value.companyContact.length, 250);
  assert.equal(value.companyLogo, '');
  assert.equal(Object.hasOwn(value, 'customBinary'), false);
  assert.equal(Object.hasOwn(value, 'reportMode'), false);
});

test('saved logos are accepted only if their existing runtime validator accepts them', () => {
  const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')}`;
  assert.equal(normalizeStoredSettings({ companyLogo: png }).companyLogo, png);
  assert.equal(normalizeStoredSettings({ companyLogo: 'not-an-image' }).companyLogo, '');
});

test('invalid enum values fall back without breaking the stored settings file', () => {
  const v = normalizeStoredSettings({
    locale: 'fr',
    theme: 'invalid',
    attributeMode: 'raw',
    reportMode: 'danger',
    backgroundDetails: 'yes',
  });
  assert.deepEqual(v, defaultSettings());
});

test('first launch follows the operating system language; unsupported languages use English', () => {
  assert.equal(defaultSettings('de-AT').locale, 'de-DE');
  assert.equal(defaultSettings('de-CH').locale, 'de-DE');
  assert.equal(defaultSettings('en-GB').locale, 'en-US');
  assert.equal(defaultSettings('den').locale, 'en-US');
  assert.equal(defaultSettings('fr-FR').locale, 'en-US');
  assert.equal(normalizeStoredSettings({}, 'de-CH').locale, 'de-DE');
  assert.equal(normalizeStoredSettings({ locale: 'en-US' }, 'de-DE').locale, 'en-US');
  assert.equal(normalizeStoredSettings({ locale: 'de' }, 'en-US').locale, 'en-US');
});
