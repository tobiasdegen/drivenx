'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Linux releases depend on Python3; do not require it on macOS/Windows dev machines.
test(
  'privileged helper permits only bounded SMART reads and self-tests',
  { skip: process.platform !== 'linux' },
  () => {
    const helper = path.join(ELECTRON_SOURCE_DIR, '..', 'linux/privileged/drivenx-smartctl-helper');
    const code =
      `import importlib.machinery,sys\nm=importlib.machinery.SourceFileLoader('helper',sys.argv[1]).load_module()\n` +
      `assert m.valid_args(['--scan-open','-j'])\n` +
      `assert m.valid_args(['-x','-j','-d','auto','/dev/null'])\n` +
      `assert m.valid_args(['-t','long','-j','-d','sat','/dev/null'])\n` +
      `for x in (['-s','on','-j','-d','auto','/dev/null'],['-t','short','-j','-d','auto','/etc/passwd'],['--scan','-j'],['-x','-j','-d','auto','/dev/../../etc/passwd'],['-x','-j','-d','auto','/dev/no-device']):\n  assert not m.valid_args(x), x\n`;
    const result = spawnSync('/usr/bin/python3', ['-B', '-I', '-c', code, helper], {
      encoding: 'utf8',
      timeout: 3000,
    });
    assert.equal(result.status, 0, result.stderr);
  },
);
