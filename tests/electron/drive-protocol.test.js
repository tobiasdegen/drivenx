'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('SMART protocol-specific UI does not use ATA-only fallback for NVMe and includes history chart', () => {
  const readPanel = (name) =>
    fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, '../src/components/tabs', name), 'utf8');
  const ui =
    readPanel('ErrorLogPanel.tsx') +
    readPanel('HistoryPanel.tsx') +
    readPanel('AttributesPanel.tsx');
  assert.match(ui, /errorLogUnavailable/);
  assert.match(ui, /errorLogNoRecords/);
  assert.match(ui, /<HistoryChart\s+records=\{historyRows\}/);
  assert.match(ui, /assessmentLabel\(entry.status, locale\)/);
  assert.match(ui, /attribute-table-scroll/);
  const classification = fs.readFileSync(
    path.join(ELECTRON_SOURCE_DIR, '../src/drive-protocol.ts'),
    'utf8',
  );
  const german = require('../../locales/de-DE.json').driveProtocol;
  const english = require('../../locales/en-US.json').driveProtocol;
  assert.match(german.emptyNvme, /Keine NVMe-Fehlerprotokolleinträge gemeldet/);
  assert.match(english.emptyNvme, /No NVMe error log entries reported/);
  assert.match(classification, /translate\(locale, 'driveProtocol'/);
});
