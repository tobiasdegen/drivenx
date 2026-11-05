'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  distributionFamily,
  installCommand,
  checkLinuxDependencies,
  showLinuxDependencyNotice,
} = require('../../electron/platform/linux-dependencies.js');

test('Linux distribution commands use fixed package names and do not execute os-release text', () => {
  assert.equal(distributionFamily('ID=debian'), 'apt');
  assert.equal(distributionFamily('ID="linuxmint"\nID_LIKE="ubuntu debian"'), 'apt');
  assert.equal(distributionFamily('ID=fedora'), 'dnf');
  assert.equal(distributionFamily('ID=manjaro\nID_LIKE=arch'), 'pacman');
  assert.equal(distributionFamily('ID="opensuse-tumbleweed"'), 'zypper');
  assert.equal(distributionFamily('ID=unknown'), null);
  assert.equal(installCommand('apt', ['smartctl']), 'sudo apt install smartmontools');
  assert.equal(installCommand('apt', ['pkexec']), 'sudo apt install pkexec');
  assert.equal(
    installCommand('dnf', ['smartctl', 'pkexec']),
    'sudo dnf install smartmontools polkit',
  );
  assert.equal(installCommand('pacman', ['pkexec']), 'sudo pacman -S polkit');
  assert.equal(installCommand('zypper', ['smartctl']), 'sudo zypper install smartmontools');
  assert.equal(installCommand(null, ['smartctl']), null);
});

test('read-only startup check detects missing Linux dependencies', async () => {
  const calls = [];
  const options = {
    platform: 'linux',
    getuid: () => 1000,
    findExecutable: async (paths) => {
      calls.push(paths);
      return paths[0].includes('smartctl') ? null : '/usr/bin/pkexec';
    },
    readOsRelease: async () => 'ID=ubuntu',
  };
  assert.deepEqual(await checkLinuxDependencies(options), {
    missing: ['smartctl'],
    command: 'sudo apt install smartmontools',
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(await checkLinuxDependencies({ ...options, findExecutable: async () => null }), {
    missing: ['smartctl', 'pkexec'],
    command: 'sudo apt install smartmontools pkexec',
  });
});

test('fully equipped Linux and other OSes never show an installation notice', async () => {
  const options = {
    platform: 'linux',
    getuid: () => 1000,
    findExecutable: async (paths) => paths[0],
    readOsRelease: async () => {
      throw new Error('should not run');
    },
  };
  assert.deepEqual(await checkLinuxDependencies(options), { missing: [], command: null });
  assert.deepEqual(await checkLinuxDependencies({ ...options, platform: 'darwin' }), {
    missing: [],
    command: null,
  });
  assert.deepEqual(
    await checkLinuxDependencies({
      ...options,
      getuid: () => 0,
      findExecutable: async (paths) => (paths[0].includes('smartctl') ? '/usr/bin/smartctl' : null),
    }),
    { missing: [], command: null },
  );
});

test('unknown Linux distributions show manual instructions rather than inventing a command', async () => {
  const state = await checkLinuxDependencies({
    platform: 'linux',
    getuid: () => 1000,
    findExecutable: async () => null,
    readOsRelease: async () => 'ID=unrecognized',
  });
  assert.deepEqual(state, { missing: ['smartctl', 'pkexec'], command: null });
  const seen = [];
  const copied = [];
  await showLinuxDependencyNotice(state, {
    locale: 'en-US',
    owner: null,
    dialog: {
      showMessageBox: async (...args) => {
        seen.push(args);
        return { response: 0 };
      },
    },
    clipboard: { writeText: (s) => copied.push(s) },
  });
  assert.deepEqual(seen[0][0].buttons, ['Close']);
  assert.match(seen[0][0].detail, /package manager/);
  assert.deepEqual(copied, []);
});

test('Linux dialog copies the install command only when user requests it', async () => {
  const copied = [];
  let response = 1;
  const options = {
    locale: 'de-DE',
    owner: { id: 1 },
    dialog: {
      showMessageBox: async (owner, opts) => {
        assert.ok(owner);
        assert.equal(opts.defaultId, 1);
        assert.equal(opts.cancelId, 1);
        assert.match(opts.message, /pkexec/);
        return { response };
      },
    },
    clipboard: { writeText: (s) => copied.push(s) },
  };
  const state = { missing: ['pkexec'], command: 'sudo apt install pkexec' };
  assert.equal(await showLinuxDependencyNotice({ missing: [], command: null }, options), false);
  assert.equal(await showLinuxDependencyNotice(state, options), true);
  assert.deepEqual(copied, []);
  response = 0;
  await showLinuxDependencyNotice(state, options);
  assert.deepEqual(copied, ['sudo apt install pkexec']);
});
