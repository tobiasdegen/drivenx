'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { whoamiPath, queryElevatedState } = require('../../electron/platform/windows-privilege.js');

test('Windows privilege binary resolves only from drive-rooted System32', () => {
  assert.equal(whoamiPath({ SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\whoami.exe');
  assert.equal(whoamiPath({ windir: 'D:\\Win' }), 'D:\\Win\\System32\\whoami.exe');
  assert.equal(whoamiPath({ SystemRoot: 'Windows' }), null);
  assert.equal(whoamiPath({ SystemRoot: '\\\\evil\\share' }), null);
  assert.equal(whoamiPath({}), null);
});

test('Windows privilege check never uses PATH/CWD and constrains child process', async () => {
  let observed;
  const elevated = await queryElevatedState({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    trackSystem: (fn) => fn(),
    run: async (file, args, options) => {
      observed = { file, args, options };
      return 'Mandatory Label\\High Mandatory Level,S-1-16-12288';
    },
  });
  assert.equal(elevated, true);
  assert.equal(observed.file, 'C:\\Windows\\System32\\whoami.exe');
  assert.deepEqual(observed.args, ['/groups', '/fo', 'csv', '/nh']);
  assert.equal(observed.options.windowsHide, true);
  assert.equal(observed.options.maxBuffer, 65536);
  assert.equal(observed.options.timeout, 5000);
});

test('Windows privilege errors and missing SystemRoot return unknown', async () => {
  assert.equal(await queryElevatedState({ platform: 'win32', env: {} }), null);
  assert.equal(
    await queryElevatedState({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      run: async () => {
        throw new Error('fail');
      },
    }),
    null,
  );
  assert.equal(
    await queryElevatedState({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      run: async () => 'S-1-16-8192',
    }),
    false,
  );
});

test('Non-Windows privilege check relies on POSIX getuid', async () => {
  assert.equal(await queryElevatedState({ platform: 'linux', getuid: () => 0 }), true);
  assert.equal(await queryElevatedState({ platform: 'darwin', getuid: () => 501 }), false);
  const expected = typeof process.getuid === 'function' ? process.getuid() === 0 : null;
  assert.equal(await queryElevatedState({ platform: 'darwin', getuid: undefined }), expected);
});
