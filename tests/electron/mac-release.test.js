'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { checkMacSmartctl } = require('../../scripts/check-mac-smartctl.js');
const root = path.resolve(ELECTRON_SOURCE_DIR, '..');
test('macOS release permits verified ARM64 smartctl', () => {
  assert.match(checkMacSmartctl({ root, arch: 'arm64' }), /smartctl$/);
});
test('macOS release refuses Intel target without approved binary', () => {
  assert.throws(() => checkMacSmartctl({ root, arch: 'x64' }), /nur ein geprüftes ARM64/);
});

const fs = require('node:fs');
const os = require('node:os');
const afterPack = require('../../scripts/after-pack.js');

test(
  'macOS release rejects a correct binary with missing executable bits',
  { skip: process.platform === 'win32' },
  (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-mac-mode-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const src = path.join(root, 'vendor', 'smartmontools', 'darwin', 'smartctl');
    const destDir = path.join(tmp, 'vendor', 'smartmontools', 'darwin');
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, 'smartctl');
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o644);
    assert.throws(() => checkMacSmartctl({ root: tmp, arch: 'arm64' }), /nicht ausführbar/);
    fs.chmodSync(dest, 0o755);
    assert.equal(checkMacSmartctl({ root: tmp, arch: 'arm64' }), dest);
  },
);

test(
  'macOS afterPack restores executable permissions in app resources',
  { skip: process.platform === 'win32' },
  async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-mac-pack-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const destDir = path.join(
      tmp,
      'DriveNX.app',
      'Contents',
      'Resources',
      'smartmontools',
      'darwin',
    );
    fs.mkdirSync(destDir, { recursive: true });
    const binary = path.join(destDir, 'smartctl');
    fs.copyFileSync(path.join(root, 'vendor', 'smartmontools', 'darwin', 'smartctl'), binary);
    fs.chmodSync(binary, 0o644);
    const licensesDir = path.join(tmp, 'DriveNX.app', 'Contents', 'Resources');
    fs.mkdirSync(licensesDir, { recursive: true });
    fs.writeFileSync(path.join(licensesDir, 'LICENSES.chromium.html'), 'Electron runtime licenses');
    fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(licensesDir, 'icon.png'));
    for (const filename of [
      'LICENSE.md',
      'DISCLAIMER.md',
      'DISCLAIMER.en.md',
      'LICENSE-THIRD-PARTY.md',
      'licenses/Electron-MIT.txt',
      'licenses/Lucide-ISC-and-Feather-MIT.txt',
      'smartmontools/COPYING-smartmontools.txt',
      'smartmontools/smartmontools-7.5-source.tar.gz',
      'usb-ids/index.json',
      'usb-ids/LICENSE-BSD-3-Clause.txt',
    ]) {
      const target = path.join(licensesDir, filename);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'test notice');
    }
    await afterPack({
      electronPlatformName: 'darwin',
      arch: 3,
      appOutDir: tmp,
      packager: { appInfo: { productFilename: 'DriveNX' } },
    });
    assert.equal(fs.statSync(binary).mode & 0o777, 0o755);
  },
);

test('afterPack leaves non-macOS releases untouched', async () => {
  await assert.doesNotReject(afterPack({ electronPlatformName: 'win32' }));
});

test('macOS afterPack rejects Intel target before touching bundled ARM64 binary', async () => {
  await assert.rejects(afterPack({ electronPlatformName: 'darwin', arch: 1 }), /nur für ARM64/);
});

test('macOS afterPack rejects a missing mandatory diagnostic disclaimer', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-mac-legal-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const resources = path.join(tmp, 'DriveNX.app', 'Contents', 'Resources');
  fs.mkdirSync(path.join(resources, 'smartmontools', 'darwin'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'vendor', 'smartmontools', 'darwin', 'smartctl'),
    path.join(resources, 'smartmontools', 'darwin', 'smartctl'),
  );
  fs.writeFileSync(path.join(resources, 'LICENSES.chromium.html'), 'notices');
  fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(resources, 'icon.png'));
  await assert.rejects(
    afterPack({
      electronPlatformName: 'darwin',
      arch: 3,
      appOutDir: tmp,
      packager: { appInfo: { productFilename: 'DriveNX' } },
    }),
    /Lizenzressource fehlt/,
  );
});

test('macOS afterPack refuses bundled Windows smartctl', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-mac-cross-platform-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const resources = path.join(tmp, 'DriveNX.app', 'Contents', 'Resources');
  const bin = path.join(resources, 'smartmontools', 'darwin', 'smartctl');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.copyFileSync(path.join(root, 'vendor', 'smartmontools', 'darwin', 'smartctl'), bin);
  fs.writeFileSync(path.join(resources, 'LICENSES.chromium.html'), 'notices');
  const other = path.join(resources, 'smartmontools', 'win32');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'smartctl.exe'), 'wrong platform');
  await assert.rejects(
    afterPack({
      electronPlatformName: 'darwin',
      arch: 3,
      appOutDir: tmp,
      packager: { appInfo: { productFilename: 'DriveNX' } },
    }),
    /Windows-smartctl-Ressourcen/,
  );
});

test('macOS afterPack rejects raw USB-ID input and missing About icon', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-mac-usb-clean-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const resources = path.join(tmp, 'DriveNX.app', 'Contents', 'Resources');
  const binary = path.join(resources, 'smartmontools', 'darwin', 'smartctl');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.copyFileSync(path.join(root, 'vendor', 'smartmontools', 'darwin', 'smartctl'), binary);
  fs.writeFileSync(path.join(resources, 'LICENSES.chromium.html'), 'notices');
  const files = [
    'LICENSE.md',
    'DISCLAIMER.md',
    'DISCLAIMER.en.md',
    'LICENSE-THIRD-PARTY.md',
    'licenses/Electron-MIT.txt',
    'licenses/Lucide-ISC-and-Feather-MIT.txt',
    'smartmontools/COPYING-smartmontools.txt',
    'smartmontools/smartmontools-7.5-source.tar.gz',
    'usb-ids/index.json',
    'usb-ids/LICENSE-BSD-3-Clause.txt',
  ];
  for (const name of files) {
    const destination = path.join(resources, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, 'fixture');
  }
  const context = {
    electronPlatformName: 'darwin',
    arch: 3,
    appOutDir: tmp,
    packager: { appInfo: { productFilename: 'DriveNX' } },
  };
  fs.writeFileSync(path.join(resources, 'usb-ids', 'usb.ids'), 'raw data');
  await assert.rejects(afterPack(context), /USB-ID-Quelldatei/);
  fs.unlinkSync(path.join(resources, 'usb-ids', 'usb.ids'));
  fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(resources, 'icon.png'));
  await assert.doesNotReject(afterPack(context));
  fs.unlinkSync(path.join(resources, 'icon.png'));
  await assert.rejects(afterPack(context), /PNG-App-Icon/);
});
