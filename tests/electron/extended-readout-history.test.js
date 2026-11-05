'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { snapshot } = require('../../electron/data/measurement-history.js');
const { evaluate } = require('../../electron/diagnostics/health.js');
function sample(name) {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        ELECTRON_SOURCE_DIR,
        '..',
        'fixtures',
        'extended-readouts',
        `${name}-extended.json`,
      ),
      'utf8',
    ),
  );
}
test('history records actual extended ATA error count rather than silently dropping it', () => {
  const raw = { ...sample('fujitsu'), serial_number: 'TEST-FUJITSU-01' };
  // Fixture IDs are intentionally anonymized and cannot be used as real history keys.
  const record = snapshot({ raw, health: evaluate(raw), capturedAt: '2026-10-22T17:00:00.000Z' });
  assert.ok(record);
  assert.equal(record.metrics.ataErrorCount, 9081);
  assert.equal(record.status, 'defective');
});
