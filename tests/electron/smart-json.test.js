'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSmartctlJson } = require('../../electron/devices/smart-json.js');
const fs = require('node:fs');
const path = require('node:path');

test('valid smartctl JSON, scan and vendor fields are preserved', () => {
  for (const value of [
    { smartctl: { exit_status: 0 }, devices: [] },
    {
      smartctl: { exit_status: 4 },
      ata_smart_attributes: { table: [{ id: 197, raw: { string: '0' } }] },
      vendor_extra: [1, 2],
    },
    { smartctl: { exit_status: 0 }, nvme_self_test_log: { table: [] } },
  ])
    assert.equal(validateSmartctlJson(value), value);
});

test('reject JSON scalar and arrays as whole smartctl reports', () => {
  for (const v of [null, undefined, 'ok', 5, false, [], [{ device: {} }]])
    assert.throws(() => validateSmartctlJson(v), /kein JSON-Objekt/);
});

test('reject malformed known log and attribute structures, allow absent fields', () => {
  const bad = [
    { smartctl: [] },
    { devices: { name: 'no' } },
    { devices: [null] },
    { smartctl: { messages: 'oops' } },
    { smartctl: { messages: [null] } },
    { nvme_smart_health_information_log: { temperature_sensors: 'bad' } },
    { ata_smart_attributes: { table: {} } },
    { ata_smart_attributes: { table: [null] } },
    { ata_smart_self_test_log: { standard: { table: 'wrong' } } },
    { ata_smart_error_log: { summary: { table: [42] } } },
    { nvme_self_test_log: { table: [false] } },
    { nvme_error_information_log: { table: 'not-a-table' } },
    { scsi_self_test_log: { standard: [] } },
  ];
  for (const value of bad) assert.throws(() => validateSmartctlJson(value), /ungültig/);
  assert.deepEqual(validateSmartctlJson({ ata_smart_attributes: null }), {
    ata_smart_attributes: null,
  });
});

test('real stored SMART fixtures remain accepted', () => {
  const dir = path.join(ELECTRON_SOURCE_DIR, '..', 'fixtures', 'device-tests');
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const json = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
    assert.doesNotThrow(() => validateSmartctlJson(json), entry.name);
  }
});

test('extended ATA error and self-test logs are validated without dropping vendor fields', () => {
  const { validateSmartctlJson } = require('../../electron/devices/smart-json.js');
  const extended = {
    smartctl: { exit_status: 4 },
    ata_smart_error_log: { extended: { count: 1, table: [{ error_number: 1 }] } },
    ata_smart_self_test_log: { extended: { table: [{ status: { passed: true } }] } },
    sata_phy_event_counters: { table: [{ id: 1, value: 2 }] },
    vendor_specific: { x: 42 },
  };
  assert.strictEqual(validateSmartctlJson(extended), extended);
  assert.throws(
    () => validateSmartctlJson({ ata_smart_error_log: { extended: { table: 'invalid' } } }),
    /extended.table/,
  );
  assert.throws(
    () => validateSmartctlJson({ ata_smart_self_test_log: { extended: [] } }),
    /extended/,
  );
});
