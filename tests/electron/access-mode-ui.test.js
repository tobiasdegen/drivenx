'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, '..', file), 'utf8');

test('one driver configuration entry point in the workspace toolbar, never in the drive list or drive heading', () => {
  const workspace = read('src/components/DriveWorkspace.tsx');
  const sidebar = read('src/components/DriveSidebar.tsx');
  const header = read('src/components/DriveHeader.tsx');
  assert.equal((workspace.match(/<DeviceAccessDialog\b/g) || []).length, 1);
  assert.match(workspace, /header-actions[\s\S]*?<DeviceAccessDialog\b/);
  assert.doesNotMatch(sidebar, /DeviceAccessDialog|scanUsbMode|onScanWithUsbMode/);
  assert.doesNotMatch(header, /DeviceAccessDialog|manual-smartctl-mode/);
});

test('unified dialog separates scan preset and current drive mode without shell-like commands', () => {
  const source = read('src/components/DeviceAccessDialog.tsx');
  assert.match(source, /createPortal\(/);
  assert.match(source, /document\.body/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /onScanMode\(pendingScan\)/);
  assert.match(source, /onDeviceMode\(pendingDevice\)/);
  assert.match(source, /device\s*\?\s*\(\s*<>/);
  assert.match(source, /locked\s*\|\|\s*pendingDevice\s*===\s*device\.type/);
  assert.match(source, /deviceAccessNoSelection/);
  assert.doesNotMatch(source, /child_process|spawn\(|exec\(/);
});

test('both languages have the new centrally managed driver dialog labels', () => {
  const de = require('../../locales/de-DE.json').smartView;
  const en = require('../../locales/en-US.json').smartView;
  for (const key of [
    'deviceAccessTitle',
    'deviceAccessSubtitle',
    'deviceAccessSelectedTitle',
    'deviceAccessNoSelection',
  ]) {
    assert.ok(de[key] && en[key], key);
    assert.notEqual(de[key], en[key]);
  }
});
