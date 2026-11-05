'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(ELECTRON_SOURCE_DIR, '..');
const load = () => import(pathToFileURL(path.join(root, 'src/error-log-view.mjs')).href);
const read = (name) => fs.readFileSync(path.join(root, 'src/components', name), 'utf8');

test('ATA error view keeps the extended lifetime count and rows together', async () => {
  const { selectedAtaErrorLog } = await load();
  const report = {
    ata_smart_error_log: {
      extended: { count: 25, logged_count: 0, table: [] },
      summary: { count: 7, table: [{ error_number: 7 }] },
    },
  };
  const result = selectedAtaErrorLog(report);
  assert.equal(result.log, report.ata_smart_error_log.extended);
  assert.deepEqual(result.rows, []);
});

test('ATA error view uses summary only if extended log is unavailable', async () => {
  const { selectedAtaErrorLog } = await load();
  const summary = { count: 3, table: [{ error_number: 2 }] };
  assert.deepEqual(selectedAtaErrorLog({ ata_smart_error_log: { extended: {}, summary } }), {
    log: summary,
    rows: summary.table,
  });
  assert.deepEqual(selectedAtaErrorLog({ ata_smart_error_log: { summary } }).rows, summary.table);
});

test('ATA extended count without detail table cannot silently borrow summary detail rows', async () => {
  const { selectedAtaErrorLog } = await load();
  const result = selectedAtaErrorLog({
    ata_smart_error_log: {
      extended: { count: 42 },
      summary: { count: 20, table: [{ error_number: 20 }] },
    },
  });
  assert.equal(result.log.count, 42);
  assert.deepEqual(result.rows, []);
});

test('malformed smartctl error tables never trigger a map failure', async () => {
  const { readableErrorRows, selectedAtaErrorLog } = await load();
  assert.deepEqual(readableErrorRows(null), []);
  assert.deepEqual(readableErrorRows('wrong shape'), []);
  assert.deepEqual(readableErrorRows({ 0: {} }), []);
  const good = { error_number: 4 };
  assert.deepEqual(readableErrorRows([null, false, 1, [], good, 'bad']), [good]);
  assert.deepEqual(
    selectedAtaErrorLog({ ata_smart_error_log: { extended: { count: 5, table: [null, good] } } })
      .rows,
    [good],
  );
});

test('error count uses the same ATA log as detail rows and never borrows a summary count', async () => {
  const { errorLogCount } = await load();
  assert.equal(errorLogCount({ ata_smart_error_log: { extended: { count: 42 } } }), 42);
  assert.equal(
    errorLogCount({ ata_smart_error_log: { extended: { table: [] }, summary: { count: 7 } } }),
    undefined,
  );
  assert.equal(errorLogCount({ ata_smart_error_log: { summary: { count: 5 } } }), 5);
  assert.equal(errorLogCount({ ata_smart_error_log: { summary: { count: -1 } } }), undefined);
});

test('missing, negative and overflowing SCSI counters are never presented as a known zero', async () => {
  const { errorLogCount } = await load();
  const sample = (read, write, verify) => ({
    scsi_error_counter_log: {
      read: { total_uncorrected_errors: read },
      write: { total_uncorrected_errors: write },
      verify: { total_uncorrected_errors: verify },
    },
  });
  assert.equal(errorLogCount(sample(0, 0, 0)), 0);
  assert.equal(errorLogCount(sample(2, 3, 1)), 6);
  assert.equal(errorLogCount(sample(0, undefined, 0)), undefined);
  assert.equal(errorLogCount(sample(-1, 1, 0)), undefined);
  assert.equal(errorLogCount(sample(Number.MAX_SAFE_INTEGER, 1, 0)), undefined);
  assert.equal(errorLogCount({}), undefined);
});

test('NVMe error-log count preserves genuine zero but rejects unsafe input', async () => {
  const { errorLogCount } = await load();
  const sample = (count) => ({ nvme_smart_health_information_log: { num_err_log_entries: count } });
  assert.equal(errorLogCount(sample(0)), 0);
  assert.equal(errorLogCount(sample(15)), 15);
  assert.equal(errorLogCount(sample(Infinity)), undefined);
  assert.equal(errorLogCount(sample('15')), undefined);
});

test('error and ATA details are snapshot-scoped and expensive ATA preparation is memoized', () => {
  const tabs = read('SmartTabs.tsx');
  const errors = read('tabs/ErrorLogPanel.tsx');
  const hardware = read('tabs/AtaHardwareDetails.tsx');
  const statistics = read('tabs/AtaStatisticsPanel.tsx');
  const driveDisplay = fs.readFileSync(path.join(root, 'src/drive-display.ts'), 'utf8');
  assert.match(tabs, /<div key=\{snapshotKey\} className="hardware-view"/);
  assert.match(tabs, /<SelfTestsPanel\s+key=\{snapshotKey\}/);
  assert.match(tabs, /<ErrorLogPanel key=\{snapshotKey\}/);
  assert.match(errors, /selectedAtaErrorLog\(raw\)/);
  assert.match(errors, /readableErrorRows\(raw\.nvme_error_information_log\?\.table\)/);
  assert.match(hardware, /useMemo\(\(\) => \{/);
  assert.match(statistics, /useMemo\(\(\) => \{/);
  assert.match(driveDisplay, /countDriveErrors = errorLogCount/);
});
