'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  createLinuxSmartSession,
  HELPER,
} = require('../../electron/platform/linux-smart-session.js');

function fakeWorker() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit('exit', 0);
  };
  return child;
}

test('Linux broker authenticates once and reuses the same session for multiple queries', async () => {
  const child = fakeWorker();
  const commands = [];
  const session = createLinuxSmartSession({
    trusted: async (file) => file === HELPER,
    findPkexec: async () => '/usr/bin/pkexec',
    spawnProcess: (binary, args) => {
      assert.equal(binary, '/usr/bin/pkexec');
      assert.deepEqual(args, ['--disable-internal-agent', HELPER]);
      commands.push(binary);
      let text = '';
      child.stdin.on('data', (chunk) => {
        text += chunk;
        if (!text.includes('\n')) return;
        const request = JSON.parse(text.trim());
        text = '';
        child.stdout.write(
          JSON.stringify({
            id: request.id,
            stdout: '{"smartctl":{"exit_status":0}}',
            stderr: '',
            exitCode: 0,
          }) + '\n',
        );
      });
      return child;
    },
  });
  const [a, b] = await Promise.all([
    session.run('/usr/bin/smartctl', ['-x', '-j', '-d', 'auto', '/dev/sda'], 5000),
    session.run('/usr/bin/smartctl', ['-a', '-j', '-d', 'auto', '/dev/sdb'], 5000),
  ]);
  assert.equal(a.exitCode, 0);
  assert.equal(b.json.smartctl.exit_status, 0);
  assert.equal(commands.length, 1);
  session.stop();
});

test('Linux broker refuses non-root-owned helper before asking for privileges', async () => {
  const session = createLinuxSmartSession({
    trusted: async () => false,
    spawnProcess: () => {
      throw new Error('must not start');
    },
  });
  assert.equal(await session.available(), false);
  await assert.rejects(
    session.run('/usr/bin/smartctl', ['--scan-open', '-j'], 3000),
    /not installed/,
  );
});

test('Linux helper policy is restricted to one root-owned helper and requires authentication', () => {
  const fs = require('node:fs');
  const policy = fs.readFileSync(
    require('node:path').join(
      ELECTRON_SOURCE_DIR,
      '../linux/privileged/io.drivenx.smartctl.policy',
    ),
    'utf8',
  );
  assert.match(policy, /<allow_active>auth_admin<\/allow_active>/);
  assert.match(policy, /org.freedesktop.policykit.exec.path/);
  assert.match(policy, /\/usr\/libexec\/drivenx-smartctl-helper/);
  assert.doesNotMatch(policy, /auth_admin_keep|<allow_active>yes<\/allow_active>/);
});

test('Linux broker rejects cancellation and does not keep an unauthorized worker alive', async () => {
  const child = fakeWorker();
  const session = createLinuxSmartSession({
    trusted: async () => true,
    findPkexec: async () => '/usr/bin/pkexec',
    spawnProcess: () => {
      process.nextTick(() => child.emit('exit', 126));
      return child;
    },
  });
  await assert.rejects(session.run('/usr/bin/smartctl', ['--scan-open', '-j'], 5000), {
    code: 'permission',
  });
  await assert.rejects(session.run('/usr/bin/smartctl', ['--scan-open', '-j'], 5000), {
    code: 'permission',
  });
  session.stop();
});
