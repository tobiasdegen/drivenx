'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const getModule = import(
  pathToFileURL(path.join(ELECTRON_SOURCE_DIR, '..', 'src', 'extended-metrics.mjs'))
);
const fixture = (type) =>
  JSON.parse(
    fs.readFileSync(
      path.join(
        ELECTRON_SOURCE_DIR,
        '..',
        'fixtures',
        'extended-readouts',
        `samsung-860-evo-1tb-${type}.json`,
      ),
      'utf8',
    ),
  );

test('actual 860 EVO -x statistics are interpreted by offsets and retained without changing -a health', async () => {
  const { extendedMetrics, formatSectors } = await getModule;
  const standard = fixture('standard');
  const extended = fixture('extended');
  const base = JSON.stringify(standard);
  const result = extendedMetrics(extended, standard);
  assert.equal(result.uncorrectable, 0);
  assert.equal(result.readSectors, 10712801370);
  assert.equal(result.writtenSectors, 15870680319);
  assert.equal(formatSectors(result.readSectors, result.sectorBytes, 'de-DE'), '5,48 TB');
  assert.equal(formatSectors(result.writtenSectors, result.sectorBytes, 'de-DE'), '8,13 TB');
  assert.equal(result.commandResets, 369);
  assert.equal(result.hardwareResets, 4624);
  assert.equal(result.interfaceCrc, 0);
  assert.equal(result.phyLinkTransitions, 1);
  assert.equal(result.phyComresets, 1);
  assert.equal(result.minTemperature, 16);
  assert.equal(result.maxTemperature, 51);
  assert.equal(result.extendedSelfTestCount, 2);
  assert.equal(result.extendedSelfTestErrors, 0);
  assert.equal(result.extendedErrorCount, 0);
  assert.equal(result.wearExtended, 0);
  assert.equal(result.wearStandard, 1);
  assert.equal(result.wearDifferent, true);
  assert.equal(standard.smart_status.passed, true);
  assert.equal(extended.smart_status.passed, true);
  assert.equal(JSON.stringify(standard), base);
});

test('unreported, invalid, overflowed and unsafe numeric counters never become zero', async () => {
  const { extendedMetrics, formatSectors } = await getModule;
  const invalid = {
    logical_block_size: 512,
    ata_device_statistics: {
      pages: [
        { number: 1, table: [{ offset: 24, value: 4, flags: { valid: false } }] },
        { number: 4, table: [{ offset: 16, value: '19 (1986 14)', flags: { valid: true } }] },
        {
          number: 6,
          table: [{ offset: 8, value: Number.MAX_SAFE_INTEGER + 1, flags: { valid: true } }],
        },
      ],
    },
    sata_phy_event_counters: { table: [{ id: 9, value: 65535, overflow: true }] },
  };
  const metrics = extendedMetrics(invalid, {});
  assert.equal(metrics.writtenSectors, null);
  assert.equal(metrics.commandResets, null);
  assert.equal(metrics.hardwareResets, null);
  assert.equal(metrics.phyLinkTransitions, null);
  assert.equal(metrics.wearDifferent, false);
  assert.equal(formatSectors(metrics.writtenSectors, metrics.sectorBytes), null);
  assert.equal(formatSectors(2, null), null);
  assert.equal(extendedMetrics(null, {}), null);
});

test('sector-size conflicts block conversions and exact byte scaling retains large integer accuracy', async () => {
  const { extendedMetrics, formatSectors } = await getModule;
  const stats = extendedMetrics({ logical_block_size: 4096 }, { logical_block_size: 512 });
  assert.equal(stats.sectorBytes, null);
  assert.equal(formatSectors(1, 512, 'en-US'), '<0.01 GB');
  assert.equal(formatSectors(1953125000, 512, 'en-US'), '1.00 TB');
});

test('fixture serial and WWN are anonymized; no SMART raw values were changed', () => {
  for (const type of ['extended', 'standard']) {
    const sample = fixture(type);
    assert.equal(sample.serial_number, 'ANONYMIZED');
    assert.deepEqual(sample.wwn, { redacted: true });
    assert.equal(
      sample.ata_smart_attributes.table.find((v) => v.id === 241).raw.value,
      15870680319,
    );
  }
});

test('extended values stay in specialist views; raw query results are not interpreted', () => {
  const read = (name) => fs.readFileSync(path.join(ELECTRON_SOURCE_DIR, '..', name), 'utf8');
  assert.doesNotMatch(read('src/components/QueryLogPanel.tsx'), /extendedMetrics\(raw, null\)/);
  assert.match(read('src/components/tabs/AttributesPanel.tsx'), /<AtaStatisticsPanel\b/);
  assert.match(read('src/components/SmartTabs.tsx'), /<AtaHardwareDetails\b/);
  assert.match(read('src/components/DriveOverview.tsx'), /extendedMetrics\(raw, null\)/);
  assert.match(read('src/components/DeviceInformation.tsx'), /extendedMetrics\(raw, null\)/);
  assert.doesNotMatch(read('electron/diagnostics/health.js'), /extendedMetrics/);
});
