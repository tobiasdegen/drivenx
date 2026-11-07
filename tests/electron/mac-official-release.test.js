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
const publish = read('scripts/publish-release-draft.sh');
const entitlements = read('build/entitlements.mac.release.plist');

test('official release is manual and separate from ad-hoc CI', () => {
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|release):/m);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /macos-15/);
  assert.match(workflow, /scripts\/build-mac-release\.sh/);
  assert.match(publish, /--draft --verify-tag/);
  assert.doesNotMatch(read('.github/workflows/ci.yml'), /secrets\.MAC_CSC_LINK/);
});

test('macOS workflow uses Apple ID notarization secrets instead of API keys', () => {
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

test('draft validation can read unpublished GitHub releases without broadening global access', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.match(
    workflow,
    /^ {2}verify:\n {4}name: Validate release tag and draft\n {4}runs-on: ubuntu-22\.04\n(?: {4}#[^\n]*\n)? {4}permissions:\n {6}contents: write$/m,
  );
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

test('bundled smartctl is explicitly signed and entitlements remain minimal', () => {
  assert.deepEqual(packageJson.build.mac.binaries, [
    'Contents/Resources/smartmontools/darwin/smartctl',
  ]);
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.doesNotMatch(entitlements, /disable-library-validation|allow-unsigned-executable-memory/);
  assert.match(publish, /SHA256SUMS\.txt/);
});

test('one draft combines Windows, macOS and Linux from the same version tag', () => {
  assert.match(workflow, /name: DriveNX Release/);
  assert.match(workflow, /reuse_existing_macos:/);
  assert.match(workflow, /needs: \[verify, windows, linux, macos\]/);
  assert.match(workflow, /npm run release:win/);
  assert.match(workflow, /npm run dist:linux/);
  assert.match(workflow, /needs\.verify\.outputs\.commit_sha/);
  assert.match(workflow, /actions\/download-artifact@v8/);
  assert.match(workflow, /merge-multiple: true/);
  assert.match(workflow, /scripts\/publish-release-draft\.sh/);
  assert.match(publish, /gh release upload/);
  assert.match(publish, /gh release create/);
  assert.match(publish, /sha256sum --check --strict SHA256SUMS-macos\.txt/);
  assert.match(publish, /Refusing to replace any asset/);
  assert.match(publish, /--draft --verify-tag/);
});
