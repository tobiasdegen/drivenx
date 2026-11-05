// @ts-check
'use strict';
const fs = require('node:fs/promises');
const native = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalSystemPath } = require('../platform/system-path.js');
const { errorCode } = require('../security/process-error-details.js');

// Serialize replacements of the same target on Windows, where simultaneous
// renames over an existing file can fail with EPERM.
/** @type {Map<string, Promise<void>>} */
const pendingReplacements = new Map();

// Refuse symbolic-link/reparse-point directory components, not just the leaf.
/** @param {string} directory @param {boolean} [create] @returns {Promise<string>} */
async function verifyDirectory(directory, create = false) {
  const absolute = path.resolve(directory);
  const canonical = canonicalSystemPath(absolute);
  const { root } = path.parse(canonical);
  let cursor = root;
  for (const part of canonical.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if (!create || errorCode(error) !== 'ENOENT') throw error;
      try {
        await fs.mkdir(cursor, { mode: 0o700 });
      } catch (mkdirError) {
        if (errorCode(mkdirError) !== 'EEXIST') throw mkdirError;
      }
      stat = await fs.lstat(cursor);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Unsicheres Datenverzeichnis');
  }
  return absolute;
}
/** @param {string} file @param {number} maxBytes @returns {Promise<unknown>} */
async function readLimitedJson(file, maxBytes) {
  const flags = native.constants.O_RDONLY | (native.constants.O_NOFOLLOW || 0);
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Ungültiger Datendateityp');
  const handle = await fs.open(file, flags);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size > maxBytes ||
      (before.ino && stat.ino && (before.ino !== stat.ino || before.dev !== stat.dev))
    )
      throw new Error('Datendatei zu groß oder ungültig');
    const segments = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(16384, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error('Datendatei zu groß');
      segments.push(buffer.subarray(0, bytesRead));
    }
    return JSON.parse(Buffer.concat(segments).toString('utf8'));
  } finally {
    await handle.close();
  }
}
// beforeCommit is synchronous on purpose. It runs after the temporary file
// has been written and immediately before the rename is requested. A caller
// can revoke a pending write while it is queued or while staging the data.
/**
 * @param {string} file
 * @param {string} data
 * @param {number} maxBytes
 * @param {(() => void) | undefined} beforeCommit
 * @returns {Promise<void>}
 */
async function atomicWriteUnlocked(file, data, maxBytes, beforeCommit) {
  const encoded = Buffer.from(data, 'utf8');
  if (encoded.length > maxBytes) throw new Error('Datendatei zu groß');
  const dir = path.dirname(file);
  await verifyDirectory(dir, true);
  const temp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`,
  );
  try {
    await fs.writeFile(temp, encoded, { flag: 'wx', mode: 0o600 });
    if (beforeCommit) beforeCommit();
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
/**
 * @param {string} file
 * @param {string} data
 * @param {number} maxBytes
 * @param {(() => void)} [beforeCommit]
 * @returns {Promise<void>}
 */
async function atomicWrite(file, data, maxBytes, beforeCommit) {
  const key = path.resolve(file);
  const previous = pendingReplacements.get(key) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(() => atomicWriteUnlocked(key, data, maxBytes, beforeCommit));
  pendingReplacements.set(key, job);
  try {
    return await job;
  } finally {
    if (pendingReplacements.get(key) === job) pendingReplacements.delete(key);
  }
}
module.exports = { verifyDirectory, readLimitedJson, atomicWrite };
