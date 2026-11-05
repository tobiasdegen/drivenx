'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveMacConnections } = require('../../electron/platform/mac-connection-scan.js');
const devices = [
  { name: '/dev/disk0', type: 'nvme' },
  { name: '/dev/disk4', type: 'sat' },
];
const parseInfo = (s) => ({ transport: s });
test('non USB devices never trigger expensive USB inventory', async () => {
  let ioreg = 0,
    profiler = 0;
  const result = await resolveMacConnections(devices, {
    parseInfo,
    getInfo: async () => 'PCI-Express',
    readIoreg: async () => {
      ioreg++;
      return '';
    },
    readProfiler: async () => {
      profiler++;
      return {};
    },
  });
  assert.equal(ioreg, 0);
  assert.equal(profiler, 0);
  assert.equal(result[0].transport, 'PCI-Express');
});
test('mac transport queries run concurrently and only USB triggers inventories', async () => {
  let inflight = 0,
    max = 0,
    ioreg = 0,
    profiler = 0;
  const result = await resolveMacConnections(devices, {
    parseInfo,
    getInfo: async (path) => {
      inflight++;
      max = Math.max(max, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return path.endsWith('4') ? 'USB' : 'PCI-Express';
    },
    readIoreg: async () => {
      ioreg++;
      return '';
    },
    readProfiler: async () => {
      profiler++;
      return { SPUSBDataType: [] };
    },
  });
  assert.equal(max, 2);
  assert.equal(ioreg, 1);
  assert.equal(profiler, 1);
  assert.equal(result[1].transport, 'USB');
  assert.equal(result[1].connection, null);
  assert.equal(result[0].connection, undefined);
});
test('failed optional inventory does not lose verified bus information', async () => {
  const result = await resolveMacConnections([devices[1]], {
    parseInfo,
    getInfo: async () => 'USB',
    readIoreg: async () => {
      throw Error('denied');
    },
    readProfiler: async () => {
      throw Error('unavailable');
    },
  });
  assert.equal(result[0].transport, 'USB');
  assert.equal(result[0].connection, null);
});
test('diskutil info failure preserves disk without inventing a connection', async () => {
  const result = await resolveMacConnections([devices[0]], {
    parseInfo,
    getInfo: async () => {
      throw Error('no rights');
    },
    readIoreg: async () => {
      throw Error('should not run');
    },
    readProfiler: async () => {},
  });
  assert.deepEqual(result, [devices[0]]);
});

test('duplicate smartctl access modes do not repeat macOS diskutil requests', async () => {
  let diskutil = 0,
    ioreg = 0,
    profiler = 0;
  const duplicated = [
    { name: '/dev/disk4', type: 'auto' },
    { name: '/dev/disk4', type: 'sat' },
  ];
  const result = await resolveMacConnections(duplicated, {
    parseInfo,
    getInfo: async () => {
      diskutil++;
      return 'USB';
    },
    readIoreg: async () => {
      ioreg++;
      return '';
    },
    readProfiler: async () => {
      profiler++;
      return { SPUSBDataType: [] };
    },
  });
  assert.equal(diskutil, 1);
  assert.equal(ioreg, 1);
  assert.equal(profiler, 1);
  assert.deepEqual(
    result.map((disk) => disk.type),
    ['auto', 'sat'],
  );
  assert.ok(result.every((disk) => disk.transport === 'USB'));
});

test('macOS USB scan uses the bound WD NVMe media name when SCSI SMART is unavailable', async () => {
  const result = await resolveMacConnections(
    [{ name: '/dev/disk6', type: 'auto', info_name: '/dev/disk6' }],
    {
      parseInfo: () => ({
        transport: 'USB',
        capacityBytes: 500110000000,
        osMetadata: { mediaName: 'USB Storage Device' },
      }),
      getInfo: async () => 'USB',
      readIoreg: async () => '',
      readProfiler: async () => ({
        SPUSBDataType: [
          {
            _name: 'USB Bus',
            _items: [
              {
                _name: 'USB Storage Device',
                manufacturer: 'JMicron',
                _items: [{ _name: 'WD Blue SN580 500GB 2810 Media', bsd_name: 'disk6' }],
              },
            ],
          },
        ],
      }),
    },
  );
  assert.equal(result[0].name, '/dev/disk6');
  assert.equal(result[0].info_name, 'WD Blue SN580 500GB 2810');
  assert.equal(result[0].capacityBytes, 500110000000);
  assert.equal(result[0].connection.verified, true);
});

test('macOS uses a useful diskutil MediaName even without USB-chain support', async () => {
  const result = await resolveMacConnections(
    [{ name: '/dev/disk0', type: 'nvme', info_name: '/dev/disk0' }],
    {
      parseInfo: () => ({
        transport: 'PCI-Express',
        osMetadata: { mediaName: 'APPLE SSD AP0512Z Media' },
      }),
      getInfo: async () => 'PCI-Express',
      readIoreg: async () => {
        throw Error('must not run');
      },
      readProfiler: async () => {
        throw Error('must not run');
      },
    },
  );
  assert.equal(result[0].info_name, 'APPLE SSD AP0512Z');
});
