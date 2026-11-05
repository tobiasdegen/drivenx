// @ts-check
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getCatalogSection } = require('../ui/translator.js');
const labels = getCatalogSection('de-DE', 'macIntegrity');
const { verifyBundledBinaryAsync } = require('./bundled-smartctl.js');
const execFileAsync = promisify(execFile);
const MAX_BYTES = 16 * 1024 * 1024;

/** @param {string | undefined | null} value */
function versionTuple(value) {
  const parts = String(value || '')
    .split('.')
    .slice(0, 3)
    .map(Number);
  return parts.length >= 2 && parts.every(Number.isSafeInteger) ? parts : null;
}
/** @param {string | undefined | null} host @param {string | undefined | null} minimum */
function olderVersion(host, minimum) {
  const a = versionTuple(host),
    b = versionTuple(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  }
  return false;
}
// The Mach-O load commands, not the build machine's SDK, specify the minimum
// macOS release. Re-signing changes the code signature but not LC_BUILD_VERSION.
/** @param {string} file */
async function macBinaryInfo(file) {
  let handle;
  try {
    handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const head = Buffer.alloc(32);
    if ((await handle.read(head, 0, 32, 0)).bytesRead !== 32 || head.readUInt32LE(0) !== 0xfeedfacf)
      return null;
    const cpu = head.readUInt32LE(4);
    const ncmds = head.readUInt32LE(16),
      commandBytes = head.readUInt32LE(20);
    if (ncmds > 256 || commandBytes > 65536 || commandBytes < ncmds * 8) return null;
    const buffer = Buffer.alloc(commandBytes);
    if ((await handle.read(buffer, 0, commandBytes, 32)).bytesRead !== commandBytes) return null;
    let offset = 0,
      minimum = null;
    for (let i = 0; i < ncmds; i++) {
      if (offset + 8 > commandBytes) return null;
      const command = buffer.readUInt32LE(offset),
        length = buffer.readUInt32LE(offset + 4);
      if (length < 8 || offset + length > commandBytes) return null;
      if (command === 0x32 && length >= 24 && buffer.readUInt32LE(offset + 8) === 1) {
        const v = buffer.readUInt32LE(offset + 12);
        minimum = `${v >>> 16}.${(v >>> 8) & 255}.${v & 255}`;
      } else if (command === 0x24 && length >= 16) {
        const v = buffer.readUInt32LE(offset + 8);
        minimum = `${v >>> 16}.${(v >>> 8) & 255}.${v & 255}`;
      }
      offset += length;
    }
    return { arm64: cpu === 0x0100000c, minimum };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
/** @param {string} resourcesPath */
function macBundleForResources(resourcesPath) {
  if (!path.isAbsolute(resourcesPath) || path.basename(resourcesPath) !== 'Resources') return null;
  const contents = path.dirname(resourcesPath);
  if (path.basename(contents) !== 'Contents') return null;
  const bundle = path.dirname(contents);
  return path.basename(bundle).endsWith('.app') ? bundle : null;
}
/** @param {string} executable @param {string[]} args */
async function verifyCodesign(executable, args) {
  try {
    await execFileAsync(executable, args, { timeout: 12000, maxBuffer: 65536 });
    return true;
  } catch {
    return false;
  }
}
/**
 * Verify a packaged ARM64 smartctl. Exact vendor SHA-256 is preferred. macOS
 * code signing can modify the Mach-O after afterPack validates its SHA-256;
 * in that case accept only a fully sealed, verifiable .app bundle plus a
 * verified signature on this exact bundled executable (never a PATH fallback).
 *
 * @param {string} file
 * @param {{resourcesPath: string, hostVersion?: string, verifyDigest?: typeof verifyBundledBinaryAsync, verifySignature?: typeof verifyCodesign}} options
 */
async function verifyPackagedMacSmartctl(
  file,
  {
    resourcesPath,
    hostVersion,
    verifyDigest = verifyBundledBinaryAsync,
    verifySignature = verifyCodesign,
  },
) {
  const expectedFile = path.join(resourcesPath, 'smartmontools', 'darwin', 'smartctl');
  const bundle = macBundleForResources(resourcesPath);
  if (!bundle || path.resolve(file) !== path.resolve(expectedFile))
    return {
      ok: false,
      code: 'executable_blocked',
      reasonKey: 'invalidBundlePath',
      reason: labels.invalidBundlePath,
    };
  let stat;
  try {
    stat = await fs.promises.lstat(file);
  } catch {
    return {
      ok: false,
      code: 'missing_binary',
      reasonKey: 'missingBinary',
      reason: labels.missingBinary,
    };
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES || stat.size < 4096)
    return {
      ok: false,
      code: 'executable_blocked',
      reasonKey: 'invalidBinary',
      reason: labels.invalidBinary,
    };
  // Windows tests can inspect Mach-O, but Windows stat() has no POSIX execute bits.
  // Keep the permission gate on macOS (and POSIX hosts) where execution occurs.
  if (process.platform !== 'win32' && (stat.mode & 0o111) === 0)
    return {
      ok: false,
      code: 'executable_blocked',
      reasonKey: 'notExecutable',
      reason: labels.notExecutable,
    };
  const info = await macBinaryInfo(file);
  if (!info?.arm64)
    return {
      ok: false,
      code: 'executable_blocked',
      reasonKey: 'unsupportedArch',
      reason: labels.unsupportedArch,
    };
  if (info.minimum && hostVersion && olderVersion(hostVersion, info.minimum))
    return {
      ok: false,
      code: 'executable_blocked',
      reasonKey: 'minimumVersion',
      reasonValues: { minimum: info.minimum, hostVersion },
      reason: labels.minimumVersion
        .replace('{minimum}', info.minimum)
        .replace('{hostVersion}', hostVersion),
    };
  if (await verifyDigest(file, { platform: 'darwin', arch: 'arm64', packaged: true }))
    return { ok: true, source: 'vendor-sha256', info };
  // Re-signing invalidates the byte-for-byte vendor hash. A valid signature
  // of *both* the nested executable and the enclosing app is then mandatory.
  if (
    (await verifySignature('/usr/bin/codesign', ['--verify', '--strict', '--deep', bundle])) &&
    (await verifySignature('/usr/bin/codesign', ['--verify', '--strict', file]))
  )
    return { ok: true, source: 'sealed-app-signature', info };
  return {
    ok: false,
    code: 'executable_blocked',
    reasonKey: 'integrityFailed',
    reason: labels.integrityFailed,
  };
}
module.exports = { verifyPackagedMacSmartctl, macBinaryInfo, olderVersion, macBundleForResources };
