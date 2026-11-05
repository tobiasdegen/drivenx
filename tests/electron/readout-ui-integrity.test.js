'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = (name) => fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, '..', name), 'utf8');
const { evaluate } = require('../../electron/diagnostics/health.js');

test('Apple-like NVMe readout: core health can be complete with optional GetLogPage error', () => {
  const raw = {
    device: { protocol: 'NVMe' },
    smart_status: { passed: true },
    nvme_smart_health_information_log: {
      critical_warning: 0,
      media_errors: 0,
      available_spare: 100,
      available_spare_threshold: 99,
      percentage_used: 1,
      num_err_log_entries: 0,
    },
    smartctl: {
      exit_status: 4,
      messages: [
        {
          severity: 'error',
          string: 'Read 1 entries from Error Information Log failed: GetLogPage failed: code=745',
        },
      ],
    },
  };
  const health = evaluate(raw);
  assert.equal(health.diagnosis.domains.media, 'ok');
  assert.equal(health.diagnosis.assessment, 'complete');
  assert.equal(health.readout.status, 'eingeschraenkt');
  assert.deepEqual(health.diagnosis.coverage.missing, []);
  assert.equal(health.diagnosis.evidence.length, 0);
});

test('Missing NVMe core health values are not mistaken for an optional log restriction', () => {
  const health = evaluate({
    device: { protocol: 'NVMe' },
    smart_status: { passed: true },
    nvme_smart_health_information_log: { percentage_used: 1 },
    smartctl: { exit_status: 4 },
  });
  assert.equal(health.diagnosis.assessment, 'partial');
  assert.ok(health.diagnosis.coverage.missing.includes('nvme.media_errors'));
});

test('UI differentiates readout coverage, unavailable logs and unsupported self-tests', () => {
  assert.match(source('src/components/DriveHeader.tsx'), /<ReadoutCoverage/);
  assert.match(source('src/components/ReadoutCoverage.tsx'), /health\.diagnosis\.coverage/);
  assert.match(source('src/components/ReadoutCoverage.tsx'), /coverageOptional/);
  const errorPanel = source('src/components/tabs/ErrorLogPanel.tsx');
  assert.match(errorPanel, /nvmeLogFailed/);
  assert.match(errorPanel, /errorLogUnavailable/);
  assert.match(errorPanel, /errorRows\.length > 0/);
  const tests = source('src/components/tabs/SelfTestsPanel.tsx');
  assert.match(tests, /capability === 'supported'/);
  assert.match(tests, /selfTests\.length === 0/);
});

test('File sample is absent from release API and arbitrary-file speed is not shown as device speed', () => {
  assert.doesNotMatch(source('electron/main.js'), /diagnostics:readFileSample/);
  assert.doesNotMatch(source('electron/preload.js'), /readFileSample/);
  assert.doesNotMatch(source('src/ipc-contract.ts'), /readFileSample/);
  assert.doesNotMatch(source('src/components/SmartTabs.tsx'), /ReadSamplePanel/);
  assert.match(source('src/components/tabs/HostIoPanel.tsx'), /macHostIo/);
});
