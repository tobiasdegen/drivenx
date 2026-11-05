'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const history = require('../../electron/data/measurement-history.js');
const report = (serial = 'SN123', time = '2026-10-18T08:00:00.000Z', pending = '0') => ({
  capturedAt: time,
  health: { diagnosis: { domains: { media: 'ok' }, overallAlert: 'ok' } },
  raw: {
    model_name: 'Example HDD',
    serial_number: serial,
    device: { protocol: 'ATA' },
    power_on_time: { hours: 100 },
    ata_smart_attributes: { table: [{ id: 197, raw: { string: pending } }] },
  },
});
test('no stable serial means no history identity', () =>
  assert.equal(history.snapshot(report('')), null));
test('different serial numbers have distinct identity', () =>
  assert.notEqual(history.snapshot(report('A')).id, history.snapshot(report('B')).id));
test('packed vendor values are excluded from numeric comparisons', () =>
  assert.equal(
    history.snapshot(report('SN123', undefined, '19 (1986 14)')).metrics.pendingSectors,
    null,
  ));
test('partial or malformed metrics never cause BigInt conversion errors during snapshot', () => {
  for (const written of [undefined, null, 'invalid', '-1', '3.5', '9007199254740992']) {
    const measured = report();
    measured.metrics = { powerOnHours: 100, ataWrittenBytes: written };
    const entry = history.snapshot(measured);
    assert.equal(entry.metrics.ataWrittenBytes, null);
  }
  const measured = report();
  measured.metrics = { powerOnHours: 100, ataWrittenBytes: '1024' };
  assert.equal(history.snapshot(measured).metrics.ataWrittenBytes, 1024);
});
test('save, retrieve, deduplicate and compute differences', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-history-'));
  try {
    await history.save(dir, report());
    await history.save(dir, report());
    await history.save(dir, report('SN123', '2026-10-19T08:00:00.000Z', '3'));
    const rows = await history.read(dir, history.identity(report().raw));
    assert.equal(rows.length, 2);
    assert.equal(history.deltas(rows).find((x) => x.key === 'pendingSectors').change, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('history rejects calendar dates that Date.parse silently normalizes', () => {
  assert.equal(
    history.validRecord({
      capturedAt: '2026-02-30T10:00:00Z',
      status: 'ok',
      metrics: { powerCycles: 2 },
    }),
    false,
  );
  assert.equal(
    history.validRecord({
      capturedAt: '2026-02-28T10:00:00+01:00',
      status: 'ok',
      metrics: { powerCycles: 2 },
    }),
    true,
  );
});
test('history read rejects traversal and malformed data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-history-'));
  try {
    await assert.rejects(history.read(dir, '../evil'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('historical comparison distinguishes counters, gauges and counter reset', () => {
  const rows = [
    { metrics: { powerOnHours: 150, pendingSectors: 6, wearPercent: 2, mediaErrors: 15 } },
    { metrics: { powerOnHours: 10, pendingSectors: 0, wearPercent: 3, mediaErrors: 17 } },
  ];
  const delta = history.deltas(rows);
  assert.equal(delta.find((x) => x.key === 'powerOnHours').reset, true);
  assert.equal(delta.find((x) => x.key === 'pendingSectors').reset, false);
  assert.equal(delta.find((x) => x.key === 'pendingSectors').change, -6);
  assert.equal(delta.find((x) => x.key === 'mediaErrors').change, 2);
  assert.equal(delta.find((x) => x.key === 'wearPercent').kind, 'gauge');
});
test('unknown and nonnumeric metrics are never compared', () => {
  assert.deepEqual(
    history.deltas([
      { metrics: { vendorCode: 3, powerCycles: 1 } },
      { metrics: { vendorCode: 6, powerCycles: null } },
    ]),
    [],
  );
});

test('history rejects malformed or unrecognized measurements instead of silently dropping them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-corrupt-'));
  try {
    const id = history.identity(report().raw),
      folder = path.join(dir, 'history');
    await fs.mkdir(folder);
    await fs.writeFile(
      path.join(folder, `${id}.json`),
      JSON.stringify([
        { capturedAt: '2026-10-18T10:00:00Z', status: 'ok', metrics: { powerCycles: -5 } },
      ]),
    );
    await assert.rejects(history.read(dir, id), /Ungültige Messhistorie/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('history rejects metrics outside explicit registry', () => {
  assert.equal(
    history.validRecord({
      capturedAt: '2026-10-18T10:00:00Z',
      status: 'ok',
      metrics: { vendorRaw: 99 },
    }),
    false,
  );
});
test('deltas compare chronological records even with unsorted input', () => {
  const earlier = { capturedAt: '2026-10-17T10:00:00Z', metrics: { powerCycles: 4 } };
  const later = { capturedAt: '2026-10-18T10:00:00Z', metrics: { powerCycles: 8 } };
  assert.equal(history.deltas([later, earlier])[0].change, 4);
});

test('simultaneous saves for one drive do not overwrite each other', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-concurrent-'));
  try {
    const times = Array.from({ length: 12 }, (_, n) =>
      new Date(Date.UTC(2026, 9, 18, 8, n)).toISOString(),
    );
    await Promise.all(times.map((time) => history.save(dir, report('SN123', time))));
    const rows = await history.read(dir, history.identity(report().raw));
    assert.equal(rows.length, times.length);
    assert.deepEqual(
      rows.map((row) => row.capturedAt),
      times,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('symlinked history file is not read or overwritten', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-symlink-'));
  try {
    const folder = path.join(dir, 'history');
    await fs.mkdir(folder);
    const destination = path.join(dir, 'sentinel.json');
    await fs.writeFile(destination, 'DO-NOT-TOUCH');
    const link = path.join(folder, history.identity(report().raw) + '.json');
    try {
      await fs.symlink(destination, link);
    } catch (e) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(e.code)) {
        t.skip('Symlinks not permitted');
        return;
      }
      throw e;
    }
    await assert.rejects(history.read(dir, history.identity(report().raw)), /Dateityp/);
    await assert.rejects(history.save(dir, report()), /Dateityp/);
    assert.equal(await fs.readFile(destination, 'utf8'), 'DO-NOT-TOUCH');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('deltas never mutate caller record ordering', () => {
  const later = { capturedAt: '2026-10-19T00:00:00Z', metrics: { powerCycles: 9 } };
  const earlier = { capturedAt: '2026-10-18T00:00:00Z', metrics: { powerCycles: 7 } };
  const input = [later, earlier];
  assert.equal(history.deltas(input)[0].change, 2);
  assert.equal(input[0], later);
});

test('generic USB bridge serial placeholders are not persistent identities', () => {
  for (const serial of [
    '00000000',
    'FFFFFFFF',
    'Unknown',
    'N/A',
    'To Be Filled By O.E.M.',
    'Default String',
    '   ',
    '----',
  ]) {
    assert.equal(history.identity(report(serial).raw), null, serial);
  }
  assert.ok(history.identity(report('S3Z9NX0R123456A').raw));
});
test('same device identity is independent of transport-specific drive paths', () => {
  const first = report().raw,
    second = structuredClone(first);
  first.device.name = '/dev/disk4';
  second.device.name = '/dev/disk8';
  assert.equal(history.identity(first), history.identity(second));
});
test('symlinked history directory is refused for both reading and writing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-history-parent-'));
  try {
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    const link = path.join(root, 'history');
    try {
      await fs.symlink(outside, link, 'dir');
    } catch (e) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(e.code)) {
        t.skip('Symlinks not permitted');
        return;
      }
      throw e;
    }
    const id = history.identity(report().raw);
    await assert.rejects(history.read(root, id), /Messhistorien-Ordner/);
    await assert.rejects(history.save(root, report()), /Messhistorien-Ordner/);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('one disk keeps its identity when connection protocol or USB bridge changes', () => {
  const original = report('WD-02N12345').raw;
  const usb = structuredClone(original);
  usb.device = { name: '/dev/sdd', protocol: 'SCSI', type: 'sat' };
  const nvmePresentation = structuredClone(original);
  nvmePresentation.device = { name: '/dev/nvme0', protocol: 'NVMe' };
  nvmePresentation.nvme_smart_health_information_log = {};
  assert.equal(history.identity(original), history.identity(usb));
  assert.equal(history.identity(original), history.identity(nvmePresentation));
});
test('identity normalizes benign whitespace and casing, not actual identifiers', () => {
  const raw = report(' abC-123 ').raw;
  const normalized = structuredClone(raw);
  normalized.model_name = '  example   hdd  ';
  normalized.serial_number = 'ABC-123';
  assert.equal(history.identity(raw), history.identity(normalized));
  assert.notEqual(history.identity(raw), history.identity(report('ABC-124').raw));
  assert.notEqual(history.identity(raw), history.identity({ ...raw, model_name: 'Different HDD' }));
});
test('generic USB bridge device identifiers cannot merge different disks', () => {
  for (const model of [
    'USB DISK',
    'Generic',
    'Mass Storage',
    'Storage Device',
    'External USB',
    'Bridge',
  ]) {
    assert.equal(history.identity({ ...report('AA123456').raw, model_name: model }), null, model);
  }
  for (const serial of ['Serial Number', 'Default String', 'No Serial']) {
    assert.equal(history.identity(report(serial).raw), null, serial);
  }
});
test('history saved via ATA presentation is retrieved over USB presentation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-transport-'));
  try {
    const before = report('WD-02N12345');
    await history.save(dir, before);
    const after = report('WD-02N12345', '2026-10-19T08:00:00.000Z', '2');
    after.raw.device = { protocol: 'SCSI', type: 'sat', name: '/dev/sdd' };
    await history.save(dir, after);
    const rows = await history.read(dir, history.identity(before.raw));
    assert.equal(rows.length, 2);
    assert.equal(history.deltas(rows).find((x) => x.key === 'pendingSectors').change, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('history excludes vendor encoded sector and power-cycle raw values consistently', () => {
  const reportData = report('P3-SN', '2026-10-18T10:00:00Z', '3 (4 5)');
  reportData.raw.ata_smart_attributes.table.push(
    { id: 198, raw: { string: '4294967296', value: 4294967296 } },
    { id: 12, raw: { string: '2', value: 8589934594 } },
  );
  const metrics = history.snapshot(reportData).metrics;
  assert.equal(metrics.pendingSectors, null);
  assert.equal(metrics.offlineUncorrectable, null);
  assert.equal(metrics.powerCycles, null);
  assert.equal(metrics.powerOnHours, 100);
});
test('history preserves legitimate plain ATA metrics and rejects missing raw.string', () => {
  const r = report('P3-COUNT', '2026-10-18T10:00:00Z', '2');
  r.raw.ata_smart_attributes.table.push(
    { id: 12, raw: { string: '22', value: 22 } },
    { id: 198, raw: { value: 7 } },
  );
  const metrics = history.snapshot(r).metrics;
  assert.equal(metrics.pendingSectors, 2);
  assert.equal(metrics.powerCycles, 22);
  assert.equal(metrics.offlineUncorrectable, null);
});
test('NVMe safe integer counters stay comparable while overflow is unknown', () => {
  const r = report('P3-NVME');
  r.raw.nvme_smart_health_information_log = {
    power_on_hours: '1234',
    power_cycles: '42',
    percentage_used: 12,
    media_errors: '9007199254740992',
    available_spare: 99,
  };
  const metrics = history.snapshot(r).metrics;
  assert.equal(metrics.powerOnHours, 1234);
  assert.equal(metrics.powerCycles, 42);
  assert.equal(metrics.wearPercent, 12);
  assert.equal(metrics.mediaErrors, null);
  assert.equal(metrics.availableSparePercent, 99);
});

test('NVMe history stores raw 512000-byte data units and error counters without assuming TB', () => {
  const r = report('NVME1');
  r.raw.device = { protocol: 'NVMe' };
  r.raw.nvme_smart_health_information_log = {
    power_cycles: 55,
    power_on_hours: 100,
    percentage_used: 2,
    data_units_read: 1953125,
    data_units_written: 123456,
    media_errors: 0,
    num_err_log_entries: 189,
    unsafe_shutdowns: 96,
  };
  const item = history.snapshot(r);
  assert.equal(item.metrics.nvmeReadUnits, 1953125);
  assert.equal(item.metrics.nvmeWrittenUnits, 123456);
  assert.equal(item.metrics.nvmeErrorLogEntries, 189);
  assert.equal(item.metrics.unsafeShutdowns, 96);
  assert.equal(item.metrics.powerCycles, 55);
  assert.equal(
    history.validRecord({ capturedAt: r.capturedAt, status: 'ok', metrics: item.metrics }),
    true,
  );
});

test('NVMe history keys compare safely when some optional metrics are absent', () => {
  const rows = [
    { metrics: { nvmeReadUnits: 1953125, nvmeWrittenUnits: 50, unsafeShutdowns: 4 } },
    { metrics: { nvmeReadUnits: 1954125, nvmeWrittenUnits: 52, unsafeShutdowns: 4 } },
  ];
  assert.equal(history.deltas(rows).find((x) => x.key === 'nvmeReadUnits').change, 1000);
  assert.equal(history.deltas(rows).find((x) => x.key === 'unsafeShutdowns').change, 0);
  assert.equal(
    history.validRecord({
      capturedAt: '2026-10-18T08:00:00Z',
      status: 'ok',
      metrics: { powerCycles: 3 },
    }),
    true,
  );
});

test('ATA reallocation history excludes opaque values and captures plain counts', () => {
  const r = report();
  r.raw.ata_smart_attributes.table.push({ id: 5, raw: { string: '19 (1986 14)', value: 19 } });
  assert.equal(history.snapshot(r).metrics.reallocatedSectors, null);
  r.raw.ata_smart_attributes.table.at(-1).raw = { string: '3', value: 3 };
  assert.equal(history.snapshot(r).metrics.reallocatedSectors, 3);
});

test('SCSI/SAS history stores separate corrected-agnostic error counters', () => {
  const r = report();
  r.raw.device = { protocol: 'SCSI' };
  r.raw.scsi_error_counter_log = {
    read: { total_uncorrected_errors: 7 },
    write: { total_uncorrected_errors: 0 },
    verify: { total_uncorrected_errors: 2 },
  };
  const result = history.snapshot(r);
  assert.equal(result.metrics.scsiReadErrors, 7);
  assert.equal(result.metrics.scsiWriteErrors, 0);
  assert.equal(result.metrics.scsiVerifyErrors, 2);
  assert.equal(
    history.validRecord({ capturedAt: r.capturedAt, status: 'ok', metrics: result.metrics }),
    true,
  );
});

test('history identity rejects repeated and anonymized serials, consistent with self-tests', () => {
  for (const serial of ['1234567890', 'AAAAAAAA', 'ANONYMIZED', 'To Be Filled By O.E.M.']) {
    assert.equal(history.identity(report(serial).raw), null, serial);
    assert.equal(history.reliableSerial(serial), false, serial);
  }
});
test('same serial and model but different known capacity never share a history', () => {
  const first = { ...report('ABCD-2026').raw, user_capacity: { bytes: 1_000_000 } };
  const second = { ...first, user_capacity: { bytes: 2_000_000 } };
  assert.notEqual(history.identity(first), history.identity(second));
});
test('WWN fallback works without serial; optional WWN does not split serial-based history', () => {
  const withoutSerial = { ...report('').raw, wwn: { naa: 5, oui: 123, id: 456 } };
  assert.ok(history.identity(withoutSerial));
  assert.notEqual(
    history.identity(withoutSerial),
    history.identity({
      ...withoutSerial,
      wwn: { naa: 5, oui: 123, id: 789 },
    }),
  );
  const withSerial = report('RELIABLE-001').raw;
  assert.equal(
    history.identity(withSerial),
    history.identity({
      ...withSerial,
      wwn: { naa: 5, oui: 123, id: 456 },
    }),
  );
});
test('multiple NVMe namespaces require an explicit matching namespace identifier', () => {
  const r = {
    ...report('NVME-ABC-2026').raw,
    nvme_namespaces: [
      { id: 1, size: { bytes: 1_000_000 } },
      { id: 2, size: { bytes: 1_000_000 } },
    ],
  };
  assert.equal(history.identity(r), null);
  assert.notEqual(
    history.identity({ ...r, nvme_namespace_id: 1 }),
    history.identity({ ...r, nvme_namespace_id: 2 }),
  );
  assert.equal(history.identity({ ...r, nvme_namespace_id: 3 }), null);
});

test('explicit NVMe namespace ID disambiguates even without a complete namespace list', () => {
  const raw = report('NVME-ABC-2026').raw;
  assert.notEqual(
    history.identity({ ...raw, nvme_namespace_id: 1 }),
    history.identity({ ...raw, nvme_namespace_id: 2 }),
  );
});

test('concurrent backup import and automatic measurement saving retain both results', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-import-save-'));
  try {
    const before = report('CONCURRENT-123', '2026-10-18T08:00:00.000Z', '0');
    const after = report('CONCURRENT-123', '2026-10-18T09:00:00.000Z', '1');
    const id = history.identity(before.raw);
    const backup = history.exportBackup(id, [
      {
        capturedAt: before.capturedAt,
        status: 'ok',
        metrics: history.snapshot(before).metrics,
      },
    ]);
    await Promise.all([history.importBackup(dir, id, backup), history.save(dir, after)]);
    assert.deepEqual(
      (await history.read(dir, id)).map((row) => row.capturedAt),
      [before.capturedAt, after.capturedAt],
    );
    await Promise.all([history.save(dir, after), history.importBackup(dir, id, backup)]);
    assert.equal((await history.read(dir, id)).length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('automatic history does not persist a snapshot revoked before its queued write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-stale-history-'));
  try {
    let current = true;
    const pending = history.save(dir, report(), () => current);
    current = false;
    await assert.rejects(pending, (err) => err.code === 'STALE_DIAGNOSIS');
    assert.deepEqual(await history.read(dir, history.identity(report().raw)), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('history import does not modify a disk after the selected snapshot was revoked', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-stale-import-'));
  try {
    const id = history.identity(report().raw);
    const backup = history.exportBackup(id, [
      { capturedAt: '2026-10-18T08:00:00Z', status: 'ok', metrics: { powerCycles: 10 } },
    ]);
    let current = true;
    const pending = history.importBackup(dir, id, backup, () => current);
    current = false;
    await assert.rejects(pending, (err) => err.code === 'STALE_DIAGNOSIS');
    assert.deepEqual(await history.read(dir, id), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('history save refuses snapshot revocation at its last atomic commit boundary', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-history-revoked-'));
  try {
    await history.save(dir, report());
    const id = history.identity(report().raw);
    const before = await history.read(dir, id);
    let checks = 0;
    await assert.rejects(
      history.save(dir, report('SN123', '2026-10-19T08:00:00.000Z'), () => {
        checks++;
        return checks < 4;
      }),
      (error) => error.code === 'STALE_DIAGNOSIS',
    );
    assert.ok(checks >= 4, 'the last check must be after writing the staged file');
    assert.deepEqual(await history.read(dir, id), before);
    assert.deepEqual(await fs.readdir(path.join(dir, 'history')), [`${id}.json`]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('history import uses the same pre-commit revocation guard as save', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-history-import-revoked-'));
  try {
    await history.save(dir, report());
    const id = history.identity(report().raw);
    const before = await history.read(dir, id);
    const entry = history.snapshot(report('SN123', '2026-10-20T08:00:00.000Z'));
    const backup = history.exportBackup(id, [
      { capturedAt: entry.capturedAt, status: entry.status, metrics: entry.metrics },
    ]);
    let checks = 0;
    await assert.rejects(
      history.importBackup(dir, id, backup, () => ++checks < 4),
      (error) => error.code === 'STALE_DIAGNOSIS',
    );
    assert.ok(checks >= 4);
    assert.deepEqual(await history.read(dir, id), before);
    assert.deepEqual(await fs.readdir(path.join(dir, 'history')), [`${id}.json`]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('invalid diagnostic state is rejected rather than written to history', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-history-normalized-'));
  try {
    const input = report('NORM-DEVICE', '2026-10-25T12:00:00Z');
    input.health.diagnosis.overallAlert = 'unexpected-vendor-status';
    input.metrics = { powerOnHours: undefined, powerCycles: -1, wearPercent: 7.5 };
    const captured = history.snapshot(input);
    assert.equal(captured, null);
    await assert.rejects(history.save(dir, input), /Messhistorie benötigt/);
    input.health.diagnosis.overallAlert = 'ok';
    const valid = history.snapshot(input);
    assert.equal(valid.metrics.powerOnHours, null);
    assert.equal(valid.metrics.powerCycles, null);
    assert.equal(valid.metrics.wearPercent, null);
    await history.save(dir, input);
    const records = await history.read(dir, history.identity(input.raw));
    assert.equal(records[0].status, 'ok');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('import rejects invalid backup shapes without touching existing measurements', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-history-invalid-backup-'));
  try {
    const input = report('BACKUP-DEVICE');
    await history.save(dir, input);
    const id = history.identity(input.raw);
    const before = await history.read(dir, id);
    for (const bad of [null, 5, {}, { schema: 'drivenx.history.v1', id, records: [{}] }]) {
      await assert.rejects(history.importBackup(dir, id, bad), /ungültig/);
    }
    assert.deepEqual(await history.read(dir, id), before);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('history import snapshots validated caller records before asynchronous file access', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-history-copy-backup-'));
  try {
    const input = report('COPY-DEVICE');
    const id = history.identity(input.raw);
    const extra = {
      capturedAt: '2026-10-24T12:00:00.000Z',
      status: 'ok',
      metrics: { powerCycles: 7 },
    };
    const backup = { schema: 'drivenx.history.v1', id, records: [extra] };
    const importing = history.importBackup(dir, id, backup);
    extra.metrics.powerCycles = 999;
    backup.records.push({
      capturedAt: '2026-10-25T12:00:00Z',
      status: 'critical',
      metrics: { powerCycles: 22 },
    });
    await importing;
    const records = await history.read(dir, id);
    assert.equal(records.length, 1);
    assert.equal(records[0].metrics.powerCycles, 7);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('noncanonical numeric strings in history backups are rejected', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-history-types-'));
  try {
    const id = history.identity(report('NUMERIC-STRICT').raw);
    const records = [
      { capturedAt: '2026-10-21T12:00:00Z', status: 'ok', metrics: { powerCycles: '12' } },
    ];
    await fs.mkdir(path.join(dir, 'history'));
    await fs.writeFile(path.join(dir, 'history', `${id}.json`), JSON.stringify(records));
    await assert.rejects(history.read(dir, id), /Ungültige Messhistorie/);
    assert.throws(() => history.exportBackup(id, records), /ungültig/);
    await assert.rejects(
      history.importBackup(dir, id, {
        schema: 'drivenx.history.v1',
        id,
        records,
      }),
      /ungültig/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('history imports reject unrecognized schema identifiers', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drivenx-invalid-schema-'));
  try {
    const id = history.identity(report('SCHEMA-TEST').raw);
    const records = [
      { capturedAt: '2026-10-24T12:00:00Z', status: 'ok', metrics: { powerCycles: 6 } },
    ];
    const backup = { schema: 'unknown.history.v1', id, records };
    await assert.rejects(history.importBackup(dir, id, backup), /ungültig/);
    await fs.mkdir(path.join(dir, 'history', '_Backups'), { recursive: true });
    await fs.writeFile(path.join(dir, 'history', '_Backups', `${id}.json`), JSON.stringify(backup));
    await assert.rejects(history.readLocalBackup(dir, id), /Ungültige lokale Historien-Sicherung/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
