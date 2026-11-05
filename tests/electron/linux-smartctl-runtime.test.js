'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('packaged Linux uses distribution smartctl without an inaccessible AppImage DriveDB', async () => {
  const file = path.join(ELECTRON_SOURCE_DIR, 'devices/smart.js');
  const regularRequire = createRequire(file);
  const calls = [];
  const module = { exports: {} };
  const requireFromTest = (specifier) => {
    if (specifier === 'electron') return { app: { isPackaged: true } };
    if (specifier === '../platform/linux-smartctl.js') {
      return {
        SMARTCTL_PATHS: ['/usr/bin/smartctl'],
        needsRootAccess: () => true,
        findTrustedExecutable: async () => '/usr/bin/smartctl',
        linuxSmartInvocation: async (binary, args) => ({
          executable: '/usr/bin/pkexec',
          args: ['--disable-internal-agent', binary, ...args],
        }),
      };
    }
    if (specifier === '../platform/linux-smart-session.js') {
      return { linuxSmartSession: { available: async () => false } };
    }
    if (specifier === './drive-database.js') {
      return {
        verifiedDriveDatabaseAsync: () => {
          throw new Error('Linux must not resolve AppImage DriveDB');
        },
      };
    }
    if (specifier === './smart-process.js') {
      return {
        runSmartProcess: async (binary, args) => {
          calls.push({ binary, args });
          return { json: { smartctl: {} }, exitCode: 0 };
        },
      };
    }
    if (specifier === '../data/query-log.js') {
      return { sessionQueryLog: { track: async (_, callback) => callback() } };
    }
    return regularRequire(specifier);
  };
  vm.runInNewContext(
    fs.readFileSync(file, 'utf8'),
    {
      require: requireFromTest,
      module,
      exports: module.exports,
      ELECTRON_SOURCE_DIR,
      __filename: file,
      process: { platform: 'linux', arch: 'x64', resourcesPath: '/tmp/appimage' },
    },
    { filename: file },
  );
  const resolved = await module.exports.lookupBinaryAsync();
  assert.equal(resolved.binary, '/usr/bin/smartctl');
  await module.exports.runSmart(['-a', '-j', '/dev/sda']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].binary, '/usr/bin/pkexec');
  assert.deepEqual(Array.from(calls[0].args), [
    '--disable-internal-agent',
    '/usr/bin/smartctl',
    '-a',
    '-j',
    '/dev/sda',
  ]);
});
