'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluate } = require('../../electron/diagnostics/health.js');
const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');

const dir = path.join(ELECTRON_SOURCE_DIR, '..', 'fixtures', 'device-tests');
const expected = Object.freeze({
  'DriveNX_SAMSUNG_KUS020203M-B000.json': 'ok',
  'DriveNX_SAMSUNG_KUS040202M-B000.json': 'ok',
  'DriveNX_Samsung_SSD_860_EVO_1TB.json': 'ok',
  'drive-apple-ssd-ap0512z.json': 'ok',
  'drive-hitachi-hts543232l9a300.json': 'observe',
  'drive-hitachi-hts545050b9a300.json': 'observe',
  'drive-samsung-ssd-860-evo-500gb.json': 'ok',
  'drive-wdc-wd5000bevt-00a0rt0.json': 'ok',
  'drive-wdc-wd5000bevt-22zat0.json': 'ok',
});

test('full hardware fixture corpus stays explicitly accounted for', () => {
  assert.deepEqual(
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort(),
    Object.keys(expected).sort(),
  );
});
for (const [filename, status] of Object.entries(expected)) {
  test(`full hardware fixture: ${filename}`, () => {
    const input = fs.readFileSync(path.join(dir, filename), 'utf8');
    const report = JSON.parse(input);
    const before = JSON.stringify(report);
    const assessment = evaluate(report);
    assert.equal(visibleDiagnosisStatus(assessment), status);
    assert.ok(
      ['vollstaendig', 'eingeschraenkt', 'fehlgeschlagen'].includes(assessment.readout.status),
    );
    assert.ok(Array.isArray(assessment.findings));
    assert.equal(
      JSON.stringify(report),
      before,
      'health evaluation must not mutate the original report',
    );
  });
}
