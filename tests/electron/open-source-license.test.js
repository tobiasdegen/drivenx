'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(ELECTRON_SOURCE_DIR, '..');
const pkg = require('../../package.json');
const sourceLicense = fs.readFileSync(path.join(root, 'LICENSE.md'), 'utf8');

test('DriveNX is MIT-licensed under its independent maintainer', () => {
  assert.equal(pkg.name, 'drivenx');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.author, 'Tobias Degen');
  assert.equal(pkg.private, true); // Do not publish this Electron application to npm accidentally.
  assert.match(sourceLicense, /^MIT License\n/);
  assert.match(sourceLicense, /Copyright \(c\) 2026 Tobias Degen/);
  assert.match(sourceLicense, /Permission is hereby granted, free of charge/);
  assert.match(
    sourceLicense,
    /The above copyright notice and this permission notice shall be included/,
  );
  assert.match(sourceLicense, /THE SOFTWARE IS PROVIDED "AS IS"/);
});

test('Open-source legal notices and third-party licenses are independent', () => {
  const notices = fs.readFileSync(path.join(root, 'LICENSE-THIRD-PARTY.md'), 'utf8');
  const about = fs.readFileSync(path.join(root, 'electron/ui/native-about.js'), 'utf8');
  assert.match(notices, /\*\*MIT-Lizenz\*\*/);
  assert.match(notices, /GPL/);
  assert.match(notices, /BSD-3-Clause/);
  assert.doesNotMatch(notices, /proprietären Lizenz|proprietary license/);
  assert.match(about, /getCatalogSection\(locale, 'about'\)/);
  assert.match(require('../../locales/en-US.json').about.credits, /MIT License/);
  assert.doesNotMatch(about, /All rights reserved|Alle Rechte vorbehalten/);
});

test('A single canonical MIT license is packaged with no redundant translation', () => {
  const resources = pkg.build.extraResources;
  assert.ok(
    resources.some((resource) => resource.from === 'LICENSE.md' && resource.to === 'LICENSE.md'),
  );
  assert.ok(!resources.some((resource) => resource.from === 'LICENSE.en.md'));
  assert.equal(fs.existsSync(path.join(root, 'LICENSE.en.md')), false);
});
