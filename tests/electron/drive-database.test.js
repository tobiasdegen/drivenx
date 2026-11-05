'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DB_SHA256,
  DB_VERSION,
  verifiedDriveDatabase,
  driveProfile,
} = require('../../electron/devices/drive-database.js');
test('bundled upstream database is present and passes fixed SHA-256', () => {
  assert.match(DB_SHA256, /^[a-f0-9]{64}$/);
  assert.ok(verifiedDriveDatabase({ projectRoot: path.resolve(ELECTRON_SOURCE_DIR, '..') }));
});
test('missing database fails closed', () => {
  assert.equal(verifiedDriveDatabase({ projectRoot: '/nonexistent/path' }), null);
});
test('tampered database is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drivenx-db-'));
  try {
    fs.mkdirSync(path.join(dir, 'vendor', 'smartmontools'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'vendor', 'smartmontools', 'drivedb.h'), 'untrusted');
    assert.equal(verifiedDriveDatabase({ projectRoot: dir }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('drive profile does not manufacture a database match or units', () => {
  const a = driveProfile({
    device: { protocol: 'ATA' },
    model_name: 'FUJITSU MJA2160BH G2',
    ata_smart_attributes: { table: [] },
  });
  assert.equal(a.databaseMatch, null);
  assert.equal(a.rawEncoding, 'vendor-specific');
  assert.equal(a.family, null);
  const b = driveProfile({
    model_name: 'Samsung SSD 860 EVO',
    model_family: 'Samsung based SSDs',
    in_smartctl_database: true,
    ata_smart_attributes: { table: [] },
  });
  assert.equal(b.databaseMatch, true);
  assert.equal(b.family, 'Samsung based SSDs');
});

test('database metadata reflects the supplied snapshot', () =>
  assert.equal(DB_VERSION, '7.5/6293 2026-09-09'));

test('database header version matches trusted metadata', () => {
  const data = fs.readFileSync(
    path.join(ELECTRON_SOURCE_DIR, '..', 'vendor', 'smartmontools', 'drivedb.h'),
    'utf8',
  );
  const actual = data.match(/\{\s*"VERSION: ([^"\r\n]+)"/);
  assert.ok(actual, 'drive database must declare its version');
  assert.equal(
    actual[1].split(' ').slice(0, 2).join(' '),
    DB_VERSION.split(' ').slice(0, 2).join(' '),
  );
});
