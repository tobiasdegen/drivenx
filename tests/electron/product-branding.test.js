'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(ELECTRON_SOURCE_DIR, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('DriveNX product identity is consistent across app metadata and shipped UI', () => {
  const pkg = JSON.parse(source('package.json'));
  const lock = JSON.parse(source('package-lock.json'));
  assert.equal(pkg.name, 'drivenx');
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(pkg.build.appId, 'io.drivenx.app');
  assert.equal(pkg.build.productName, 'DriveNX');
  assert.equal(pkg.build.nsis.shortcutName, 'DriveNX');
  assert.equal(pkg.build.nsis.uninstallDisplayName, 'DriveNX');
  assert.match(source('index.html'), /<title>DriveNX<\/title>/);
  assert.match(source('src/components/DriveSidebar.tsx'), /DriveNX/);
  assert.match(source('electron/ui/native-about.js'), /applicationName: 'DriveNX'/);
  for (const locale of ['de-DE', 'en-US']) {
    const labels = JSON.parse(source(`locales/${locale}.json`));
    assert.match(JSON.stringify(labels), /DriveNX/);
  }
});

test('new identity and portable paths do not break the existing Windows/macOS release targets', () => {
  const pkg = JSON.parse(source('package.json'));
  assert.equal(pkg.build.mac.icon, 'build/icon.icns');
  assert.equal(pkg.build.win.icon, 'build/icon.ico');
  assert.ok(pkg.build.mac.extraResources.some((item) => item.to === 'smartmontools/darwin'));
  assert.ok(pkg.build.win.extraResources.some((item) => item.to === 'smartmontools/win32'));
  assert.ok(fs.existsSync(path.join(root, 'build/icon.icns')));
  assert.ok(fs.existsSync(path.join(root, 'build/icon.ico')));
});
