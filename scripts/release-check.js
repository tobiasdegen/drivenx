'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SMARTMONTOOLS_75_SOURCE_SHA256 =
  '690b83ca331378da9ea0d9d61008c4b22dde391387b9bbad7f29387f2595f76e';

function matchesSha256(file, expected) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return actual === expected;
}

function inspectRelease({
  root,
  exists = fs.existsSync,
  readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
  verifySourceArchive = (file) => matchesSha256(file, SMARTMONTOOLS_75_SOURCE_SHA256),
  verifyBinary = (file) =>
    require('../electron/platform/bundled-smartctl.js').verifyBundledBinary(file, {
      platform: 'win32',
      arch: 'x64',
      packaged: true,
    }),
  verifyMacBinary = (file) =>
    require('../electron/platform/bundled-smartctl.js').verifyBundledBinary(file, {
      platform: 'darwin',
      arch: 'arm64',
      packaged: true,
    }),
}) {
  const problems = [];
  const warnings = [];
  const pkg = readJson(path.join(root, 'package.json'));
  const lock = path.join(root, 'package-lock.json');
  if (!exists(lock))
    problems.push(
      'package-lock.json fehlt: mit npm install --package-lock-only aktualisieren und versionieren.',
    );
  else {
    try {
      const data = readJson(lock);
      if (
        data.lockfileVersion < 2 ||
        data.name !== pkg.name ||
        data.version !== pkg.version ||
        data.packages?.['']?.version !== pkg.version
      )
        problems.push(
          'package-lock.json passt nicht zum aktuellen package.json (Name, Version oder Lockfile-Version).',
        );
    } catch {
      problems.push('package-lock.json ist ungültig oder nicht lesbar.');
    }
  }
  // npm can accept an inconsistent lockfile whose bin path no longer exists.
  // Check the actual installed package metadata and executable links when
  // node_modules is present (the static checks also run before npm ci).
  const prettierRoot = path.join(root, 'node_modules', 'prettier');
  const prettierManifest = path.join(prettierRoot, 'package.json');
  if (exists(prettierManifest)) {
    try {
      const installed = readJson(prettierManifest);
      const lockData = readJson(lock);
      const declared = pkg.devDependencies?.prettier;
      const locked = lockData.packages?.['node_modules/prettier'];
      // npm accepts a string bin in a package manifest but stores the
      // corresponding command as an object in package-lock.json. npm also
      // removes the optional "./" prefix from the locked path.
      const installedBin =
        typeof installed.bin === 'string' ? installed.bin : installed.bin?.prettier;
      const lockedBin = locked?.bin?.prettier;
      const expectedBin =
        typeof installedBin === 'string' ? path.posix.normalize(installedBin) : null;
      const lockBinPath = typeof lockedBin === 'string' ? path.posix.normalize(lockedBin) : null;
      if (
        !expectedBin ||
        expectedBin === '.' ||
        path.posix.isAbsolute(expectedBin) ||
        expectedBin.startsWith('../') ||
        !locked ||
        locked.version !== installed.version ||
        lockBinPath !== expectedBin ||
        declared !== installed.version
      ) {
        problems.push(
          'Prettier: installierte Paketmetadaten, package.json und package-lock.json stimmen nicht überein.',
        );
      } else {
        if (!exists(path.join(prettierRoot, expectedBin)))
          problems.push(`Prettier: ausführbare Datei fehlt (${expectedBin}).`);
        const executable = process.platform === 'win32' ? 'prettier.cmd' : 'prettier';
        if (!exists(path.join(root, 'node_modules', '.bin', executable)))
          problems.push('Prettier: ausführbare npm-Verknüpfung unter node_modules/.bin fehlt.');
      }
    } catch {
      problems.push('Prettier: installierte Paketmetadaten oder Lockfile sind nicht lesbar.');
    }
  }
  const targets = ['x64'];
  const binary = path.join(root, 'vendor', 'smartmontools', 'win32', 'smartctl.exe');
  if (!exists(binary)) problems.push('Windows-smartctl.exe fehlt: ' + binary);
  else {
    if (!verifyBinary(binary))
      problems.push(
        'Windows smartctl SHA-256 stimmt nicht mit der eingebetteten Freigabe überein.',
      );
    else
      warnings.push(
        'Windows smartctl x64 Hash geprüft. Echtheit der gesamten portablen Anwendung und Code-Signierung separat absichern.',
      );
  }
  const macBinary = path.join(root, 'vendor', 'smartmontools', 'darwin', 'smartctl');
  if (!exists(macBinary)) problems.push('macOS-smartctl fehlt: ' + macBinary);
  else if (!verifyMacBinary(macBinary))
    problems.push('macOS smartctl SHA-256 stimmt nicht mit der eingebetteten Freigabe überein.');
  // Match the macOS app's advertised minimum to the bundled smartctl build.
  // The pinned ARM64 smartctl was built with LC_BUILD_VERSION minos 15.0.0.
  if (pkg.build?.mac?.minimumSystemVersion !== '15.0.0')
    problems.push('macOS-Mindestversion muss 15.0.0 sein (gebündeltes ARM64-smartctl).');
  if (pkg.build?.win?.requestedExecutionLevel !== 'requireAdministrator')
    problems.push('Windows-Build fordert keine Administratorrechte.');
  if (pkg.build?.portable?.requestExecutionLevel !== 'admin')
    problems.push('NSIS-Portable-Launcher fordert keine Administratorrechte.');
  if (pkg.build?.allowMissingDependencies !== false)
    problems.push(
      'Fehlende Produktionsabhängigkeiten müssen den Build abbrechen (allowMissingDependencies: false).',
    );
  // React, React DOM, Lucide and Scheduler are completely bundled by Vite.
  // They remain declared for npm/license tracking but must not be duplicated
  // as standalone node_modules within the Electron ASAR archive.
  const uiOnlyModules = ['react', 'react-dom', 'lucide-react', 'scheduler'];
  for (const name of uiOnlyModules) {
    if (!pkg.build?.files?.includes(`!**/node_modules/${name}/**/*`))
      problems.push(
        `Frontend-Abhängigkeit ${name} darf nicht zusätzlich in app.asar kopiert werden.`,
      );
  }
  if (pkg.build?.files?.some((entry) => entry.includes('tests/')))
    problems.push('Testdateien dürfen nicht in die Anwendung paketiert werden.');
  if (!exists(path.join(root, 'LICENSE-THIRD-PARTY.md')))
    problems.push('Drittanbieter-Lizenzhinweise fehlen.');
  for (const file of [
    'LICENSE.md',
    'DISCLAIMER.md',
    'DISCLAIMER.en.md',
    'electron/ui/license-viewer.js',
    'electron/ui/native-about.js',
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
  ]) {
    if (!exists(path.join(root, file))) problems.push(`Freigabe-Ressource fehlt: ${file}`);
  }
  if (pkg.build?.win?.icon !== 'build/icon.ico' || pkg.build?.mac?.icon !== 'build/icon.icns')
    problems.push('Windows-/macOS-App-Icons sind nicht korrekt konfiguriert.');
  // License sources live once under resources/, not duplicated in app.asar.
  if (
    [
      'LICENSE.md',
      'DISCLAIMER.md',
      'DISCLAIMER.en.md',
      'LICENSE-THIRD-PARTY.md',
      'licenses/**/*',
    ].some((file) => pkg.build?.files?.includes(file))
  )
    problems.push('Lizenzdateien dürfen nicht zusätzlich im app.asar gebündelt werden.');
  const resources = pkg.build?.extraResources || [];
  const macResources = pkg.build?.mac?.extraResources || [];
  const winResources = pkg.build?.win?.extraResources || [];
  const hasMapping = (entries, from, to) =>
    entries.some((entry) => entry.from === from && entry.to === to);
  const commonSmart = resources.find(
    (entry) => entry.from === 'vendor/smartmontools' && entry.to === 'smartmontools',
  );
  const sharedSmartFiles = ['AUTHORS-smartmontools.txt', 'COPYING-smartmontools.txt', 'drivedb.h'];
  if (
    !commonSmart ||
    !Array.isArray(commonSmart.filter) ||
    commonSmart.filter.length !== sharedSmartFiles.length ||
    !sharedSmartFiles.every((name) => commonSmart.filter.includes(name))
  ) {
    problems.push(
      'Gemeinsame smartmontools-Ressourcen müssen auf Lizenz, Autoren und DriveDB begrenzt sein.',
    );
  }
  if (!hasMapping(winResources, 'vendor/smartmontools/win32', 'smartmontools/win32'))
    problems.push(
      'Windows-smartctl ist nicht ausschließlich als Windows-Paketressource konfiguriert.',
    );
  if (!hasMapping(macResources, 'vendor/smartmontools/darwin', 'smartmontools/darwin'))
    problems.push('macOS-smartctl ist nicht ausschließlich als macOS-Paketressource konfiguriert.');
  if (!hasMapping(macResources, 'build/icon.png', 'icon.png'))
    problems.push('macOS-Paket muss das App-Icon für den Über-Dialog enthalten.');
  // Only packages that actually bundle a smartctl executable need the
  // corresponding source archive. Linux uses the distribution's smartctl.
  const sourceFrom = 'vendor/smartmontools/smartmontools-7.5-source.tar.gz';
  const sourceTo = 'smartmontools/smartmontools-7.5-source.tar.gz';
  if (!hasMapping(winResources, sourceFrom, sourceTo))
    problems.push('Windows-Paket muss das smartmontools-Quellarchiv enthalten.');
  if (!hasMapping(macResources, sourceFrom, sourceTo))
    problems.push('macOS-Paket muss das smartmontools-Quellarchiv enthalten.');
  if (resources.some((entry) => entry.from === sourceFrom))
    problems.push('Linux-Paket darf kein unnötiges smartmontools-Quellarchiv bündeln.');
  const linuxConfig = pkg.build?.linux;
  const linuxResources = linuxConfig?.extraResources || [];
  const linuxTargets = linuxConfig?.target || [];
  const requiredLinuxTargets = ['AppImage', 'deb'];
  if (
    !Array.isArray(linuxTargets) ||
    !requiredLinuxTargets.every((target) =>
      linuxTargets.some((entry) => entry.target === target && entry.arch?.includes('x64')),
    )
  )
    problems.push('Linux x64 muss AppImage- und DEB-Ziele konfigurieren.');
  if (linuxConfig?.icon !== 'build/app-icon-source.svg')
    problems.push('Linux-Icon ist nicht korrekt konfiguriert.');
  if (!hasMapping(linuxResources, 'build/icon.png', 'icon.png'))
    problems.push('Linux-Fenstericon muss als Linux-Ressource bereitgestellt werden.');
  if (!pkg.build?.deb?.depends?.includes('smartmontools'))
    problems.push('DEB-Paket muss smartmontools als Systemabhängigkeit verlangen.');
  if (
    linuxResources.some((entry) =>
      /vendor\/smartmontools\/(?:darwin|win32|linux)/.test(entry.from || ''),
    )
  )
    problems.push('Linux-Paket darf keine plattformfremden smartctl-Binärdateien enthalten.');
  if (!hasMapping(winResources, 'build/icon.png', 'icon.png'))
    problems.push('PNG-Fenstericon ist nicht als Windows-Paketressource konfiguriert.');
  if (
    resources.some(
      (entry) => entry.from === 'build/icon.png' || entry.from === 'build/app-icon-source.svg',
    ) ||
    macResources.some((entry) => entry.from === 'build/app-icon-source.svg')
  )
    problems.push(
      'Gemeinsame Icon-Ressourcen und SVG-Dateien dürfen nicht als macOS-Paketressource vorliegen.',
    );
  if (
    resources.some(
      (entry) =>
        entry.from.startsWith('vendor/smartmontools/') &&
        /\/(darwin|win32)(?:\/|$)/.test(entry.from),
    ) ||
    winResources.some((entry) => /vendor\/smartmontools\/darwin(?:\/|$)/.test(entry.from || '')) ||
    macResources.some((entry) => /vendor\/smartmontools\/win32(?:\/|$)/.test(entry.from || ''))
  ) {
    problems.push('Plattformfremde smartctl-Dateien dürfen nicht in ein Release kopiert werden.');
  }
  for (const from of ['LICENSE.md', 'DISCLAIMER.md', 'DISCLAIMER.en.md', 'licenses']) {
    if (!pkg.build?.extraResources?.some((entry) => entry.from === from))
      problems.push(`Lizenzdateien fehlen als externe Paketressource: ${from}`);
  }

  for (const [relativeFile, description] of [
    ['COPYING-smartmontools.txt', 'smartmontools-Lizenztext'],
    ['AUTHORS-smartmontools.txt', 'smartmontools-Autorenhinweise'],
    ['smartmontools-7.5-source.tar.gz', 'smartmontools-Quellarchiv'],
  ]) {
    if (!exists(path.join(root, 'vendor', 'smartmontools', relativeFile)))
      problems.push(`${description} fehlt für den Release.`);
  }
  const sourceArchive = path.join(
    root,
    'vendor',
    'smartmontools',
    'smartmontools-7.5-source.tar.gz',
  );
  if (exists(sourceArchive) && !verifySourceArchive(sourceArchive)) {
    problems.push(
      'smartmontools-Quellarchiv stimmt nicht mit dem offiziellen Release 7.5 überein.',
    );
  }
  for (const [file, label] of [
    ['vendor/usb-ids/index.json', 'USB-ID-Index'],
    ['vendor/usb-ids/usb.ids', 'USB-ID-Quelldaten'],
    ['vendor/usb-ids/LICENSE-BSD-3-Clause.txt', 'USB-ID-Lizenztext'],
  ]) {
    if (!exists(path.join(root, file))) problems.push(`${label} fehlt für den Release.`);
  }
  const usbIndex = resources.find(
    (entry) => entry.from === 'vendor/usb-ids' && entry.to === 'usb-ids',
  );
  if (
    !usbIndex ||
    !Array.isArray(usbIndex.filter) ||
    usbIndex.filter.length !== 2 ||
    !['index.json', 'LICENSE-BSD-3-Clause.txt'].every((name) => usbIndex.filter.includes(name))
  )
    problems.push(
      'USB-ID-Ressourcen müssen auf index.json und BSD-Lizenztext begrenzt sein (ohne usb.ids).',
    );
  if (!pkg.build?.extraResources?.some((entry) => entry.from === 'LICENSE-THIRD-PARTY.md'))
    problems.push('Drittanbieter-Lizenzübersicht fehlt als externe Paketressource.');
  return { problems, warnings, targets };
}
module.exports = { inspectRelease };
