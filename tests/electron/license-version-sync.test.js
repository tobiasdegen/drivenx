'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sync, expectedVersions } = require('../../scripts/sync-third-party-versions.js');

const root = path.resolve(ELECTRON_SOURCE_DIR, '..');

test('current lockfile and shipped third-party version labels agree', () => {
  const versions = expectedVersions(root);
  assert.ok(versions.electron);
  assert.ok(versions['lucide-react']);
  assert.deepEqual(sync(root, { check: true }), []);
});

test('after an Electron update the license versions cannot remain stale', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-license-sync-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temporary, 'electron', 'ui'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'LICENSE-THIRD-PARTY.md'])
    fs.copyFileSync(path.join(root, name), path.join(temporary, name));
  fs.copyFileSync(
    path.join(root, 'electron/ui/license-viewer.js'),
    path.join(temporary, 'electron/ui/license-viewer.js'),
  );
  const lockFile = path.join(temporary, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  // An update may already have installed Electron 45.1.0 (or newer).
  // Always simulate a *different* valid version so this regression stays useful.
  const original = lock.packages['node_modules/electron'].version;
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(original);
  assert.ok(parts, `Unexpected Electron version in lockfile: ${original}`);
  const changedVersion = `${parts[1]}.${parts[2]}.${Number(parts[3]) + 1}`;
  lock.packages['node_modules/electron'].version = changedVersion;
  fs.writeFileSync(lockFile, JSON.stringify(lock));
  assert.throws(() => sync(temporary, { check: true }), /license versions are stale/i);
  const changed = sync(temporary, { check: false });
  assert.equal(changed.length, 2);
  assert.deepEqual(sync(temporary, { check: true }), []);
  assert.match(
    fs.readFileSync(path.join(temporary, 'electron/ui/license-viewer.js'), 'utf8'),
    new RegExp(`Electron ${changedVersion.replace(/\./g, '\\.')} – MIT`),
  );
  assert.match(
    fs.readFileSync(path.join(temporary, 'LICENSE-THIRD-PARTY.md'), 'utf8'),
    new RegExp(`\\| Electron \\(Laufzeit\\)\\s+\\| ${changedVersion.replace(/\./g, '\\.')} `),
  );
});

test('changed dependency ranges without updated lockfile block license release check', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-lock-sync-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temporary, 'electron', 'ui'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'LICENSE-THIRD-PARTY.md'])
    fs.copyFileSync(path.join(root, name), path.join(temporary, name));
  fs.copyFileSync(
    path.join(root, 'electron/ui/license-viewer.js'),
    path.join(temporary, 'electron/ui/license-viewer.js'),
  );
  const pkgFile = path.join(temporary, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  pkg.devDependencies.electron = '^45.1.0';
  fs.writeFileSync(pkgFile, JSON.stringify(pkg));
  assert.throws(() => expectedVersions(temporary), /Lockfile dependency mismatch: electron/);
});
