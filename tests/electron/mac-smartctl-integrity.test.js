'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  verifyPackagedMacSmartctl,
  macBinaryInfo,
  olderVersion,
  macBundleForResources,
} = require('../../electron/platform/mac-smartctl-integrity.js');
const { smokeMacPackage } = require('../../scripts/smoke-mac-package.js');
const source = path.resolve(ELECTRON_SOURCE_DIR, '../vendor/smartmontools/darwin/smartctl');
function testBundle(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-mac-sign-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'release', 'mac-arm64', 'DriveNX.app');
  const resourcesPath = path.join(bundle, 'Contents', 'Resources');
  const file = path.join(resourcesPath, 'smartmontools', 'darwin', 'smartctl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(source, file);
  fs.chmodSync(file, 0o755);
  fs.writeFileSync(path.join(resourcesPath, 'app.asar'), 'test');
  fs.copyFileSync(
    path.resolve(__dirname, '../../build/icon.png'),
    path.join(resourcesPath, 'icon.png'),
  );
  const usbDir = path.join(resourcesPath, 'usb-ids');
  fs.mkdirSync(usbDir, { recursive: true });
  fs.writeFileSync(path.join(usbDir, 'index.json'), '{}');
  fs.writeFileSync(path.join(usbDir, 'LICENSE-BSD-3-Clause.txt'), 'BSD-3-Clause');
  const asarApi = {
    listPackage: () => [
      'package.json',
      'electron/main.js',
      'electron/preload.js',
      'locales/de-DE.json',
      'locales/en-US.json',
      'dist/index.html',
    ],
  };
  return { root, bundle, resourcesPath, file, asarApi };
}
test('Mach-O metadata identifies real shipped ARM64 executable and minimum OS', async () => {
  const info = await macBinaryInfo(source);
  assert.equal(info.arm64, true);
  assert.equal(info.minimum, '15.0.0');
  assert.equal(olderVersion('12.6', '13.0.0'), true);
  assert.equal(olderVersion('14.0', '13.0.0'), false);
  assert.equal(await macBinaryInfo('/not/there'), null);
});
test(
  'macOS integrity rejects non-executable smartctl on POSIX hosts',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { file, resourcesPath } = testBundle(t);
    fs.chmodSync(file, 0o644);
    const result = await verifyPackagedMacSmartctl(file, { resourcesPath, hostVersion: '99.0' });
    assert.equal(result.ok, false);
    assert.equal(result.reasonKey, 'notExecutable');
  },
);

test('unmodified macOS smartctl is trusted by pinned SHA, even without app signature', async (t) => {
  const { file, resourcesPath } = testBundle(t);
  const result = await verifyPackagedMacSmartctl(file, {
    resourcesPath,
    hostVersion: '99.0',
    verifySignature: async () => {
      throw new Error('must not be called');
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'vendor-sha256');
});
test('re-signed smartctl requires valid signature on binary AND surrounding app', async (t) => {
  const { bundle, file, resourcesPath } = testBundle(t);
  // A byte changed in the code signature payload (last byte) simulates re-signing.
  const fd = fs.openSync(file, 'r+');
  fs.writeSync(fd, Buffer.from([0xa7]), 0, 1, fs.statSync(file).size - 1);
  fs.closeSync(fd);
  const calls = [];
  const verifySignature = async (command, args) => {
    calls.push([command, args]);
    return true;
  };
  const result = await verifyPackagedMacSmartctl(file, {
    resourcesPath,
    hostVersion: '99.0',
    verifySignature,
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'sealed-app-signature');
  assert.deepEqual(calls, [
    ['/usr/bin/codesign', ['--verify', '--strict', '--deep', bundle]],
    ['/usr/bin/codesign', ['--verify', '--strict', file]],
  ]);
});
test('tampered file without valid app seal fails closed', async (t) => {
  const { file, resourcesPath } = testBundle(t);
  fs.appendFileSync(file, Buffer.from([4]));
  let verified = 0;
  const result = await verifyPackagedMacSmartctl(file, {
    resourcesPath,
    hostVersion: '99.0',
    verifySignature: async () => {
      verified++;
      return false;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'executable_blocked');
  assert.equal(verified, 1);
});
test('missing file, wrong resource path, and too old macOS are actionable errors', async (t) => {
  const { file, resourcesPath } = testBundle(t);
  const missing = await verifyPackagedMacSmartctl(file + '.missing', { resourcesPath });
  assert.equal(missing.code, 'executable_blocked');
  assert.equal(macBundleForResources('/tmp/not-an-app/Resources'), null);
  const old = await verifyPackagedMacSmartctl(file, { resourcesPath, hostVersion: '14.9' });
  assert.equal(old.ok, false);
  assert.match(old.reason, /verlangt macOS/);
  const supported = await verifyPackagedMacSmartctl(file, {
    resourcesPath,
    hostVersion: '15.0',
  });
  assert.equal(supported.ok, true);
});
test('macOS package smoke verifies real bundle location and signatures without executing on Linux', async (t) => {
  const { root, file, asarApi } = testBundle(t);
  const result = await smokeMacPackage({ root, hostVersion: '99.0', execute: false, asarApi });
  assert.equal(result.binary, file);
  assert.equal(result.mode, 'vendor-sha256');
});

test('macOS package smoke rejects bundled Windows smartctl', async (t) => {
  const { root, resourcesPath, asarApi } = testBundle(t);
  const windowsDir = path.join(resourcesPath, 'smartmontools', 'win32');
  fs.mkdirSync(windowsDir, { recursive: true });
  fs.writeFileSync(path.join(windowsDir, 'smartctl.exe'), 'wrong platform');
  await assert.rejects(
    smokeMacPackage({ root, hostVersion: '99.0', execute: false, asarApi }),
    /Windows-smartctl-Ressourcen/,
  );
});

test('macOS smoke rejects duplicated React files in the packaged ASAR', async (t) => {
  const { root, asarApi } = testBundle(t);
  const original = asarApi.listPackage();
  asarApi.listPackage = () => [...original, 'node_modules/lucide-react/dist/cjs/lucide-react.js'];
  await assert.rejects(
    smokeMacPackage({ root, hostVersion: '99.0', execute: false, asarApi }),
    /Doppelte Frontend-Abhängigkeit.*lucide-react/,
  );
});

test('macOS smoke requires the packaged icon for the centered About window', async (t) => {
  const { root, resourcesPath, asarApi } = testBundle(t);
  fs.unlinkSync(path.join(resourcesPath, 'icon.png'));
  await assert.rejects(
    smokeMacPackage({ root, hostVersion: '99.0', execute: false, asarApi }),
    /PNG-App-Icon/,
  );
});
