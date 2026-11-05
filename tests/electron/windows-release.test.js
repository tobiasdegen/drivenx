'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(ELECTRON_SOURCE_DIR, '..');
const pkg = require(path.join(root, 'package.json'));

test('packaged Windows application requests Administrator privileges', () => {
  assert.equal(pkg.build.win.requestedExecutionLevel, 'requireAdministrator');
  assert.equal(pkg.build.portable.requestExecutionLevel, 'admin');
});

test('Windows helper is absent from source and bundle configuration', () => {
  assert.equal(fs.existsSync(path.join(root, 'helper', 'windows-smart-helper.ps1')), false);
  assert.equal(fs.existsSync(path.join(ELECTRON_SOURCE_DIR, 'windows-helper-session.js')), false);
  assert.equal(
    pkg.build.extraResources.some((x) => /helper/i.test(x.from + x.to)),
    false,
  );
  const main = fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, 'main.js'), 'utf8');
  assert.doesNotMatch(
    main,
    /configureWindowsHelper|createWindowsHelperSession|setPrivilegedRunner/,
  );
});
