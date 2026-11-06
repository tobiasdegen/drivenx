'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
const script = fs.readFileSync(path.join(root, 'scripts/build-mac-ci.sh'), 'utf8');
const entitlements = fs.readFileSync(path.join(root, 'build/entitlements.mac.adhoc.plist'), 'utf8');

test('CI is started manually and still packages all three supported platforms', () => {
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request):/m);
  for (const platform of ['windows-x64', 'macos-arm64', 'linux-x64']) {
    assert.match(workflow, new RegExp(`name: ${platform}`));
  }
});

test('macOS CI signs the bundle before archives and checks its complete signature', () => {
  assert.match(workflow, /command: bash scripts\/build-mac-ci\.sh/);
  assert.match(script, /electron-builder --mac dmg zip --arm64 --publish never/);
  assert.match(script, /-c\.mac\.identity=-/);
  assert.match(script, /-c\.mac\.hardenedRuntime=true/);
  assert.match(script, /-c\.mac\.entitlements=build\/entitlements\.mac\.adhoc\.plist/);
  assert.match(script, /codesign --verify --deep --strict/);
  assert.match(script, /Signature=adhoc/);
  assert.match(script, /npm run smoke:mac/);
  assert.doesNotMatch(script, /notarytool|CSC_LINK|CSC_KEY_PASSWORD/);
});

test('ad-hoc entitlements preserve hardened runtime compatibility with Electron', () => {
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.doesNotMatch(entitlements, /com\.apple\.security\.app-sandbox/);
});
