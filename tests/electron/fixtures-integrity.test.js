'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const fixturesRoot = path.resolve(__dirname, '../../fixtures');
const referenceDir = path.join(fixturesRoot, 'diagnosis-reference');
const baseline = require('../../fixtures/diagnosis-reference/expected.json');

function jsonFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(dir, entry.name);
    return entry.isDirectory()
      ? jsonFiles(filename)
      : entry.isFile() && entry.name.endsWith('.json')
        ? [filename]
        : [];
  });
}

function checkRedaction(data, filename, keyPath = '') {
  if (Array.isArray(data)) {
    for (const [index, value] of data.entries()) {
      checkRedaction(value, filename, `${keyPath}[${index}]`);
    }
    return;
  }
  if (!data || typeof data !== 'object') {
    if (typeof data === 'string') {
      assert.doesNotMatch(
        data,
        /(?:\/(?:Users|home)\/[^\s/]+|[A-Za-z]:\\Users\\[^\s\\]+)/,
        `${filename}: possible private home directory at ${keyPath}`,
      );
    }
    return;
  }
  for (const [key, value] of Object.entries(data)) {
    const location = keyPath ? `${keyPath}.${key}` : key;
    if (key.toLowerCase() === 'serial_number' && value != null) {
      assert.match(
        value,
        /^(?:ANONYMIZED|REDACTED(?:-[\w-]+)?)$/,
        `${filename}: unredacted serial at ${location}`,
      );
    }
    if (key.toLowerCase() === 'wwn' && value != null) {
      assert.deepEqual(value, { redacted: true }, `${filename}: unredacted WWN at ${location}`);
    }
    checkRedaction(value, filename, location);
  }
}

test('diagnosis reference index accounts for every fixture exactly once', () => {
  const indexed = baseline.cases.map(({ file }) => file).sort();
  const actual = fs
    .readdirSync(referenceDir)
    .filter((name) => name.startsWith('capture-'))
    .sort();
  assert.equal(baseline.captures, indexed.length);
  assert.equal(new Set(indexed).size, indexed.length, 'reference index contains duplicate paths');
  assert.deepEqual(actual, indexed, 'orphan or missing diagnosis fixture');
  for (const entry of baseline.cases) {
    assert.match(entry.file, /^capture-\d{3}\.json$/);
    assert.equal(typeof entry.model, 'string');
    assert.equal(typeof entry.expected?.assessment, 'string');
  }
});

test('JSON fixtures have distinct content and contain no raw serials, WWNs or home paths', () => {
  const seen = new Map();
  for (const file of jsonFiles(fixturesRoot)) {
    const relative = path.relative(fixturesRoot, file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    checkRedaction(data, relative);
    // Track duplicates among captured reports; separate expected.json is a test manifest.
    if (relative === path.join('diagnosis-reference', 'expected.json')) continue;
    const signature = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    assert.equal(seen.get(signature), undefined, `${relative} duplicates ${seen.get(signature)}`);
    seen.set(signature, relative);
  }
});
