'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(ELECTRON_SOURCE_DIR, '..');
const {
  COMPONENTS,
  createLicenseHtml,
  escapeHtml,
  licenseFiles,
  chromiumLicenseCandidates,
  renderLegalMarkdown,
} = require('../../electron/ui/license-viewer.js');

test('one legal view contains original MIT license and diagnostic disclaimer', () => {
  const html = createLicenseHtml({ locale: 'de-DE', context: { packaged: false, root } });
  assert.match(html, /Open-Source-Software unter der MIT-Lizenz/);
  assert.match(html, /Drittanbieterkomponenten/);
  assert.match(html, /Diagnose- und Haftungshinweise/);
  assert.match(html, /Permission is hereby granted, free of charge/);
  assert.doesNotMatch(html, /<script\b/);
  assert.match(html, /default-src 'none'/);
});

test('English view uses original MIT text and English diagnostics', () => {
  const html = createLicenseHtml({ locale: 'en-US', context: { packaged: false, root } });
  assert.match(html, /Copyright \(c\) 2026 Tobias Degen/);
  assert.match(html, /including without limitation the rights/);
  assert.match(html, /Diagnostic and liability notices/);
  assert.match(html, /mandatory applicable law remains unaffected/i);
});

test('all runtime component licenses are bundled and displayed in detail sections', () => {
  const html = createLicenseHtml({
    locale: 'de-DE',
    context: { packaged: false, root },
  });
  assert.equal(COMPONENTS.length, 7);
  for (const [name] of COMPONENTS) assert.ok(html.includes(escapeHtml(name)), name);
  assert.match(html, /GNU GENERAL PUBLIC LICENSE/);
  assert.match(html, /BSD/);
  assert.match(html, /<table class="license-table">/);
  assert.doesNotMatch(html, /<pre>\| Mitgelieferte Komponente/);
  assert.match(html, /Feather/);
  assert.match(html, /Copyright \(c\) Meta Platforms/);
  assert.doesNotMatch(html, /<script\b/);
});

test('bundled runtime paths and readable license texts are complete', () => {
  const dev = licenseFiles({ packaged: false, root });
  for (const file of [
    dev.own,
    dev.disclaimer,
    dev.disclaimerEnglish,
    dev.notice,
    ...dev.components.map((c) => c.file),
  ]) {
    assert.ok(fs.statSync(file).size > 100, file);
  }
  const resourcesPath = path.resolve(root, 'test-resources');
  const prod = licenseFiles({ packaged: true, root, resourcesPath });
  assert.equal(prod.own, path.join(resourcesPath, 'LICENSE.md'));
  assert.equal(prod.notice, path.join(resourcesPath, 'LICENSE-THIRD-PARTY.md'));
  assert.equal(prod.disclaimer, path.join(resourcesPath, 'DISCLAIMER.md'));
  assert.equal(prod.disclaimerEnglish, path.join(resourcesPath, 'DISCLAIMER.en.md'));
  const bundledComponentPaths = new Set(prod.components.map(({ file }) => file));
  assert.ok(
    bundledComponentPaths.has(
      path.join(resourcesPath, 'smartmontools', 'COPYING-smartmontools.txt'),
    ),
  );
  assert.ok(bundledComponentPaths.has(path.join(resourcesPath, 'licenses', 'Electron-MIT.txt')));
});

test('legal texts are HTML-escaped and only local Chromium notice paths are accepted', () => {
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
  const win = chromiumLicenseCandidates({
    execPath: 'C:\\DriveNX\\DriveNX.exe',
    resourcesPath: 'C:\\DriveNX\\resources',
    platform: 'win32',
  });
  assert.deepEqual(win, [
    path.win32.join('C:\\DriveNX', 'LICENSES.chromium.html'),
    path.win32.join('C:\\DriveNX', 'resources', 'LICENSES.chromium.html'),
  ]);
  const mac = chromiumLicenseCandidates({
    execPath: '/Applications/DriveNX.app/Contents/MacOS/DriveNX',
    resourcesPath: '/Applications/DriveNX.app/Contents/Resources',
    platform: 'darwin',
  });
  assert.deepEqual(mac, [
    '/Applications/DriveNX.app/Contents/Frameworks/Electron Framework.framework/Resources/LICENSES.chromium.html',
    '/Applications/DriveNX.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/LICENSES.chromium.html',
    '/Applications/DriveNX.app/Contents/Resources/LICENSES.chromium.html',
  ]);
});

test('the supplied platform icon formats are nonempty native images', () => {
  const icons = [
    ['build/icon.ico', [0x00, 0x00, 0x01, 0x00]],
    ['build/icon.icns', [...Buffer.from('icns')]],
    ['public/favicon.png', [0x89, 0x50, 0x4e, 0x47]],
  ];
  for (const [file, signature] of icons) {
    const bytes = fs.readFileSync(path.join(root, file));
    assert.ok(bytes.length > 500);
    assert.deepEqual([...bytes.subarray(0, 4)], signature);
  }
  const pkg = require('../../package.json');
  assert.equal(pkg.build.win.icon, 'build/icon.ico');
  assert.equal(pkg.build.mac.icon, 'build/icon.icns');
});

test('third-party version labels must match the locked runtime dependencies', () => {
  const lock = require('../../package-lock.json');
  const expected = {
    electron: 'Electron',
    react: 'React',
    'react-dom': 'React DOM',
    scheduler: 'Scheduler',
    'lucide-react': 'Lucide React',
  };
  for (const [packageName, label] of Object.entries(expected)) {
    const version = lock.packages[`node_modules/${packageName}`]?.version;
    assert.ok(version, packageName);
    assert.ok(
      COMPONENTS.some(([title]) => title.includes(`${label} ${version} –`)),
      `Lizenzhinweis für ${packageName}@${version} wurde nicht aktualisiert`,
    );
  }
});

test('license view exposes original runtime notices through a single exact action URL', () => {
  const { CHROMIUM_NOTICE_URL } = require('../../electron/ui/license-viewer.js');
  const html = createLicenseHtml({ locale: 'de-DE', context: { packaged: false, root } });
  assert.match(html, /Chromium- und Node.js-Originalhinweise anzeigen/);
  assert.ok(html.includes(`href="${CHROMIUM_NOTICE_URL}"`));
  assert.doesNotMatch(html, /javascript:/i);
});

test('third-party overview stays compact while full license evidence remains bundled', () => {
  const html = createLicenseHtml({ locale: 'de-DE', context: { packaged: false, root } });
  assert.match(html, /<th scope="col">Komponente<\/th>/);
  assert.match(html, /<th scope="col">Lizenz<\/th>/);
  assert.doesNotMatch(html, /<th scope="col">Lizenztext \/ Quelle<\/th>/);
  assert.match(html, /Original-Lizenztexte der Komponenten/);
  assert.doesNotMatch(html, /Technische Drittanbieterübersicht/);
  assert.doesNotMatch(html, /Quell- und Binärherkunft/);
  assert.doesNotMatch(html, /<pre>\s*# DriveNX – Drittanbieter/);
  // The full provenance inventory is still bundled as a separate file.
  assert.match(
    fs.readFileSync(path.join(root, 'LICENSE-THIRD-PARTY.md'), 'utf8'),
    /Quell- und Binärherkunft/,
  );
});

test('local Markdown renderer produces readable tables and escapes raw HTML', () => {
  const output = renderLegalMarkdown(
    '# Header\n\n| Name | Quelle |\n| --- | --- |\n| React | `licenses/React-MIT.txt` |\n\n## Abschnitt\n**Hinweis** <img src=x onerror=alert(1)>',
  );
  assert.match(output, /<h1>Header<\/h1>/);
  assert.match(output, /<table class="license-table">/);
  assert.match(output, /<code>licenses\/React-MIT\.txt<\/code>/);
  assert.match(output, /<strong>Hinweis<\/strong>/);
  assert.doesNotMatch(output, /<img\b/);
  assert.match(output, /&lt;img/);
});
