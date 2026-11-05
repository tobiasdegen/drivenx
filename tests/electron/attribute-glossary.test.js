const test = require('node:test');
const assert = require('node:assert/strict');
const de = require('../../locales/de-DE.json');
const en = require('../../locales/en-US.json');
test('translated attribute glossaries have identical entries and nonempty fields', () => {
  assert.deepEqual(
    Object.keys(de.attributeGlossary).sort(),
    Object.keys(en.attributeGlossary).sort(),
  );
  for (const locale of [de, en]) {
    for (const [key, entry] of Object.entries(locale.attributeGlossary)) {
      for (const field of ['label', 'description', 'interpretation'])
        assert.ok(typeof entry[field] === 'string' && entry[field].trim(), `${key}.${field}`);
    }
  }
});
