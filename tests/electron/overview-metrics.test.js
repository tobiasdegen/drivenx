'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const modulePromise = import(
  pathToFileURL(path.join(ELECTRON_SOURCE_DIR, '..', 'shared', 'overview-metrics.mjs'))
);
test('NVMe overview uses standardized counters and separates data units from host commands', async () => {
  const { overviewMetrics, formatNvmeDataUnits } = await modulePromise;
  const nvme = {
    device: { protocol: 'NVMe' },
    nvme_smart_health_information_log: {
      power_on_hours: 22,
      power_cycles: 9,
      percentage_used: 2,
      data_units_read: 1953125,
      data_units_written: 1,
      host_reads: 350,
      media_errors: 0,
      num_err_log_entries: 189,
      unsafe_shutdowns: 5,
      available_spare: 100,
    },
  };
  const result = overviewMetrics(nvme);
  assert.equal(result.kind, 'nvme');
  assert.equal(result.powerCycles, 9);
  assert.equal(result.readUnits, 1953125);
  assert.equal(result.readCommands, 350);
  assert.equal(formatNvmeDataUnits(1953125, 'en-US'), '1 TB');
  assert.equal(result.errorCounters.find((x) => x.key === 'nvmeLogEntries').informational, true);
  assert.equal(result.errorCounters.find((x) => x.key === 'mediaErrors').value, 0);
});
test('ATA overview never treats packed vendor raw values as sector counts', async () => {
  const { overviewMetrics } = await modulePromise;
  const raw = {
    device: { protocol: 'ATA' },
    rotation_rate: 0,
    ata_smart_attributes: {
      table: [
        { id: 12, raw: { string: '98' } },
        { id: 5, raw: { string: '19 (1986 14)', value: 123456 } },
        { id: 197, raw: { string: '12', value: 13 } },
        { id: 198, raw: { string: '4', value: 4 } },
      ],
    },
  };
  const metrics = overviewMetrics(raw);
  assert.equal(metrics.kind, 'ata');
  assert.equal(metrics.powerCycles, 98);
  assert.equal(metrics.errorCounters.find((x) => x.key === 'reallocated').value, null);
  assert.equal(metrics.errorCounters.find((x) => x.key === 'pending').value, null);
  assert.equal(metrics.errorCounters.find((x) => x.key === 'uncorrectable').value, 4);
});
test('missing and invalid values remain unknown, not zero or invented TB', async () => {
  const { overviewMetrics, formatNvmeDataUnits, safeCounter } = await modulePromise;
  assert.equal(safeCounter(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(safeCounter(-4), null);
  assert.equal(formatNvmeDataUnits(undefined), '–');
  const info = overviewMetrics({
    device: { protocol: 'NVMe' },
    nvme_smart_health_information_log: { data_units_read: 'invalid' },
  });
  assert.equal(info.readUnits, null);
  assert.equal(info.powerCycles, null);
  assert.equal(info.errorCounters[0].value, null);
});
test('USB transport does not alter the medium classification', async () => {
  const { overviewMetrics } = await modulePromise;
  const info = overviewMetrics({
    scsi_vendor: 'USB',
    device: { protocol: 'ATA' },
    ata_smart_attributes: { table: [] },
  });
  assert.equal(info.kind, 'ata');
});

test('same internal NVMe accessed as /dev/sda and /dev/nvme0 has equal diagnostic overview', async () => {
  const { overviewMetrics } = await modulePromise;
  const healthLog = {
    power_on_hours: 9391,
    power_cycles: 1599,
    percentage_used: 2,
    data_units_read: 94563895,
    data_units_written: 90511626,
    media_errors: 0,
    num_err_log_entries: 189,
    unsafe_shutdowns: 96,
    available_spare: 100,
  };
  const sd = overviewMetrics({
    device: { name: '/dev/sda', type: 'nvme', protocol: 'NVMe' },
    nvme_smart_health_information_log: healthLog,
  });
  const nv = overviewMetrics({
    device: { name: '/dev/nvme0', type: 'nvme', protocol: 'NVMe' },
    nvme_smart_health_information_log: healthLog,
  });
  assert.deepEqual(sd, nv);
  assert.equal(sd.errorCounters.find((x) => x.key === 'mediaErrors').value, 0);
  assert.equal(sd.errorCounters.find((x) => x.key === 'nvmeLogEntries').value, 189);
});

test('SCSI drive uses only uncorrected counts from the three standard operations', async () => {
  const { overviewMetrics } = await modulePromise;
  const result = overviewMetrics({
    device: { protocol: 'SCSI' },
    rotation_rate: 7200,
    scsi_error_counter_log: {
      read: { total_uncorrected_errors: 0 },
      write: { total_uncorrected_errors: 2 },
      verify: { total_uncorrected_errors: 4 },
    },
  });
  assert.equal(result.kind, 'scsi');
  assert.deepEqual(
    result.errorCounters.map((x) => x.value),
    [0, 2, 4],
  );
  assert.equal(result.readUnits, null);
});

test('do not create a false zero for extremely small positive data volumes', async () => {
  const { formatNvmeDataUnits } = await modulePromise;
  assert.equal(formatNvmeDataUnits(1, 'de-DE'), '<0,01 GB');
  assert.equal(formatNvmeDataUnits(0, 'de-DE'), '0 GB');
});

test('renderer ATA counters agree with authoritative Electron health parser', async () => {
  const { plainAtaCounter } = await modulePromise;
  const { plainAtaCount } = require('../../electron/diagnostics/ata-raw.js');
  for (const raw of [
    { string: '0', value: 0 },
    { string: '123', value: 123 },
    { string: '19 (1986 14)', value: 19 },
    { string: '4294967296', value: 4294967296 },
    { string: '19', value: 20 },
    { string: '17' },
    { string: 'n/a', value: 0 },
  ]) {
    assert.equal(plainAtaCounter({ raw }), plainAtaCount({ raw }));
  }
});

test('all overview and history metric labels exist in both languages', () => {
  const de = require('../../locales/de-DE.json').smartView;
  const en = require('../../locales/en-US.json').smartView;
  const keys = [
    'overviewUnavailable',
    'overviewCycles',
    'overviewRead',
    'overviewWritten',
    'overviewWear',
    'overviewCounters',
    'overviewFindings',
    'overviewReadoutPartial',
    ...[
      'mediaErrors',
      'nvmeLogEntries',
      'unsafeShutdowns',
      'spare',
      'reallocated',
      'pending',
      'uncorrectable',
      'ataLog',
      'readErrors',
      'writeErrors',
      'verifyErrors',
    ].map((k) => 'overview_' + k),
    ...[
      'nvmeReadUnits',
      'nvmeWrittenUnits',
      'nvmeErrorLogEntries',
      'unsafeShutdowns',
      'reallocatedSectors',
      'scsiReadErrors',
      'scsiWriteErrors',
      'scsiVerifyErrors',
    ].map((k) => 'metric_' + k),
  ];
  for (const key of keys) {
    assert.equal(typeof de[key], 'string', `Missing German: ${key}`);
    assert.equal(typeof en[key], 'string', `Missing English: ${key}`);
  }
});
