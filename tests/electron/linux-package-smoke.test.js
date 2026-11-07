'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  checkLinuxPackage,
  validateDebDependencies,
  REQUIRED_ASAR,
} = require('../../scripts/smoke-linux-package.js');
const { version: APP_VERSION } = require('../../package.json');

function fixture(testCase) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-linux-test-'));
  testCase.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: APP_VERSION }));
  const release = path.join(root, 'release');
  const resources = path.join(release, 'linux-unpacked', 'resources');
  fs.mkdirSync(resources, { recursive: true });
  const files = [
    'app.asar',
    'smartmontools/drivedb.h',
    'smartmontools/COPYING-smartmontools.txt',
    'usb-ids/index.json',
    'usb-ids/LICENSE-BSD-3-Clause.txt',
    'LICENSE.md',
    'DISCLAIMER.md',
    'DISCLAIMER.en.md',
    'LICENSE-THIRD-PARTY.md',
    'licenses/Electron-MIT.txt',
    'licenses/Lucide-ISC-and-Feather-MIT.txt',
    'icon.png',
    'linux-privileged/drivenx-smartctl-helper',
    'linux-privileged/io.drivenx.smartctl.policy',
  ];
  for (const name of files) {
    const file = path.join(resources, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'test');
  }
  fs.writeFileSync(path.join(release, 'linux-unpacked', 'LICENSES.chromium.html'), 'test');
  const asarApi = { listPackage: () => REQUIRED_ASAR };
  return { root, resources, asarApi };
}

test('Linux directory package includes all runtime notices but no other OS binaries', (t) => {
  const { root, asarApi } = fixture(t);
  assert.deepEqual(checkLinuxPackage({ root, target: 'dir', asarApi }), []);
});

test('Linux package refuses foreign macOS/Windows smartctl and usb.ids', (t) => {
  const { root, asarApi, resources } = fixture(t);
  for (const name of ['smartmontools/win32', 'smartmontools/darwin', 'usb-ids/usb.ids']) {
    const file = path.join(resources, name);
    fs.mkdirSync(name.endsWith('.ids') ? path.dirname(file) : file, { recursive: true });
    if (name.endsWith('.ids')) fs.writeFileSync(file, 'test');
  }
  const problems = checkLinuxPackage({ root, target: 'dir', asarApi });
  assert.equal(problems.length, 3);
});

test('Linux artifacts required for full release', (t) => {
  const { root, asarApi } = fixture(t);
  const problems = checkLinuxPackage({ root, target: 'all', asarApi });
  assert.ok(problems.some((problem) => problem.includes('.AppImage')));
  assert.ok(problems.some((problem) => problem.includes('.deb')));
});

test('Linux full release accepts AppImage x86_64 and DEB amd64 artifact names', (t) => {
  const { root, asarApi } = fixture(t);
  const release = path.join(root, 'release');
  const appImage = path.join(release, `DriveNX-${APP_VERSION}-linux-x86_64.AppImage`);
  const deb = path.join(release, `DriveNX-${APP_VERSION}-linux-amd64.deb`);
  fs.writeFileSync(appImage, 'test');
  fs.writeFileSync(deb, 'test');

  assert.deepEqual(checkLinuxPackage({ root, target: 'all', asarApi }), []);
  fs.rmSync(deb);
  assert.ok(
    checkLinuxPackage({ root, target: 'all', asarApi }).some((issue) => issue.includes('.deb')),
  );
});

test('DEB installer installs and removes the restricted helper, with dependencies', () => {
  const project = path.join(ELECTRON_SOURCE_DIR, '..');
  const configuration = require('../../package.json').build;
  assert.equal(configuration.deb.afterInstall, 'scripts/linux-deb-after-install.sh');
  assert.equal(configuration.deb.afterRemove, 'scripts/linux-deb-after-remove.sh');
  assert.equal(configuration.deb.appArmorProfile, 'build/drivenx.apparmor');
  const profile = fs.readFileSync(path.join(project, configuration.deb.appArmorProfile), 'utf8');
  assert.match(profile, /profile drivenx \/opt\/DriveNX\/drivenx flags=\(unconfined\)/);
  assert.match(profile, /\buserns,/);
  const postinst = fs.readFileSync(path.join(project, configuration.deb.afterInstall), 'utf8');
  const postrm = fs.readFileSync(path.join(project, configuration.deb.afterRemove), 'utf8');
  assert.match(postinst, /apparmor_parser --replace/);
  assert.match(postrm, /apparmor_parser --remove/);
  assert.ok(!configuration.deb.depends.includes('default'));
  assert.ok(configuration.deb.depends.includes('pkexec'));
  assert.ok(configuration.deb.depends.includes('python3'));
  for (const file of [configuration.deb.afterInstall, configuration.deb.afterRemove]) {
    assert.ok(fs.existsSync(path.join(project, file)));
  }
});

test('Linux smoke check rejects unknown package targets', (t) => {
  const { root, asarApi } = fixture(t);
  assert.throws(
    () => checkLinuxPackage({ root, target: 'snap', asarApi }),
    /Unbekanntes Linux-Paketziel/,
  );
});

test('Linux smoke CLI refuses mistyped flags before inspecting files', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../../scripts/smoke-linux-package.js'), '--target=snap'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unbekanntes Argument/);
});

test('Linux package rejects duplicate bundled React and smartmontools source', (t) => {
  const { root, resources, asarApi } = fixture(t);
  asarApi.listPackage = () => [...REQUIRED_ASAR, '/node_modules/react/index.js'];
  fs.mkdirSync(path.join(resources, 'smartmontools'), { recursive: true });
  fs.writeFileSync(
    path.join(resources, 'smartmontools', 'smartmontools-7.5-source.tar.gz'),
    'duplicate',
  );
  const issues = checkLinuxPackage({ root, target: 'dir', asarApi }).join('\n');
  assert.match(issues, /Frontend-Abhängigkeit/);
  assert.match(issues, /smartmontools-7.5-source.tar.gz/);
});

test('DEB dependency metadata rejects literal default and missing runtime packages', () => {
  assert.match(
    validateDebDependencies('default, smartmontools, pkexec, python3').join('\n'),
    /default/,
  );
  assert.deepEqual(
    validateDebDependencies(
      'libgtk-3-0t64 | libgtk-3-0, libnotify4, libatspi2.0-0t64 | libatspi2.0-0, smartmontools, pkexec, python3',
    ),
    [],
  );
  assert.match(
    validateDebDependencies('libgtk-3-0t64, libatspi2.0-0t64, pkexec, python3').join('\n'),
    /smartmontools/,
  );
});
