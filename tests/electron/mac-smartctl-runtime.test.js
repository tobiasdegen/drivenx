'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Exercise the packaged macOS path with Electron's extended process API,
// without requiring a Mac or launching a real smartctl process in CI.
test('packaged macOS smartctl lookup uses process.getSystemVersion, not the app API', async () => {
  const sourceFile = path.join(ELECTRON_SOURCE_DIR, 'devices/smart.js');
  const originalRequire = createRequire(sourceFile);
  const calls = [];
  const resourcesPath = '/Applications/DriveNX.app/Contents/Resources';
  const module = { exports: {} };
  const requireFromTest = (specifier) => {
    if (specifier === 'electron') {
      return {
        app: {
          isPackaged: true,
          getSystemVersion: () => {
            throw new Error('Electron app does not provide getSystemVersion');
          },
        },
      };
    }
    if (specifier === '../platform/mac-smartctl-integrity.js') {
      return {
        verifyPackagedMacSmartctl: async (binary, options) => {
          calls.push({ binary, ...options });
          return { ok: true };
        },
      };
    }
    return originalRequire(specifier);
  };
  vm.runInNewContext(
    fs.readFileSync(sourceFile, 'utf8'),
    {
      require: requireFromTest,
      module,
      exports: module.exports,
      ELECTRON_SOURCE_DIR,
      __filename: sourceFile,
      process: {
        platform: 'darwin',
        arch: 'arm64',
        resourcesPath,
        getSystemVersion: () => '27.0.1',
      },
    },
    { filename: sourceFile },
  );

  const result = await module.exports.lookupBinaryAsync();
  const expectedBinary = path.join(resourcesPath, 'smartmontools', 'darwin', 'smartctl');
  assert.equal(result.binary, expectedBinary);
  assert.equal(result.failure, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].binary, expectedBinary);
  assert.equal(calls[0].hostVersion, '27.0.1');
  assert.equal(calls[0].resourcesPath, resourcesPath);
});
