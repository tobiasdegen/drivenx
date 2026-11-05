'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  verifyDirectory,
  readLimitedJson,
  atomicWrite,
} = require('../../electron/data/safe-files.js');

// Windows allows directory junctions without the symbolic-link privilege.
// Ordinary file symlinks still require Developer Mode or elevated privileges.
async function createTestLink(t, target, link, type) {
  try {
    await fs.symlink(
      target,
      link,
      process.platform === 'win32' && type === 'dir' ? 'junction' : type,
    );
    return true;
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip(
        `Windows blocks creating the test ${type} link (${error.code}); actual symlink protection was not exercised`,
      );
      return false;
    }
    throw error;
  }
}
async function sandbox(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-safe-'));
  try {
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
test('atomic writes produce valid data even if invoked simultaneously', () =>
  sandbox(async (root) => {
    const target = path.join(root, 'settings.json');
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => atomicWrite(target, JSON.stringify({ i }), 1024)),
    );
    const obj = await readLimitedJson(target, 1024);
    assert.ok(Number.isInteger(obj.i) && obj.i >= 0 && obj.i < 10);
    assert.deepEqual((await fs.readdir(root)).sort(), ['settings.json']);
  }));
test('oversized JSON is rejected before full-file read', () =>
  sandbox(async (root) => {
    const target = path.join(root, 'large.json');
    await fs.writeFile(target, 'x'.repeat(200));
    await assert.rejects(readLimitedJson(target, 40), /groß/);
    await assert.rejects(atomicWrite(target, 'x'.repeat(200), 40), /groß/);
  }));
test('data folders refuse symlinks to outside directories', (t) =>
  sandbox(async (root) => {
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    const link = path.join(root, 'linked');
    if (!(await createTestLink(t, outside, link, 'dir'))) return;
    assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
    await assert.rejects(
      verifyDirectory(path.join(link, 'child'), true),
      /Unsicheres Datenverzeichnis/,
    );
    await assert.rejects(
      atomicWrite(path.join(link, 'victim.json'), '{}', 100),
      /Unsicheres Datenverzeichnis/,
    );
    assert.deepEqual(await fs.readdir(outside), []);
  }));
test('JSON reads refuse symlinked files', (t) =>
  sandbox(async (root) => {
    const real = path.join(root, 'real.json');
    const link = path.join(root, 'link.json');
    await fs.writeFile(real, '{}');
    if (!(await createTestLink(t, real, link, 'file'))) return;
    assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
    await assert.rejects(readLimitedJson(link, 100));
  }));

test('rejected commit leaves an existing atomic target untouched and cleans staging files', () =>
  sandbox(async (root) => {
    const target = path.join(root, 'settings.json');
    await fs.writeFile(target, '{"settings":"current"}');
    let checked = false;
    await assert.rejects(
      atomicWrite(target, '{"settings":"revoked"}', 1024, () => {
        checked = true;
        throw new Error('STALE');
      }),
      /STALE/,
    );
    assert.equal(checked, true);
    assert.equal(await fs.readFile(target, 'utf8'), '{"settings":"current"}');
    assert.deepEqual(await fs.readdir(root), ['settings.json']);
  }));
