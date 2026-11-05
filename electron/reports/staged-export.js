'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

/**
 * Stage user-selected exports in the destination directory. Revoked snapshots
 * never replace the selected file before the final synchronous validity check.
 *
 * The rename request is the commit boundary. A rescan that happens while an
 * already requested filesystem rename is in flight cannot be rolled back
 * safely (the target may have existed before). The post-check ensures that
 * such a race is never reported as a successful export.
 */
async function stagedExport(
  destination,
  data,
  { writeFile = fs.writeFile, renameFile = fs.rename, removeFile = fs.rm, assertCurrent },
) {
  const temporary = path.join(
    path.dirname(destination),
    `.drivenx-${process.pid}-${randomBytes(12).toString('hex')}.tmp`,
  );
  try {
    const options = { flag: 'wx', mode: 0o600 };
    if (typeof data === 'string') options.encoding = 'utf8';
    await writeFile(temporary, data, options);
    // This callback must be synchronous: an await between check and rename
    // would open a new revocation window.
    assertCurrent();
    await renameFile(temporary, destination);
    assertCurrent();
  } catch (error) {
    await removeFile(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { stagedExport };
