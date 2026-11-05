'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recommendationPlan } = require('../../shared/recommendation-rules.mjs');
const { selfTestSupport, selfTestResult } = require('../../shared/self-test-assessment.mjs');
const de = require('../../locales/de-DE.json');
const en = require('../../locales/en-US.json');

test('recommendations use central plan while UI and report retain separate texts', () => {
  const critical = recommendationPlan({
    diagnosis: { domains: { media: 'defective' }, assessment: 'partial' },
    findings: [{ code: 'testsFailed', level: 'kritisch' }],
    readout: { status: 'eingeschraenkt', issues: [] },
  });
  assert.equal(critical.primary, 'urgent');
  assert.deepEqual(critical.reportCodes, ['critical', 'limited']);
  const warning = recommendationPlan({
    diagnosis: { domains: { media: 'warning' }, assessment: 'complete' },
    findings: [{ code: 'ataErrors', level: 'warnung' }],
    readout: { status: 'vollstaendig', issues: [] },
  });
  assert.equal(warning.primary, 'warning');
  assert.deepEqual(warning.reportCodes, ['warning']);
  for (const catalog of [de, en]) {
    assert.ok(catalog.recommendations.uiUrgent);
    for (const key of critical.reportCodes) assert.ok(catalog.recommendations[key]);
  }
});

test('NVMe measurement, history and ATA device translations stay aligned across locales', () => {
  for (const section of ['nvmeMetrics', 'historyMetrics']) {
    assert.deepEqual(Object.keys(de[section]).sort(), Object.keys(en[section]).sort());
    assert.ok(Object.keys(de[section]).length >= 16);
    for (const key of Object.keys(de[section])) {
      const deRow = de[section][key],
        enRow = en[section][key];
      assert.ok(typeof deRow === 'string' ? deRow : deRow.label && deRow.description);
      assert.ok(typeof enRow === 'string' ? enRow : enRow.label && enRow.description);
    }
  }
});

test('self-test interrupted by host or reset never becomes a media failure', () => {
  for (const text of ['Aborted by host', 'Interrupted by host reset', 'Reset interrupted'])
    assert.equal(selfTestResult({ status: { passed: false, string: text } }), 'interrupted');
  assert.equal(selfTestSupport({ ata_smart_attributes: { table: [{ id: 9 }] } }), 'unknown');
});

test('Electron bundle includes every shared runtime module imported by Electron', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const packageJson = require('../../package.json');
  const bundledFiles = packageJson.build.files;
  const dependencies = new Set();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/require\(['"](\.{1,2}\/[^'"]+\.mjs)['"]\)/g)) {
        const modulePath = path.resolve(dir, match[1]);
        const sharedDir = path.resolve(ELECTRON_SOURCE_DIR, '..', 'shared');
        if (modulePath.startsWith(sharedDir + path.sep))
          dependencies.add(
            path.relative(path.dirname(sharedDir), modulePath).replaceAll(path.sep, '/'),
          );
      }
    }
  };
  visit(ELECTRON_SOURCE_DIR);
  assert.ok(dependencies.size > 0, 'expected shared main-process dependencies');
  assert.ok(bundledFiles.includes('shared/**/*'), 'shared modules must be packaged as a directory');
  for (const file of dependencies)
    assert.ok(
      fs.existsSync(path.join(ELECTRON_SOURCE_DIR, '..', file)),
      `Missing shared source module: ${file}`,
    );
});
