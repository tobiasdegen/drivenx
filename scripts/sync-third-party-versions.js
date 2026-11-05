'use strict';

/** Synchronize human-readable license version labels with the reproducible npm lockfile. */
const fs = require('node:fs');
const path = require('node:path');

const ENTRIES = Object.freeze([
  { name: 'electron', row: 'Electron (Laufzeit)', label: 'Electron', separator: ' – MIT' },
  { name: 'react', row: 'React', label: 'React', separator: ' – MIT' },
  { name: 'react-dom', row: 'React DOM', label: 'React DOM', separator: ' – MIT' },
  {
    name: 'scheduler',
    row: 'Scheduler (React DOM Dependency)',
    label: 'Scheduler',
    separator: ' – MIT',
  },
  {
    name: 'lucide-react',
    row: 'Lucide React',
    label: 'Lucide React',
    separator: ' – ISC / Feather MIT',
  },
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} source @param {RegExp} pattern @param {string} replacement */
function replaceExactlyOnce(source, pattern, replacement, label) {
  const hits = [
    ...source.matchAll(
      new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'),
    ),
  ];
  if (hits.length !== 1) throw new Error(`Expected one ${label} entry; found ${hits.length}`);
  return source.replace(pattern, replacement);
}

/** @param {string} root */
function expectedVersions(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version)
    throw new Error('package-lock.json is out of sync with package.json version');
  for (const group of ['dependencies', 'devDependencies']) {
    const specs = pkg[group] || {};
    const lockedSpecs = lock.packages?.['']?.[group] || {};
    for (const [name, spec] of Object.entries(specs)) {
      if (lockedSpecs[name] !== spec) throw new Error(`Lockfile dependency mismatch: ${name}`);
    }
    for (const name of Object.keys(lockedSpecs)) {
      if (!(name in specs)) throw new Error(`Stale lockfile dependency: ${name}`);
    }
  }
  const values = {};
  for (const entry of ENTRIES) {
    const version = lock.packages?.[`node_modules/${entry.name}`]?.version;
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version))
      throw new Error(`Missing locked runtime version: ${entry.name}`);
    values[entry.name] = version;
  }
  return values;
}

/** @param {string} root */
function updateContents(root) {
  const versions = expectedVersions(root);
  const noticeFile = path.join(root, 'LICENSE-THIRD-PARTY.md');
  const viewerFile = path.join(root, 'electron', 'ui', 'license-viewer.js');
  let notice = fs.readFileSync(noticeFile, 'utf8');
  let viewer = fs.readFileSync(viewerFile, 'utf8');
  for (const entry of ENTRIES) {
    const ver = versions[entry.name];
    const rowPrefix = escapeRegExp(entry.row);
    notice = replaceExactlyOnce(
      notice,
      new RegExp(`(\\| ${rowPrefix}\\s+\\|\\s*)\\d+\\.\\d+\\.\\d+(?:-[^\\s|]+)?`),
      `$1${ver}`,
      `NOTICE ${entry.name}`,
    );
    const label = escapeRegExp(entry.label);
    const separator = escapeRegExp(entry.separator);
    viewer = replaceExactlyOnce(
      viewer,
      new RegExp(`(['"])${label} \\d+\\.\\d+\\.\\d+(?:-[^\\s'"]+)?${separator}`),
      `$1${entry.label} ${ver}${entry.separator}`,
      `VIEWER ${entry.name}`,
    );
  }
  return [
    { file: noticeFile, original: fs.readFileSync(noticeFile, 'utf8'), updated: notice },
    { file: viewerFile, original: fs.readFileSync(viewerFile, 'utf8'), updated: viewer },
  ];
}

function sync(root, { check = true } = {}) {
  const changes = updateContents(root);
  const mismatches = changes
    .filter((x) => x.original !== x.updated)
    .map((x) => path.relative(root, x.file));
  if (check && mismatches.length)
    throw new Error(
      `Third-party license versions are stale: ${mismatches.join(', ')}. Run npm run licenses:sync.`,
    );
  if (!check)
    for (const x of changes) if (x.updated !== x.original) fs.writeFileSync(x.file, x.updated);
  return mismatches;
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const writing = process.argv.includes('--write');
    const mismatches = sync(root, { check: !writing });
    console.log(
      writing
        ? `Updated license version labels: ${mismatches.length}`
        : 'Third-party license versions match package-lock.json.',
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
module.exports = { ENTRIES, expectedVersions, updateContents, sync };
