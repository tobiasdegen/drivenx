'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const validation = require('../../electron/ipc/ipc-validation.js');
const { MAX_DEVICE_NAME_LENGTH } = require('../../shared/device-limits.js');
const { assertSameDevice } = require('../../electron/devices/device-identity.js');
const { readCompanyLogo } = require('../../electron/reports/company-logo.js');
const { userErrorMessage } = require('../../electron/security/user-errors.js');
const { createReportExporter } = require('../../electron/reports/report-export.js');
const { generateHTML: productionHTML } = require('../../electron/reports/report.js');
// Report tests construct the current diagnostic contract, never deprecated status-only fixtures.
const { evaluate: evaluateForReport } = require('../../electron/diagnostics/health.js');
const generateHTML = (detail, locale, prefs) =>
  productionHTML(
    {
      ...detail,
      health: detail?.health?.diagnosis ? detail.health : evaluateForReport(detail.raw || {}),
    },
    locale,
    prefs,
  );

const de = require('../../locales/de-DE.json');
const en = require('../../locales/en-US.json');

function localizedFailure(action, key) {
  assert.throws(action, (error) => {
    assert.equal(error.userMessageKey, key);
    assert.equal(userErrorMessage(error, 'de-DE'), de.backendErrors[key]);
    assert.equal(userErrorMessage(error, 'en-US'), en.backendErrors[key]);
    assert.notEqual(userErrorMessage(error, 'en-US'), userErrorMessage(error, 'de-DE'));
    return true;
  });
}

test('IPC validation rejects bad hardware, settings and report requests with localized stable codes', () => {
  localizedFailure(() => validation.device({ name: '/dev/disk1' }), 'invalidDeviceSelection');
  localizedFailure(
    () => validation.device({ name: 'A'.repeat(MAX_DEVICE_NAME_LENGTH + 1), type: 'auto' }),
    'deviceIdentifierTooLong',
  );
  localizedFailure(() => validation.settings({ locale: 'fr' }), 'invalidSettingsValues');
  localizedFailure(
    () =>
      validation.settings({
        locale: 'de-DE',
        theme: 'dark',
        attributeMode: 'friendly',
        autoSaveHistory: 'yes',
      }),
    'invalidAutoHistorySettings',
  );
  localizedFailure(() => validation.reportIdToken('old-report'), 'invalidReportId');
  localizedFailure(() => validation.testKind('erase'), 'invalidSelfTestKind');
  localizedFailure(
    () => validation.exportRequest({ name: 'disk1', type: 'auto' }, 'exe', 'de-DE'),
    'invalidExportFormat',
  );
  localizedFailure(
    () => validation.validatedLogo('data:image/svg+xml;base64,AAAA'),
    'logoFormatOrSize',
  );
});

test('drive replacement / uncertain identity and bad logo errors use the same translation boundary', async () => {
  const raw = (serial) => ({
    serial_number: serial,
    model_name: 'Known Drive',
    user_capacity: { bytes: 1024 },
  });
  localizedFailure(() => assertSameDevice(raw('SERIAL111'), raw('SERIAL222')), 'driveReplaced');
  localizedFailure(
    () => assertSameDevice(raw('SERIAL111'), { ...raw('SERIAL111'), model_name: 'Other' }),
    'driveMetadataChanged',
  );
  localizedFailure(
    () => assertSameDevice(raw('UNKNOWN'), raw('UNKNOWN')),
    'driveIdentityUnverifiable',
  );
  const file = {
    stat: async () => ({ isFile: () => true, size: 2 }),
    open: async () => ({
      stat: async () => ({ isFile: () => true, size: 2 }),
      read: (() => {
        let consumed = false;
        return async (buffer, offset) => {
          if (consumed) return { bytesRead: 0, buffer };
          Buffer.from('xx').copy(buffer, offset);
          consumed = true;
          return { bytesRead: 2, buffer };
        };
      })(),
      close: async () => {},
    }),
  };
  await assert.rejects(readCompanyLogo(file, 'fake.jpg'), (error) => {
    assert.equal(error.userMessageKey, 'companyLogoOnlyImages');
    assert.equal(userErrorMessage(error, 'en-US'), en.backendErrors.companyLogoOnlyImages);
    return true;
  });
});

test('exported real HTML uses exactly the health attached to the validated snapshot', async () => {
  const device = { name: '/dev/disk7', type: 'sat' };
  // Contradictory input simulates a report whose assessment differs from an
  // independently recalculated raw SMART value. Export must use the snapshot.
  const snapshot = {
    device,
    reportId: 'd2a72d7f-9036-4829-afc8-e885e705006e',
    capturedAt: '2026-10-25T08:00:00Z',
    raw: { model_name: 'Snapshot Drive', smart_status: { passed: true } },
    health: {
      status: 'kritisch',
      diagnosis: {
        algorithmVersion: '1.0.0',
        assessment: 'partial',
        protocol: 'ata',
        coverage: { available: [], missing: ['ata.attribute_coverage'] },
        domains: { media: 'defective', connection: null, thermal: null },
        overallAlert: 'defective',
        evidence: [
          {
            ruleId: 'smartFailed',
            domain: 'media',
            severity: 'defective',
            source: 'smartctl',
            mappingConfidence: 'verified',
          },
        ],
        recommendedActionCodes: ['prioritize_backup_or_imaging'],
      },
      readout: { status: 'eingeschraenkt', issues: [] },
      findings: [{ level: 'kritisch', code: 'smartFailed' }],
    },
  };
  let document = '';
  const exporter = createReportExporter({
    validateRequest: (d, format, locale, reportId) => ({ device: d, format, locale, reportId }),
    assertDevice: (d) => d,
    reports: { get: () => snapshot },
    deviceKey: (d) => d.name,
    showSaveDialog: async () => ({ filePath: '/test/drivenx.html' }),
    createPdfWindow: () => {
      throw new Error('HTML should not need a PDF window');
    },
    writeFile: async (_file, content) => {
      document = content;
    },
    renameFile: async () => {},
    generateHTML,
    getSettings: () => ({}),
  });
  await exporter(device, 'html', 'en-US', snapshot.reportId);
  assert.match(document, /hero critical/);
  assert.match(document, /Snapshot Drive/);
  assert.match(document, /SMART/);
});

test('stable IPC error messages are not duplicated as literals in validation/identity/logo modules', () => {
  for (const file of [
    'ipc/ipc-validation.js',
    'reports/company-logo.js',
    'devices/device-identity.js',
  ]) {
    const source = fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, file), 'utf8');
    assert.doesNotMatch(
      source,
      /throw new Error\(['"].*[äöüÄÖÜ]/,
      `${file} duplicates localized message`,
    );
    assert.match(source, /backendError\('/);
  }
});

test('device operation quarantine retains localized guidance and does not retry unsafe hardware', async () => {
  const { createDeviceOperations } = require('../../electron/devices/device-operations.js');
  const operations = createDeviceOperations();
  let executed = 0;
  await assert.rejects(
    operations.run('disk9', async () => {
      executed++;
      const error = new Error('process exit unconfirmed');
      error.processCloseUnconfirmed = true;
      throw error;
    }),
    /process exit unconfirmed/,
  );
  await assert.rejects(
    operations.run('disk9', async () => {
      executed++;
    }),
    (error) => {
      assert.equal(error.userMessageKey, 'smartctlProcessUnconfirmed');
      assert.equal(userErrorMessage(error, 'en-US'), en.backendErrors.smartctlProcessUnconfirmed);
      return true;
    },
  );
  assert.equal(executed, 1);
});
