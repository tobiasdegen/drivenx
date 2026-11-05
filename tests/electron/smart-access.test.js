'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSmartAccess } = require('../../electron/devices/smart-access.js');

test('only fixed SMART detail arguments are permitted', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice(d) {
      if (d.name !== '/dev/sda') throw Error('unknown');
      return { name: '/dev/sda', type: 'nvme' };
    },
    runSmart(args, timeout) {
      calls.push({ args, timeout });
      return Promise.resolve({ json: {}, exitCode: 0 });
    },
  });
  await gateway.detail({ name: '/dev/sda', type: 'nvme', extra: '--erase' });
  assert.deepEqual(calls[0], { args: ['-a', '-j', '-d', 'nvme', '/dev/sda'], timeout: 25000 });
  assert.throws(() => gateway.detail({ name: '/dev/sdb', type: 'nvme' }), /unknown/);
});

test('self-test type is strictly whitelisted', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (args) => {
      calls.push(args);
      return {};
    },
  });
  assert.throws(
    () => gateway.startTest({ name: '/dev/sda', type: 'nvme' }, 'abort'),
    /Nicht unterstützter/,
  );
  await gateway.startTest({ name: '/dev/sda', type: 'nvme' }, 'short');
  assert.deepEqual(calls, [['-t', 'short', '-j', '-d', 'nvme', '/dev/sda']]);
});

test('gateway rejects missing authorization dependencies', () => {
  assert.throws(
    () => createSmartAccess({ runSmart: () => {} }),
    /Autorisation|autorisation|Geräteautorisation/i,
  );
});

test('SAT read without health data falls back to autodetection', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (args) => {
      calls.push(args);
      return args[3] === 'auto'
        ? {
            json: {
              model_name: 'Samsung SSD 860 EVO',
              ata_smart_attributes: { table: [{ id: 9 }] },
            },
            exitCode: 0,
          }
        : {
            json: {
              smartctl: { messages: [{ severity: 'error', string: 'SAT passthrough failed' }] },
            },
            exitCode: 2,
          };
    },
  });
  const result = await gateway.detail({ name: '/dev/sdb', type: 'sat' });
  assert.equal(result.json.model_name, 'Samsung SSD 860 EVO');
  assert.deepEqual(
    calls.map((args) => args[3]),
    ['sat', 'sat', 'auto'],
  );
  assert.deepEqual(
    calls.map((args) => args[4]),
    ['/dev/sdb', '/dev/sdb', '/dev/sdb'],
  );
});

test('SAT falls back to 12-byte standard command if autodetection fails', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (args) => {
      calls.push(args[3]);
      if (args[3] === 'sat,12') return { json: { smart_status: { passed: true } }, exitCode: 0 };
      return { json: { smartctl: { exit_status: 2 } }, exitCode: 2 };
    },
  });
  assert.equal(
    (await gateway.detail({ name: '/dev/sdb', type: 'sat' })).json.smart_status.passed,
    true,
  );
  assert.deepEqual(calls, ['sat', 'sat', 'auto', 'sat,12']);
});

test('already usable SAT read keeps its original health and never retries', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (args) => {
      calls.push(args[3]);
      return { json: { smart_status: { passed: false } }, exitCode: 8 };
    },
  });
  assert.equal(
    (await gateway.detail({ name: '/dev/sdb', type: 'sat' })).json.smart_status.passed,
    false,
  );
  assert.deepEqual(calls, ['sat']);
});

test('SAT retry does not disguise SMART failure exit bits or unknown data', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (args) => {
      calls.push(args[3]);
      return {
        json: { smartctl: { messages: [{ severity: 'error', string: 'failed' }] } },
        exitCode: 8,
      };
    },
  });
  assert.equal((await gateway.detail({ name: '/dev/sdb', type: 'sat' })).exitCode, 8);
  assert.deepEqual(calls, ['sat']);
});

test('SAT retry does not hide the first failed diagnostic result', async () => {
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (args) => {
      if (args[3] === 'sat')
        return {
          json: { smartctl: { messages: [{ severity: 'error', string: 'initial error' }] } },
          exitCode: 2,
        };
      throw new Error('another transport failed');
    },
  });
  const result = await gateway.detail({ name: '/dev/sdb', type: 'sat' });
  assert.match(result.json.smartctl.messages[0].string, /initial error/);
});

test('a permission failure is not bypassed with alternative SAT commands', async () => {
  let calls = 0;
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async () => {
      calls++;
      const error = new Error('Access denied');
      error.code = 'permission';
      throw error;
    },
  });
  await assert.rejects(gateway.detail({ name: '/dev/sdb', type: 'sat' }), /Access denied/);
  assert.equal(calls, 1);
});

test('SAT recovery only affects detail reads and never changes self-test commands', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (args) => {
      calls.push(args);
      return { json: {}, exitCode: 0 };
    },
  });
  await gateway.startTest({ name: '/dev/sdb', type: 'sat' }, 'short');
  assert.deepEqual(calls, [['-t', 'short', '-j', '-d', 'sat', '/dev/sdb']]);
});

test('autodetected SCSI health from a USB bridge does not masquerade as SATA health', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (args) => {
      calls.push(args[3]);
      if (args[3] === 'auto')
        return {
          json: { device: { protocol: 'SCSI' }, smart_status: { passed: true } },
          exitCode: 0,
        };
      if (args[3] === 'sat,12')
        return {
          json: { device: { protocol: 'ATA' }, smart_status: { passed: true } },
          exitCode: 0,
        };
      return { json: { smartctl: { exit_status: 2 } }, exitCode: 2 };
    },
  });
  const result = await gateway.detail({ name: '/dev/sdb', type: 'sat' });
  assert.equal(result.json.device.protocol, 'ATA');
  assert.deepEqual(calls, ['sat', 'sat', 'auto', 'sat,12']);
});

test('non-SAT devices never use the SAT-only recovery', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (args) => {
      calls.push(args[3]);
      return { json: {}, exitCode: 2 };
    },
  });
  await gateway.detail({ name: '/dev/nvme0', type: 'nvme' });
  assert.deepEqual(calls, ['nvme']);
});

test('SAT failure without JSON can recover with a verified ATA report', async () => {
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (args) => {
      if (args[3] === 'sat') throw new Error('invalid smartctl output');
      return {
        json: {
          device: { protocol: 'ATA' },
          model_name: 'Samsung SSD 860 EVO',
          smart_status: { passed: true },
        },
        exitCode: 0,
      };
    },
  });
  assert.equal(
    (await gateway.detail({ name: '/dev/sdb', type: 'sat' })).json.model_name,
    'Samsung SSD 860 EVO',
  );
});

test('SAT timeouts are never multiplied by automatic retries', async () => {
  let calls = 0;
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async () => {
      calls++;
      const error = new Error('timed out');
      error.code = 'timeout';
      throw error;
    },
  });
  await assert.rejects(gateway.detail({ name: '/dev/sdb', type: 'sat' }), /timed out/);
  assert.equal(calls, 1);
});

test('Windows access denied embedded in smartctl JSON does not trigger SAT retries', async () => {
  const calls = [];
  const raw = {
    smartctl: {
      exit_status: 2,
      messages: [
        {
          severity: 'error',
          string:
            'Smartctl open device /dev/sdb [SAT] failed: \\\\.\\PhysicalDrive1: Open failed, Error=5',
        },
      ],
    },
  };
  const gateway = createSmartAccess({
    assertDevice: (d) => d,
    runSmart: async (args) => {
      calls.push(args[3]);
      if (args[3] !== 'sat') throw Error('Permission failure must not retry');
      return { json: raw, exitCode: 2 };
    },
  });
  assert.equal((await gateway.detail({ name: '/dev/sdb', type: 'sat' })).json, raw);
  assert.deepEqual(calls, ['sat']);
});

test('NVMe USB bridge keeps its smartctl-discovered sntjmicron type for diagnostics', async () => {
  const calls = [];
  const gateway = createSmartAccess({
    assertDevice: (device) => device,
    runSmart: async (args) => {
      calls.push(args);
      return {
        json: {
          device: { protocol: 'NVMe' },
          nvme_smart_health_information_log: { media_errors: 0 },
        },
        exitCode: 0,
      };
    },
  });
  await gateway.detail({ name: '/dev/sdb', type: 'sntjmicron' });
  assert.deepEqual(calls, [['-x', '-j', '-d', 'sntjmicron', '/dev/sdb']]);
});
