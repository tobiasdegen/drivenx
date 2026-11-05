'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const de = require('../../locales/de-DE.json');
const en = require('../../locales/en-US.json');

const root = path.join(ELECTRON_SOURCE_DIR, '..', 'src');

function components(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? components(fullPath)
      : entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')
        ? [fullPath]
        : [];
  });
}

// Check static lookups in the same place instead of maintaining overlapping
// inventories in separate SMART-view and translation-coverage test files.
test('literal component translations exist in both supported locales', () => {
  const sectionsSeen = new Set();
  for (const file of components(root)) {
    const source = fs.readFileSync(file, 'utf8');
    const translator = source.match(
      /const\s+tr\s*=.*?translate\(\s*[^,]+,\s*['"](smartView|deviceDetails|preferences)['"],\s*key\s*\)/s,
    );
    const keys = translator
      ? [...source.matchAll(/\btr\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => [
          translator[1],
          match[1],
        ])
      : [];
    const direct = [
      ...source.matchAll(/\btranslate\(\s*locale,\s*['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => [match[1], match[2]]);
    for (const [section, key] of [...keys, ...direct]) {
      sectionsSeen.add(section);
      for (const [locale, catalog] of [
        ['de-DE', de],
        ['en-US', en],
      ]) {
        assert.equal(
          typeof catalog[section]?.[key],
          'string',
          `${locale}.${section}.${key} in ${path.relative(root, file)}`,
        );
        assert.ok(catalog[section][key].trim(), `empty ${locale}.${section}.${key}`);
      }
    }
  }
  assert.deepEqual([...sectionsSeen].sort(), [
    'deviceDetails',
    'diagnosis',
    'preferences',
    'queryLog',
    'smartView',
    'usbConnection',
  ]);
});

test('all renderer source files keep localized language branches in catalogs', () => {
  // Language-dependent literal branches are allowed for Intl locales and
  // language codes, not for visible UI copy. Scan all renderer sources, not
  // only a manually maintained shortlist of components.
  const paired = /\bde\s*\?\s*'([^']*)'\s*:\s*'([^']*)'/g;
  for (const file of components(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pair of source.matchAll(paired)) {
      assert.ok(
        pair[1] === 'de-DE' && pair[2] === 'en-US',
        `${path.relative(root, file)}: translated text belongs in locales/*.json: ${pair[1]}`,
      );
    }
  }
});

test('menu, PDF, USB and query log keys are present and nonempty in both languages', () => {
  const sources = [
    ['ui/app-menu.js', 'menu', /\bt\.([a-zA-Z][a-zA-Z0-9]*)\b/g],
    ['reports/report.js', 'report', /\bt\.([a-zA-Z][a-zA-Z0-9]*)\b/g],
  ];
  for (const [file, section, pattern] of sources) {
    const source = fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, file), 'utf8');
    for (const match of source.matchAll(pattern)) {
      // Report locals also have formatting / array properties; only the
      // localized keys and explicit translated strings are required here.
      if (
        file === 'reports/report.js' &&
        !/^(text[A-Z]|title$|assessment$|notice$|recommend$|details$|findings$|hardware$|tests$|testType$|result$|hours$|missing$|model$|serial$|firmware$|capacity$|connection$|devicePath$|logicalBlock$|physicalBlock$|location$|internal$|external$|removable$|ejectable$|yes$|no$|smart$|passed$|failed$|critical$|warnung$|ok$|unbekannt$|ataWritten$)/.test(
          match[1],
        )
      )
        continue;
      for (const [lang, catalog] of [
        ['de-DE', de],
        ['en-US', en],
      ]) {
        assert.equal(typeof catalog[section][match[1]], 'string', `${lang}.${section}.${match[1]}`);
        assert.ok(catalog[section][match[1]].trim(), `${lang}.${section}.${match[1]}`);
      }
    }
  }
  const query = fs.readFileSync(path.join(root, 'components', 'QueryLogPanel.tsx'), 'utf8');
  for (const [, key] of query.matchAll(/"[a-z-]+":\s*"(mode[A-Z][a-zA-Z]+)"/g)) {
    assert.ok(de.queryLog[key] && en.queryLog[key], `Query mode: ${key}`);
  }
});
