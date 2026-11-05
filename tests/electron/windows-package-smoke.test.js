'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkWindowsPackage, REQUIRED_ASAR } = require('../../scripts/smoke-windows-package.js');
const { version: APP_VERSION } = require('../../package.json');

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-package-'));
  try {
    const resources = path.join(root, 'release', 'win-unpacked', 'resources');
    fs.mkdirSync(path.join(resources, 'smartmontools', 'win32'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: APP_VERSION }));
    fs.mkdirSync(path.join(resources, 'usb-ids'), { recursive: true });
    fs.mkdirSync(path.join(resources, 'licenses'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'release', 'win-unpacked', 'LICENSES.chromium.html'),
      'electron chromium notices',
    );
    for (const file of [
      'app.asar',
      'usb-ids/index.json',
      'usb-ids/LICENSE-BSD-3-Clause.txt',
      'LICENSE-THIRD-PARTY.md',
      'LICENSE.md',
      'DISCLAIMER.md',
      'DISCLAIMER.en.md',
      'licenses/Electron-MIT.txt',
      'licenses/Lucide-ISC-and-Feather-MIT.txt',
      'icon.png',
      'smartmontools/win32/smartctl.exe',
      'smartmontools/drivedb.h',
      'smartmontools/COPYING-smartmontools.txt',
      'smartmontools/smartmontools-7.5-source.tar.gz',
    ]) {
      fs.writeFileSync(path.join(resources, file), 'fixture');
    }
    const asarApi = {
      listPackage: () => REQUIRED_ASAR.map((f) => '/' + f),
      extractFile: () => Buffer.from('{"key":"value"}'),
    };
    fn({ root, resources, asarApi });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('valid unpacked package passes with packaged locales and binary', () =>
  fixture(({ root, asarApi }) => {
    assert.deepEqual(checkWindowsPackage({ root, target: 'dir', asarApi }), []);
  }));

test('missing locale is detected inside app.asar', () =>
  fixture(({ root, asarApi }) => {
    asarApi.listPackage = () =>
      REQUIRED_ASAR.filter((f) => f !== 'locales/de-DE.json').map((f) => '/' + f);
    assert.match(
      checkWindowsPackage({ root, target: 'dir', asarApi }).join('\n'),
      /locales\/de-DE.json/,
    );
  }));

test('missing smartctl and invalid locale JSON fail', () =>
  fixture(({ root, resources, asarApi }) => {
    fs.unlinkSync(path.join(resources, 'smartmontools/win32/smartctl.exe'));
    asarApi.extractFile = () => Buffer.from('not-json');
    const result = checkWindowsPackage({ root, target: 'dir', asarApi }).join('\n');
    assert.match(result, /smartctl.exe/);
    assert.match(result, /kein gültiges JSON/);
  }));

test('installer and portable file names are both verified', () =>
  fixture(({ root, asarApi }) => {
    const problems = checkWindowsPackage({ root, target: 'all', asarApi }).join('\n');
    assert.ok(problems.includes(`DriveNX-Setup-${APP_VERSION}-x64.exe`));
    assert.ok(problems.includes(`DriveNX-Portable-${APP_VERSION}-x64.exe`));
  }));

test('missing smartmontools license and source archive are flagged before distribution', () =>
  fixture(({ root, resources, asarApi }) => {
    fs.unlinkSync(path.join(resources, 'smartmontools/COPYING-smartmontools.txt'));
    fs.unlinkSync(path.join(resources, 'smartmontools/smartmontools-7.5-source.tar.gz'));
    const problems = checkWindowsPackage({ root, target: 'dir', asarApi }).join('\n');
    assert.match(problems, /smartmontools-Lizenztext/);
    assert.match(problems, /smartmontools-Quellarchiv/);
  }));

test('packaged app must include derived USB-ID index and BSD license', () =>
  fixture(({ root, resources, asarApi }) => {
    fs.unlinkSync(path.join(resources, 'usb-ids/index.json'));
    fs.unlinkSync(path.join(resources, 'usb-ids/LICENSE-BSD-3-Clause.txt'));
    const issues = checkWindowsPackage({ root, target: 'dir', asarApi }).join('\n');
    assert.match(issues, /USB-ID-Index/);
    assert.match(issues, /USB-ID-Lizenztext/);
  }));

test('Windows package rejects original usb.ids input from the developer workspace', () =>
  fixture(({ root, resources, asarApi }) => {
    fs.writeFileSync(path.join(resources, 'usb-ids/usb.ids'), 'unnecessary raw data');
    assert.match(
      checkWindowsPackage({ root, target: 'dir', asarApi }).join('\n'),
      /unnötige USB-ID-Quelldatei/,
    );
  }));

test('MIT license is an external resource and need not be duplicated in app.asar', () =>
  fixture(({ root, asarApi }) => {
    assert.equal(REQUIRED_ASAR.includes('LICENSE.md'), false);
    assert.equal(REQUIRED_ASAR.includes('LICENSE.en.md'), false);
    assert.deepEqual(checkWindowsPackage({ root, target: 'dir', asarApi }), []);
  }));

test('missing packaged diagnostic disclaimers are detected', () =>
  fixture(({ root, resources, asarApi }) => {
    fs.unlinkSync(path.join(resources, 'DISCLAIMER.md'));
    fs.unlinkSync(path.join(resources, 'DISCLAIMER.en.md'));
    const result = checkWindowsPackage({ root, target: 'dir', asarApi }).join('\n');
    assert.match(result, /DISCLAIMER.md/);
    assert.match(result, /DISCLAIMER.en.md/);
  }));

test('Windows package rejects bundled macOS smartctl', () =>
  fixture(({ root, resources, asarApi }) => {
    const foreign = path.join(resources, 'smartmontools', 'darwin');
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'smartctl'), 'foreign platform binary');
    const problems = checkWindowsPackage({ root, target: 'dir', asarApi }).join('\n');
    assert.match(problems, /macOS-smartctl-Ressourcen/);
  }));

test('Windows package rejects duplicated frontend libraries inside ASAR', () =>
  fixture(({ root, asarApi }) => {
    asarApi.listPackage = () => [...REQUIRED_ASAR, 'node_modules/react-dom/client.js'];
    assert.match(
      checkWindowsPackage({ root, target: 'dir', asarApi }).join('\n'),
      /Frontend-Abhängigkeit.*react-dom/,
    );
  }));
