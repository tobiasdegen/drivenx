'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectRelease } = require('../../scripts/release-check.js');
const root = '/test/release';
const base = {
  name: 'drivenx',
  version: '0.13.1',
  build: {
    allowMissingDependencies: false,
    win: {
      requestedExecutionLevel: 'requireAdministrator',
      icon: 'build/icon.ico',
      extraResources: [
        { from: 'vendor/smartmontools/win32', to: 'smartmontools/win32' },
        {
          from: 'vendor/smartmontools/smartmontools-7.5-source.tar.gz',
          to: 'smartmontools/smartmontools-7.5-source.tar.gz',
        },
        { from: 'build/icon.png', to: 'icon.png' },
      ],
    },
    mac: {
      icon: 'build/icon.icns',
      minimumSystemVersion: '15.0.0',
      extraResources: [
        { from: 'vendor/smartmontools/darwin', to: 'smartmontools/darwin' },
        { from: 'build/icon.png', to: 'icon.png' },
        {
          from: 'vendor/smartmontools/smartmontools-7.5-source.tar.gz',
          to: 'smartmontools/smartmontools-7.5-source.tar.gz',
        },
      ],
    },
    linux: {
      icon: 'build/app-icon-source.svg',
      target: [
        { target: 'AppImage', arch: ['x64'] },
        { target: 'deb', arch: ['x64'] },
      ],
      extraResources: [{ from: 'build/icon.png', to: 'icon.png' }],
    },
    deb: { depends: ['default', 'smartmontools'], recommends: ['pkexec'] },
    portable: { requestExecutionLevel: 'admin' },
    files: [
      'electron/**/*',
      'shared/**/*',
      'locales/**/*',
      ...['react', 'react-dom', 'lucide-react', 'scheduler'].map(
        (name) => `!**/node_modules/${name}/**/*`,
      ),
    ],
    extraResources: [
      {
        from: 'vendor/smartmontools',
        to: 'smartmontools',
        filter: ['AUTHORS-smartmontools.txt', 'COPYING-smartmontools.txt', 'drivedb.h'],
      },
      {
        from: 'vendor/usb-ids',
        to: 'usb-ids',
        filter: ['index.json', 'LICENSE-BSD-3-Clause.txt'],
      },
      { from: 'LICENSE-THIRD-PARTY.md', to: 'LICENSE-THIRD-PARTY.md' },
      { from: 'LICENSE.md', to: 'LICENSE.md' },
      { from: 'DISCLAIMER.md', to: 'DISCLAIMER.md' },
      { from: 'DISCLAIMER.en.md', to: 'DISCLAIMER.en.md' },
      { from: 'licenses', to: 'licenses' },
    ],
  },
};
const known = new Set([
  'package.json',
  'package-lock.json',
  'vendor/smartmontools/win32/smartctl.exe',
  'vendor/smartmontools/darwin/smartctl',
  'LICENSE-THIRD-PARTY.md',
  'LICENSE.md',
  'DISCLAIMER.md',
  'DISCLAIMER.en.md',
  'electron/ui/native-about.js',
  'electron/ui/license-viewer.js',
  'licenses/Electron-MIT.txt',
  'licenses/React-MIT.txt',
  'licenses/React-DOM-MIT.txt',
  'licenses/Scheduler-MIT.txt',
  'licenses/Lucide-ISC-and-Feather-MIT.txt',
  'build/icon.ico',
  'build/icon.icns',
  'build/icon.png',
  'build/app-icon-source.svg',
  'public/favicon.png',
  'vendor/smartmontools/COPYING-smartmontools.txt',
  'vendor/smartmontools/AUTHORS-smartmontools.txt',
  'vendor/smartmontools/smartmontools-7.5-source.tar.gz',
  'vendor/usb-ids/index.json',
  'vendor/usb-ids/usb.ids',
  'vendor/usb-ids/LICENSE-BSD-3-Clause.txt',
]);
const fixture = (overrides = {}, missing = []) => ({
  root,
  verifyBinary: () => true,
  verifyMacBinary: () => true,
  verifySourceArchive: () => true,
  exists: (file) =>
    known.has(path.relative(root, file).replaceAll('\\', '/')) &&
    !missing.includes(path.relative(root, file).replaceAll('\\', '/')),
  readJson: (file) =>
    path.basename(file) === 'package.json'
      ? { ...base, ...overrides }
      : {
          name: 'drivenx',
          version: '0.13.1',
          lockfileVersion: 3,
          packages: { '': { version: '0.13.1' } },
        },
});
test('release check accepts consistent Windows x64 prerequisites', () => {
  const result = inspectRelease(fixture());
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.targets, ['x64']);
});
test('release check rejects missing lockfile and smartctl', () => {
  const result = inspectRelease(
    fixture({}, ['package-lock.json', 'vendor/smartmontools/win32/smartctl.exe']),
  );
  assert.equal(result.problems.length, 2);
});
test('release check requires a matching macOS smartctl ARM64 binary', () => {
  const missing = inspectRelease(fixture({}, ['vendor/smartmontools/darwin/smartctl']));
  assert.ok(missing.problems.some((message) => message.includes('macOS-smartctl fehlt')));

  const mismatched = fixture();
  mismatched.verifyMacBinary = () => false;
  assert.ok(
    inspectRelease(mismatched).problems.some((message) =>
      message.includes('macOS smartctl SHA-256'),
    ),
  );
});

test('release check catches incompatible lockfile version', () => {
  const input = fixture();
  input.readJson = (file) =>
    path.basename(file) === 'package.json'
      ? base
      : {
          name: 'drivenx',
          version: '0.13.0',
          lockfileVersion: 3,
          packages: { '': { version: '0.13.0' } },
        };
  assert.ok(inspectRelease(input).problems.some((x) => x.includes('passt nicht')));
});
test('release check requires smartmontools license and matching source bundle', () => {
  const result = inspectRelease(
    fixture({}, [
      'vendor/smartmontools/COPYING-smartmontools.txt',
      'vendor/smartmontools/AUTHORS-smartmontools.txt',
      'vendor/smartmontools/smartmontools-7.5-source.tar.gz',
    ]),
  );
  assert.ok(result.problems.some((p) => p.includes('smartmontools-Lizenztext')));
  assert.ok(result.problems.some((p) => p.includes('smartmontools-Quellarchiv')));
});

test('release rejects a source archive that differs from official smartmontools 7.5', () => {
  const input = fixture();
  input.verifySourceArchive = () => false;
  assert.ok(
    inspectRelease(input).problems.some((problem) => problem.includes('offiziellen Release 7.5')),
  );
});

test('release requires USB-ID source, index, BSD license and packaged notices', () => {
  const files = [
    'vendor/usb-ids/index.json',
    'vendor/usb-ids/usb.ids',
    'vendor/usb-ids/LICENSE-BSD-3-Clause.txt',
  ];
  const result = inspectRelease(fixture({}, files));
  assert.ok(result.problems.some((p) => p.includes('USB-ID-Index')));
  assert.ok(result.problems.some((p) => p.includes('USB-ID-Quelldaten')));
  assert.ok(result.problems.some((p) => p.includes('USB-ID-Lizenztext')));
  assert.ok(
    inspectRelease(fixture({ build: { ...base.build, extraResources: [] } })).problems.some((p) =>
      p.includes('USB-ID-Ressourcen müssen'),
    ),
  );
});

test('release rejects bundling raw USB-ID input or globally duplicated icons', () => {
  const unfiltered = base.build.extraResources.map((entry) =>
    entry.from === 'vendor/usb-ids' ? { from: entry.from, to: entry.to } : entry,
  );
  const mixed = inspectRelease(fixture({ build: { ...base.build, extraResources: unfiltered } }));
  assert.ok(mixed.problems.some((message) => message.includes('ohne usb.ids')));

  const mixedIcons = inspectRelease(
    fixture({
      build: {
        ...base.build,
        extraResources: [...base.build.extraResources, { from: 'build/icon.png', to: 'icon.png' }],
      },
    }),
  );
  assert.ok(mixedIcons.problems.some((message) => message.includes('macOS-Paketressource')));

  const missingWinIcon = inspectRelease(
    fixture({
      build: {
        ...base.build,
        win: { ...base.build.win, extraResources: base.build.win.extraResources.slice(0, 1) },
      },
    }),
  );
  assert.ok(missingWinIcon.problems.some((message) => message.includes('PNG-Fenstericon')));
});

test('release refuses redundant license copies inside app.asar', () => {
  const redundant = { ...base.build, files: [...base.build.files, 'LICENSE.md'] };
  const result = inspectRelease(fixture({ build: redundant }));
  assert.ok(result.problems.some((problem) => problem.includes('app.asar')));
});

test('disclaimer is required both on disk and as a separately packaged resource', () => {
  const absent = inspectRelease(fixture({}, ['DISCLAIMER.md']));
  assert.ok(absent.problems.some((x) => x.includes('DISCLAIMER.md')));
  const missingPackaged = {
    ...base.build,
    extraResources: base.build.extraResources.filter((x) => x.from !== 'DISCLAIMER.en.md'),
  };
  const missing = inspectRelease(fixture({ build: missingPackaged }));
  assert.ok(missing.problems.some((x) => x.includes('DISCLAIMER.en.md')));
});

test('release configuration isolates smartctl binaries by target platform', () => {
  assert.deepEqual(inspectRelease(fixture()).problems, []);
  const unfiltered = base.build.extraResources.map((entry) =>
    entry.from === 'vendor/smartmontools' ? { from: entry.from, to: entry.to } : entry,
  );
  const incorrect = inspectRelease(
    fixture({ build: { ...base.build, extraResources: unfiltered } }),
  );
  assert.ok(incorrect.problems.some((message) => message.includes('begrenzt')));
  const swapped = inspectRelease(
    fixture({
      build: {
        ...base.build,
        mac: { ...base.build.mac, extraResources: base.build.win.extraResources },
      },
    }),
  );
  assert.ok(swapped.problems.some((message) => message.includes('macOS-smartctl')));
  assert.ok(swapped.problems.some((message) => message.includes('Plattformfremde')));
});

test('release check requires Linux targets and the distribution smartmontools dependency', () => {
  const incorrect = inspectRelease(
    fixture({ build: { ...base.build, linux: { ...base.build.linux, target: [] }, deb: {} } }),
  );
  assert.ok(incorrect.problems.some((problem) => problem.includes('AppImage')));
  assert.ok(
    incorrect.problems.some((problem) => problem.includes('smartmontools als Systemabhängigkeit')),
  );
});

test('release rejects macOS target older than the bundled ARM64 smartctl', () => {
  const bad = inspectRelease(
    fixture({
      build: { ...base.build, mac: { ...base.build.mac, minimumSystemVersion: '14.0.0' } },
    }),
  );
  assert.ok(bad.problems.some((x) => x.includes('macOS-Mindestversion')));

  const misleading = inspectRelease(
    fixture({
      build: { ...base.build, mac: { ...base.build.mac, minimumSystemVersion: '27.0.0' } },
    }),
  );
  assert.ok(misleading.problems.some((x) => x.includes('macOS-Mindestversion')));
});

test('release validates Prettier lockfile bin metadata and npm executable link', () => {
  const paths = [
    'node_modules/prettier/package.json',
    'node_modules/prettier/bin/prettier.cjs',
    `node_modules/.bin/${process.platform === 'win32' ? 'prettier.cmd' : 'prettier'}`,
  ];
  const asRelative = (file) => path.relative(root, file).replaceAll('\\', '/');
  const check = (lockedBin, { installedBin = './bin/prettier.cjs', hasLink = true } = {}) => {
    const input = fixture();
    const baseRead = input.readJson;
    const baseExists = input.exists;
    input.exists = (file) =>
      baseExists(file) || paths.slice(0, hasLink ? 3 : 2).includes(asRelative(file));
    input.readJson = (file) => {
      const name = asRelative(file);
      if (name === 'package.json') return { ...base, devDependencies: { prettier: '3.9.10' } };
      if (name === 'node_modules/prettier/package.json')
        return { version: '3.9.10', bin: installedBin };
      if (name === 'package-lock.json')
        return {
          name: base.name,
          version: base.version,
          lockfileVersion: 3,
          packages: {
            '': { version: base.version },
            'node_modules/prettier': { version: '3.9.10', bin: { prettier: lockedBin } },
          },
        };
      return baseRead(file);
    };
    return inspectRelease(input).problems;
  };
  // Prettier's installed manifest uses a string with "./", while npm's
  // lockfile represents the same command as an object without that prefix.
  assert.ok(!check('bin/prettier.cjs').some((issue) => issue.startsWith('Prettier:')));
  assert.ok(
    !check('bin/prettier.cjs', { installedBin: { prettier: 'bin/prettier.cjs' } }).some((issue) =>
      issue.startsWith('Prettier:'),
    ),
  );
  assert.ok(check('bin/prettier.js').some((issue) => issue.startsWith('Prettier:')));
  assert.ok(
    check('bin/prettier.cjs', { installedBin: '../other/prettier.cjs' }).some((issue) =>
      issue.startsWith('Prettier:'),
    ),
  );
  assert.ok(
    check('bin/prettier.cjs', { hasLink: false }).some((issue) =>
      issue.includes('npm-Verknüpfung'),
    ),
  );
});

test('release enforces strict production dependencies and excludes duplicated frontend libraries', () => {
  const loose = inspectRelease(
    fixture({ build: { ...base.build, allowMissingDependencies: true } }),
  );
  assert.ok(loose.problems.some((problem) => problem.includes('allowMissingDependencies')));
  const duplicated = inspectRelease(
    fixture({
      build: {
        ...base.build,
        files: base.build.files.filter((entry) => !entry.includes('node_modules/react/')),
      },
    }),
  );
  assert.ok(duplicated.problems.some((problem) => problem.includes('react')));
});

test('release requires corresponding source archive only in Windows/macOS packages', () => {
  const mac = inspectRelease(
    fixture({
      build: {
        ...base.build,
        mac: { ...base.build.mac, extraResources: base.build.mac.extraResources.slice(0, 1) },
      },
    }),
  );
  assert.ok(
    mac.problems.some((problem) =>
      problem.includes('macOS-Paket muss das smartmontools-Quellarchiv'),
    ),
  );
  const windows = inspectRelease(
    fixture({
      build: {
        ...base.build,
        win: {
          ...base.build.win,
          extraResources: base.build.win.extraResources.filter(
            (entry) => !entry.from.endsWith('source.tar.gz'),
          ),
        },
      },
    }),
  );
  assert.ok(
    windows.problems.some((problem) =>
      problem.includes('Windows-Paket muss das smartmontools-Quellarchiv'),
    ),
  );
});

test('release requires macOS About icon as a mac-only resource', () => {
  const omitted = inspectRelease(
    fixture({
      build: {
        ...base.build,
        mac: {
          ...base.build.mac,
          extraResources: base.build.mac.extraResources.filter(
            (entry) => entry.from !== 'build/icon.png',
          ),
        },
      },
    }),
  );
  assert.ok(omitted.problems.some((problem) => problem.includes('App-Icon für den Über-Dialog')));
});
