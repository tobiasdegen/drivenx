'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, '..', file), 'utf8');

test('history and hardware panels share a request guard for report-bound operations', () => {
  for (const file of [
    'src/components/tabs/HistoryPanel.tsx',
    'src/components/tabs/HostIoPanel.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /createAsyncViewGuard\(\)/);
    assert.match(source, /return \(\) => guard\.invalidate\(\)/);
    assert.match(source, /guard\.isCurrent\(ticket\)/);
  }
  const history = read('src/components/tabs/HistoryPanel.tsx');
  for (const kind of ['save', 'import', 'export']) {
    assert.match(
      history,
      new RegExp(`guard\\.begin\\(['"]${kind}['"],\\s*\\{\\s*exclusive:\\s*true\\s*\\}`),
    );
  }
});

test('refresh removes the previous report from renderer and backend before a new read', () => {
  assert.match(read('src/hooks/useDriveSession.ts'), /delete next\[target\]/);
  assert.match(read('electron/diagnostics/detail-cache.js'), /reports\.delete\(key\)/);
});

test('new view labels and native dialog strings use shared translations', () => {
  const de = require('../../locales/de-DE.json');
  const en = require('../../locales/en-US.json');
  for (const catalog of [de, en]) {
    for (const key of ['historyLoading', 'historyExporting', 'macIoChecking'])
      assert.ok(catalog.smartView[key], key);
    assert.ok(catalog.dialogs.companyLogoFilter);
    assert.ok(catalog.menu.textLegalNotices);
  }
  const main = read('electron/main.js');
  assert.match(main, /getCatalogSection\(locale, 'menu'\)\.textLegalNotices/);
  assert.match(main, /showNativeAbout\(/);
  assert.match(main, /getCatalogSection\(settings\.locale, 'dialogs'\)\.companyLogoFilter/);
});
