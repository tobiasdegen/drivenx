'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SMARTCTL_PATHS,
  trustedSystemExecutable,
  findTrustedExecutable,
  needsRootAccess,
  linuxSmartInvocation,
} = require('../../electron/platform/linux-smartctl.js');

function trustedFixture({ uid = 0, mode = 0o755, resolved = '/usr/bin/smartctl' } = {}) {
  return {
    realpath: async () => resolved,
    stat: async (file) => ({
      uid: file === resolved ? uid : 0,
      mode: file === resolved ? mode : 0o755,
      isFile: () => file === resolved,
      isDirectory: () => file !== resolved,
    }),
  };
}

test('Linux uses only trusted absolute system smartctl candidates', async () => {
  assert.ok(SMARTCTL_PATHS.every((name) => name.startsWith('/')));
  assert.equal(await trustedSystemExecutable('/usr/bin/smartctl', trustedFixture()), true);
  assert.equal(
    await findTrustedExecutable(['/usr/bin/smartctl'], trustedFixture()),
    '/usr/bin/smartctl',
  );
  assert.equal(
    await trustedSystemExecutable('/tmp/smartctl', trustedFixture({ resolved: '/tmp/smartctl' })),
    false,
  );
  assert.equal(
    await trustedSystemExecutable('/usr/bin/smartctl', trustedFixture({ uid: 1000 })),
    false,
  );
  assert.equal(
    await trustedSystemExecutable('/usr/bin/smartctl', trustedFixture({ mode: 0o777 })),
    false,
  );
});

test('Linux version and unprivileged scan do not request administrator privileges', async () => {
  assert.equal(needsRootAccess(['--version']), false);
  assert.equal(needsRootAccess(['--scan', '-j']), false);
  assert.equal(needsRootAccess(['--scan-open', '-j']), true);
  assert.equal(needsRootAccess(['-B', '/resources/drivedb.h', '-x', '-j', '/dev/sda']), true);
  let called = 0;
  const options = {
    getuid: () => 1000,
    findPkexec: async () => {
      called++;
      return '/usr/bin/pkexec';
    },
  };
  assert.deepEqual(await linuxSmartInvocation('/usr/bin/smartctl', ['--scan', '-j'], options), {
    executable: '/usr/bin/smartctl',
    args: ['--scan', '-j'],
  });
  assert.equal(called, 0);
});

test('Linux elevates only smartctl, not Electron, and preserves validated argv', async () => {
  const args = ['-B', '/resources/smartmontools/drivedb.h', '-a', '-j', '/dev/nvme0n1'];
  const execution = await linuxSmartInvocation('/usr/bin/smartctl', args, {
    getuid: () => 1000,
    findPkexec: async () => '/usr/bin/pkexec',
  });
  assert.equal(execution.executable, '/usr/bin/pkexec');
  assert.deepEqual(execution.args, ['--disable-internal-agent', '/usr/bin/smartctl', ...args]);
  assert.deepEqual(
    await linuxSmartInvocation('/usr/bin/smartctl', args, {
      getuid: () => 0,
      findPkexec: async () => {
        throw new Error('should not be called');
      },
    }),
    { executable: '/usr/bin/smartctl', args },
  );
  assert.deepEqual(
    await linuxSmartInvocation('/usr/bin/smartctl', args, {
      getuid: () => 1000,
      findPkexec: async () => null,
    }),
    { executable: '/usr/bin/smartctl', args },
  );
});
