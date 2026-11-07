'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const workflow = read('.github/workflows/macos-release.yml');
const script = read('scripts/build-mac-release.sh');
const entitlements = read('build/entitlements.mac.release.plist');

test('official macOS release is separated from ad-hoc CI builds', () => {
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|release):/m);
  assert.match(workflow, /--draft --verify-tag/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /macos-15/);
  assert.match(workflow, /scripts\/build-mac-release\.sh/);
  assert.doesNotMatch(read('.github/workflows/ci.yml'), /secrets\.MAC_CSC_LINK/);
});

test('macOS release workflow uses Apple ID notarization secrets instead of API keys', () => {
  assert.match(workflow, /secrets\.MAC_CSC_LINK/);
  assert.match(workflow, /secrets\.MAC_CSC_KEY_PASSWORD/);
  for (const variable of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    assert.match(workflow, new RegExp(`secrets\\.${variable}`));
    assert.match(
      workflow,
      new RegExp(`\\$\\{${variable}:\\?Set the ${variable} GitHub Actions secret\\.`),
    );
  }
  assert.doesNotMatch(workflow, /APPLE_API_(?:KEY|KEY_ID|ISSUER)/);
});

test('release requires signing, notarization, stapling and Gatekeeper checks', () => {
  assert.match(script, /-c\.mac\.forceCodeSigning=true/);
  assert.match(script, /-c\.mac\.notarize=true/);
  assert.match(script, /-c\.mac\.hardenedRuntime=true/);
  assert.match(script, /entitlements\.mac\.release\.plist/);
  assert.match(script, /Authority=Developer ID Application:/);
  assert.match(script, /TeamIdentifier=/);
  assert.match(script, /codesign --verify --deep --strict/);
  assert.match(script, /stapler validate/);
  assert.match(script, /spctl --assess/);
  assert.match(script, /npm run smoke:mac/);
  assert.doesNotMatch(script, /-c\.mac\.identity=-/);
});

test('bundled smartctl is explicitly signed and release entitlements are minimal', () => {
  assert.deepEqual(packageJson.build.mac.binaries, [
    'Contents/Resources/smartmontools/darwin/smartctl',
  ]);
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.doesNotMatch(entitlements, /disable-library-validation|allow-unsigned-executable-memory/);
  assert.match(workflow, /SHA256SUMS-macos\.txt/);
});
