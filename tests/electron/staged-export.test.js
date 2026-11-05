'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { stagedExport } = require('../../electron/reports/staged-export.js');

async function sandbox(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-export-'));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { force: true, recursive: true });
  }
}

test('staged export replaces an existing file only after a valid snapshot check', () =>
  sandbox(async (dir) => {
    const target = path.join(dir, 'diagnosis.json');
    await fs.writeFile(target, 'older export');
    let checks = 0;
    await stagedExport(target, '{"new":true}', { assertCurrent: () => checks++ });
    assert.equal(checks, 2);
    assert.equal(await fs.readFile(target, 'utf8'), '{"new":true}');
    assert.deepEqual(await fs.readdir(dir), ['diagnosis.json']);
  }));

test('revocation during the asynchronous staging write preserves existing export', () =>
  sandbox(async (dir) => {
    const target = path.join(dir, 'diagnosis.json');
    await fs.writeFile(target, 'keep-original');
    let valid = true;
    let started;
    const writing = new Promise((resolve) => (started = resolve));
    let release;
    const pending = new Promise((resolve) => (release = resolve));
    const job = stagedExport(target, 'stale-data', {
      writeFile: async (filename, data, options) => {
        await fs.writeFile(filename, data, options);
        started();
        await pending;
      },
      assertCurrent: () => {
        if (!valid) throw new Error('STALE');
      },
    });
    await writing;
    valid = false;
    release();
    await assert.rejects(job, /STALE/);
    assert.equal(await fs.readFile(target, 'utf8'), 'keep-original');
    assert.deepEqual(await fs.readdir(dir), ['diagnosis.json']);
  }));

test('staging and rename failures clean temporary files without damaging the old export', () =>
  sandbox(async (dir) => {
    const target = path.join(dir, 'report.pdf');
    await fs.writeFile(target, 'existing PDF');
    await assert.rejects(
      stagedExport(target, Buffer.from('new'), {
        assertCurrent: () => {},
        renameFile: async () => {
          throw new Error('RENAME_FAILED');
        },
      }),
      /RENAME_FAILED/,
    );
    assert.equal(await fs.readFile(target, 'utf8'), 'existing PDF');
    assert.deepEqual(await fs.readdir(dir), ['report.pdf']);
  }));

test('revocation during an already initiated rename is reported instead of success', () =>
  sandbox(async (dir) => {
    const target = path.join(dir, 'diagnosis.html');
    let valid = true;
    await assert.rejects(
      stagedExport(target, '<html></html>', {
        assertCurrent: () => {
          if (!valid) throw new Error('STALE');
        },
        renameFile: async (source, destination) => {
          await fs.rename(source, destination);
          valid = false;
        },
      }),
      /STALE/,
    );
    // Once the rename has committed, deleting the target is unsafe: it may
    // have replaced a previous user file. Never claim success in this case.
    assert.equal(await fs.readFile(target, 'utf8'), '<html></html>');
    assert.deepEqual(await fs.readdir(dir), ['diagnosis.html']);
  }));
