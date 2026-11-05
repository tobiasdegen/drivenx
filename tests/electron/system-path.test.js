'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canonicalSystemPath } = require('../../electron/platform/system-path.js');

test('only macOS system-managed /var and /tmp prefixes are canonicalized', () => {
  for (const prefix of ['/var', '/tmp']) {
    const candidate = `${prefix}/folders/test`;
    const resolved = path.resolve(candidate);
    // The macOS normalization is meaningful only on macOS: on Windows the
    // same string denotes a path on the current drive, not a POSIX path.
    const expected =
      process.platform === 'darwin' &&
      fs.existsSync(prefix) &&
      fs.lstatSync(prefix).isSymbolicLink() &&
      fs.realpathSync(prefix) === `/private${prefix}`
        ? `/private${candidate}`
        : resolved;
    assert.equal(canonicalSystemPath(candidate, 'darwin'), expected);
    assert.equal(canonicalSystemPath(candidate, 'win32'), resolved);
  }
  assert.equal(canonicalSystemPath('/various/data', 'darwin'), path.resolve('/various/data'));
});

test('untrusted symlinks remain in the path for subsequent rejection', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-prefix-'));
  try {
    const target = path.join(root, 'real');
    const link = path.join(root, 'linked');
    fs.mkdirSync(target);
    try {
      // Directory junctions work without SeCreateSymbolicLinkPrivilege on Windows.
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
        t.skip(`Windows blocks creating the test directory link (${error.code})`);
        return;
      }
      throw error;
    }
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    const candidate = path.join(link, 'data');
    const result = canonicalSystemPath(candidate, 'darwin');
    assert.ok(result.endsWith(path.join('linked', 'data')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
