'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { evaluate } = require('../../electron/diagnostics/health.js');

const fixtures = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, '..', 'fixtures', 'device-tests', name), 'utf8'),
  );
const cases = [
  evaluate(require('../../fixtures/fujitsu-sample.json')),
  evaluate(fixtures('drive-apple-ssd-ap0512z.json')),
  evaluate(fixtures('drive-samsung-ssd-860-evo-500gb.json')),
  evaluate(fixtures('drive-hitachi-hts543232l9a300.json')),
  evaluate(fixtures('DriveNX_SAMSUNG_KUS020203M-B000.json')),
  evaluate({
    smart_status: { passed: true },
    nvme_smart_health_information_log: { media_errors: 3, num_err_log_entries: 100 },
    nvme_error_information_log: {
      table: [{ status_field: { status_code_type: 0, status_code: 1 } }],
    },
  }),
];

// Exercise the actual renderer advice module without depending on React/Vite.
// Node 22.16 can erase TypeScript type-only imports for this pure helper.
const script = `
import { diagnosisAdvice } from './src/diagnosis-advice.ts';
const input = JSON.parse(process.env.DIAGNOSE_CASES);
process.stdout.write(JSON.stringify(input.map(health => ({de:diagnosisAdvice(health,'de-DE'), en:diagnosisAdvice(health,'en-US')}))));
`;

test('real drive assessments generate German and English advice with critical findings taking priority', () => {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    {
      cwd: path.join(ELECTRON_SOURCE_DIR, '..'),
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, DIAGNOSE_CASES: JSON.stringify(cases) },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  assert.equal(rows.length, cases.length);
  rows.forEach((item) => {
    assert.ok(item.de.length > 25);
    assert.ok(item.en.length > 25);
  });
  assert.match(
    rows[0].de,
    /umgehend sichern/i,
    'failed real Fujitsu self-tests need urgent advice',
  );
  assert.match(
    rows[5].de,
    /umgehend sichern/i,
    'confirmed NVMe media errors take precedence over historical command logs',
  );
  assert.doesNotMatch(rows[5].de, /^NVMe-Fehlerprotokoll prüfen/);
  assert.match(rows[5].en, /back up data promptly/i);
  assert.equal(cases[5].diagnosis.overallAlert, 'critical');
});
