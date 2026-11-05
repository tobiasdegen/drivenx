'use strict';
const fs = require('node:fs');
const path = require('node:path');

// macOS exposes /var and /tmp as OS-managed symlinks to /private.
// Canonicalize *only* these known system prefixes. Do not resolve arbitrary
// symlinks: those inside application-controlled data paths must be rejected.
function canonicalSystemPath(input, platform = process.platform) {
  const absolute = path.resolve(input);
  if (platform !== 'darwin') return absolute;
  for (const prefix of ['/var', '/tmp']) {
    if (absolute !== prefix && !absolute.startsWith(prefix + path.sep)) continue;
    const expected = `/private${prefix}`;
    try {
      if (fs.lstatSync(prefix).isSymbolicLink() && fs.realpathSync(prefix) === expected) {
        return expected + absolute.slice(prefix.length);
      }
    } catch {
      // The caller's ordinary directory validation will report the problem.
    }
  }
  return absolute;
}
module.exports = { canonicalSystemPath };
