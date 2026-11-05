'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const de = require('../../locales/de-DE.json');
const en = require('../../locales/en-US.json');
const { translateTest } = require('../../electron/diagnostics/smart-test-translation.js');
function shape(obj, prefix = '') {
  return Object.entries(obj)
    .flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return value && typeof value === 'object' && !Array.isArray(value)
        ? shape(value, path)
        : [path];
    })
    .sort();
}
test('German and English translation catalogs have the same keys', () => {
  assert.deepEqual(shape(de), shape(en));
});
test('SMART tests are translated without inventing unknown statuses', () => {
  assert.equal(translateTest('Short offline', 'de-DE', 'type'), 'Kurztest');
  assert.equal(translateTest('Extended offline', 'de-DE', 'type'), 'Langtest');
  assert.equal(translateTest('Completed: read failure', 'de-DE'), 'Mit Lesefehler fehlgeschlagen');
  assert.equal(translateTest('Completed without error', 'de-DE'), 'Fehlerfrei abgeschlossen');
  assert.equal(translateTest('Short offline', 'en-US', 'type'), 'Short test');
  assert.equal(translateTest('vendor-code 0x7f', 'de-DE'), 'vendor-code 0x7f');
});

test('translation placeholders are consistent with English reference', () => {
  function placeholders(value) {
    return [...String(value).matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((m) => m[1]).sort();
  }
  function flatten(o, prefix = '', out = {}) {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
      else out[key] = String(v);
    }
    return out;
  }
  const base = flatten(en),
    translated = flatten(de);
  for (const key of Object.keys(base))
    assert.deepEqual(placeholders(translated[key]), placeholders(base[key]), key);
});

test('translation export has no side effects on import and writes valid CSV only when requested', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const script = path.resolve(__dirname, '../../scripts/export-translations.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-export-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const imported = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(script)});`], {
    cwd: tmp,
    encoding: 'utf8',
  });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, '');
  assert.deepEqual(fs.readdirSync(tmp), []);
  const output = path.join(tmp, 'translations.csv');
  const exported = spawnSync(process.execPath, [script, output], { encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);
  const csv = fs.readFileSync(output, 'utf8');
  assert.ok(csv.startsWith('\ufeff"Key","English source"'));
  assert.match(csv, /\r\n/);
});
