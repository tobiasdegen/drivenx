'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

// Hash the supplied *file*, not a path string. No metadata-based cache:
// a same-size replacement with restored timestamps must still be rejected.
function isRegularFile(stat, maxSize) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxSize;
}
function matchesDigest(actual, expected) {
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function verifyFileSync(file, expected, { maxSize = Infinity } = {}) {
  let fd;
  try {
    if (!isRegularFile(fs.lstatSync(file), maxSize)) return false;
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    if (!isRegularFile(fs.fstatSync(fd), maxSize)) return false;
    const hash = crypto.createHash('sha256');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let readBytes = 0;
    while (true) {
      const bytes = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (bytes === 0) break;
      readBytes += bytes;
      if (readBytes > maxSize) return false;
      hash.update(chunk.subarray(0, bytes));
    }
    return matchesDigest(hash.digest('hex'), expected);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* verification already failed closed */
      }
    }
  }
}
async function verifyFileAsync(file, expected, { maxSize = Infinity } = {}) {
  let handle;
  try {
    if (!isRegularFile(await fs.promises.lstat(file), maxSize)) return false;
    // O_NOFOLLOW prevents replacing a regular file with a symlink between
    // lstat and open on platforms supporting that flag.
    handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    if (!isRegularFile(await handle.stat(), maxSize)) return false;
    const hash = crypto.createHash('sha256');
    let readBytes = 0;
    // Bounded chunks avoid a multi-megabyte synchronous read/hash on the
    // Electron main thread. Keep verification on every execution.
    for await (const chunk of handle.createReadStream({
      autoClose: false,
      highWaterMark: 64 * 1024,
    })) {
      readBytes += chunk.length;
      // The file could grow after fstat; never hash unbounded attacker input.
      if (readBytes > maxSize) return false;
      hash.update(chunk);
    }
    return matchesDigest(hash.digest('hex'), expected);
  } catch {
    return false;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}
module.exports = { verifyFileSync, verifyFileAsync };
