'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(ELECTRON_SOURCE_DIR, '..');
const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(
      path.join(root, 'fixtures', 'extended-readouts', `${name}-extended.json`),
      'utf8',
    ),
  );
const load = () => import(pathToFileURL(path.join(root, 'src', 'ata-details.mjs')).href);
const source = (file) => fs.readFileSync(path.join(root, 'src', file), 'utf8');

test('Samsung all ATA statistic pages and PHY events remain available outside raw data', async () => {
  const { statistics, phyEvents, logDirectory, temperatureHistory } = await load();
  const raw = fixture('samsung-860-evo-1tb');
  const groups = statistics(raw);
  assert.deepEqual(
    groups.map((g) => g.number),
    [1, 4, 5, 6, 7],
  );
  assert.equal(
    groups.find((g) => g.number === 1).rows.find((r) => r.offset === 40).value,
    10712801370,
  );
  assert.equal(groups.find((g) => g.number === 6).rows.find((r) => r.offset === 8).value, 4624);
  assert.equal(phyEvents(raw).find((r) => r.id === 9).value, 1);
  assert.ok(logDirectory(raw).some((r) => r.address === 17 && r.name.includes('Phy')));
  const history = temperatureHistory(raw);
  assert.ok(history.values.some((v) => v === null));
  assert.equal(history.sampleMinutes, 1);
  assert.equal(history.logMinutes, 10);
});

test('Fujitsu extended logs retain exact total count and only the actual detailed records', () => {
  const raw = fixture('fujitsu');
  const errors = raw.ata_smart_error_log.extended;
  assert.equal(errors.count, 9081);
  assert.equal(errors.logged_count, 256);
  assert.equal(errors.table.length, 8);
  assert.equal(errors.table[0].completion_registers.lba, 141252536);
  assert.equal(raw.ata_smart_self_test_log.extended.table[0].status.remaining_percent, 90);
});

test('Hitachi historical SCT peak and ATA LBAs stay separate from health assessment', async () => {
  const { temperatureHistory } = await load();
  const raw = fixture('hitachi');
  assert.equal(raw.ata_sct_status.temperature.lifetime_max, 71);
  assert.equal(raw.ata_sct_status.temperature.op_limit_max, 42);
  assert.equal(raw.ata_smart_error_log.extended.table[0].completion_registers.lba, 625153409);
  assert.equal(temperatureHistory(raw).values.length, 478);
});

test('invalid and overflowed counters never turn into invented zeroes', async () => {
  const { statistics, phyEvents, temperatureHistory } = await load();
  const raw = {
    ata_device_statistics: {
      pages: [
        {
          number: 1,
          table: [
            { offset: 1, name: 'Missing', value: 0, flags: { valid: false } },
            { offset: 2, name: 'Real zero', value: 0, flags: { valid: true } },
            {
              offset: 3,
              name: 'Unsafe',
              value: Number.MAX_SAFE_INTEGER + 1,
              flags: { valid: true },
            },
          ],
        },
      ],
    },
    sata_phy_event_counters: {
      table: [
        { id: 1, value: 65535, overflow: true },
        { id: 2, value: 0, overflow: false },
      ],
    },
    ata_sct_temperature_history: { table: [null, 0, 22, 180, '24'] },
  };
  assert.deepEqual(
    statistics(raw)[0].rows.map((r) => r.value),
    [null, 0, null],
  );
  assert.deepEqual(
    phyEvents(raw).map((r) => r.value),
    [null, 0],
  );
  assert.deepEqual(temperatureHistory(raw).values, [null, 0, 22, null, null]);
});

test('specialist panels stay in drive tabs; raw results live in query history', () => {
  const log = source('components/QueryLogPanel.tsx');
  const attr = source('components/tabs/AttributesPanel.tsx');
  const hw = source('components/SmartTabs.tsx');
  const err = source('components/tabs/ErrorLogPanel.tsx');
  const tests = source('components/tabs/SelfTestsPanel.tsx');
  assert.match(log, /queryLogResult/);
  assert.doesNotMatch(source('components/SmartTabs.tsx'), /RawDataPanel/);
  assert.match(attr, /<AtaStatisticsPanel\b/);
  assert.match(hw, /<AtaHardwareDetails\b/);
  assert.match(err, /previous_commands|completion_registers|logged_count/);
  assert.match(tests, /polling_minutes|remaining_percent|ata_smart_selective_self_test_log/);
});

test('all zero/selective placeholder spans are not mistaken for self-tests', async () => {
  const { configuredSelectiveSpans } = await load();
  const hitachi = fixture('hitachi');
  assert.equal(hitachi.ata_smart_selective_self_test_log.table.length, 5);
  assert.equal(configuredSelectiveSpans(hitachi).length, 0);
  const custom = {
    ata_smart_selective_self_test_log: {
      table: [
        { lba_min: 0, lba_max: 0, status: { string: 'Not_testing' } },
        { lba_min: 0, lba_max: 200, status: { string: 'Not_testing' } },
        { lba_min: 50, lba_max: 100, status: { string: 'In_progress' } },
      ],
    },
  };
  assert.deepEqual(
    configuredSelectiveSpans(custom),
    custom.ata_smart_selective_self_test_log.table.slice(1),
  );
});

test('SCT temperature bands preserve each valid measurement without inferring times', async () => {
  const { temperatureHistory, temperatureBands } = await load();
  const hitachi = temperatureHistory(fixture('hitachi'));
  const bands = temperatureBands(hitachi);
  assert.equal(hitachi.values.length, 478);
  assert.equal(
    bands.reduce((total, band) => total + band.count, 0),
    478 - hitachi.missing,
  );
  assert.deepEqual(
    temperatureBands({ values: [null, 19, 20, 29, 30, 39, 40] }).map((b) => b.count),
    [1, 2, 2, 1],
  );
  assert.equal(temperatureBands(null).length, 0);
});
