'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('@electron/asar 4 ESM API can inspect a real packaged archive', async (t) => {
  const { createPackage, listPackage, extractFile } = await import('@electron/asar');
  assert.equal(typeof createPackage, 'function');
  assert.equal(typeof listPackage, 'function');
  assert.equal(typeof extractFile, 'function');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-asar-v4-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'app');
  const archive = path.join(root, 'app.asar');
  const locale = 'locales/de-DE.json';
  const contents = '{"app":"DriveNX"}';
  fs.mkdirSync(path.join(input, 'locales'), { recursive: true });
  fs.writeFileSync(path.join(input, locale), contents);

  await createPackage(input, archive);
  assert.ok(fs.existsSync(archive));
  // ASAR 4 uses the host separator: \ on Windows, / on macOS/Linux.
  const files = listPackage(archive, { isPack: false }).map((name) =>
    name.replace(/^[/\\]+/, '').replace(/\\/g, '/'),
  );
  assert.ok(files.includes(locale));
  assert.equal(extractFile(archive, locale).toString('utf8'), contents);
});
