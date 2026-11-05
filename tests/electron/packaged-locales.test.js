'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(ELECTRON_SOURCE_DIR, '..');
test('electron-builder explicitly bundles runtime locale JSON files', () => {
  const pkg = require('../../package.json');
  const files = pkg.build?.files;
  assert.ok(Array.isArray(files));
  assert.ok(
    files.includes('locales/**/*'),
    'Release must bundle locales beside electron in app.asar',
  );
  for (const lang of ['de-DE', 'en-US']) {
    assert.ok(fs.statSync(path.join(root, 'locales', `${lang}.json`)).isFile());
    assert.doesNotThrow(() => require(`../../locales/${lang}.json`));
  }
});
