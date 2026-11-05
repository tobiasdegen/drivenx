'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  possibleWindowsAliases,
  physicalFingerprint,
  findWindowsNvmeAliases,
} = require('../../electron/devices/scan-aliases.js');

function raw(serial, namespace = 1, name = '/dev/sda') {
  return {
    device: { name, type: 'nvme', protocol: 'NVMe' },
    model_name: 'Samsung SSD 970 EVO Plus 1TB',
    serial_number: serial,
    user_capacity: { bytes: 1000204886016 },
    nvme_controller_id: 4,
    nvme_namespaces: [
      { id: namespace, size: { bytes: 1000204886016 }, eui64: { oui: 9528, ext_id: 347913455844 } },
    ],
  };
}
const sd = { name: '/dev/sda', type: 'nvme' };
const nv = { name: '/dev/nvme0', type: 'nvme' };

test('probe NVMe aliases only if both Windows path families exist', () => {
  assert.deepEqual(possibleWindowsAliases([sd, nv]), [sd, nv]);
  assert.deepEqual(possibleWindowsAliases([sd, { name: '/dev/sdb', type: 'nvme' }]), []);
  assert.deepEqual(possibleWindowsAliases([sd, { name: '/dev/nvme0', type: 'sat' }]), []);
  assert.deepEqual(possibleWindowsAliases([{ name: '/dev/sda', type: 'sat' }, nv]), []);
});
test('same physical NVMe identity collapses sd and nvme paths', async () => {
  const groups = await findWindowsNvmeAliases([sd, nv], async (d) =>
    raw('S4EWNJ0N-TEST01', 1, d.name),
  );
  assert.deepEqual(groups, [[sd, nv]]);
});
test('NVMe counters or utilization differing between probes do not affect identity', () => {
  const a = raw('S4EWNJ0N-TEST01');
  const b = raw('S4EWNJ0N-TEST01', 1, '/dev/nvme0');
  b.nvme_namespaces[0].utilization = { bytes: 746732199936 };
  b.nvme_smart_health_information_log = { data_units_read: 94563915 };
  assert.equal(physicalFingerprint(a), physicalFingerprint(b));
});
test('identical model and capacity with different serials are not collapsed', async () => {
  assert.deepEqual(
    await findWindowsNvmeAliases([sd, nv], async (d) =>
      raw(d.name === sd.name ? 'SERIAL123' : 'SERIAL456'),
    ),
    [],
  );
});
test('distinct NVMe namespaces on one controller remain separate drives', async () => {
  assert.deepEqual(
    await findWindowsNvmeAliases([sd, nv], async (d) =>
      raw('SERIAL123', d.name === sd.name ? 1 : 2),
    ),
    [],
  );
});
test('missing serial or namespace evidence means retaining both devices', async () => {
  assert.equal(physicalFingerprint({ ...raw(''), nvme_namespaces: [] }), null);
  assert.deepEqual(
    await findWindowsNvmeAliases([sd, nv], async (d) =>
      d.name === sd.name ? raw('SERIAL123') : { ...raw('SERIAL123'), nvme_namespaces: [] },
    ),
    [],
  );
});
test('a failed smartctl identity probe leaves all devices visible', async () => {
  assert.deepEqual(
    await findWindowsNvmeAliases([sd, nv], async (d) => {
      if (d.name === sd.name) throw new Error('unable to read');
      return raw('SERIAL123');
    }),
    [],
  );
});
test('serial matches are not enough without model and capacity agreement', () => {
  const a = raw('SERIAL123');
  assert.notEqual(physicalFingerprint(a), physicalFingerprint({ ...a, model_name: 'Other SSD' }));
  assert.notEqual(
    physicalFingerprint(a),
    physicalFingerprint({ ...a, user_capacity: { bytes: 512000000000 } }),
  );
});
