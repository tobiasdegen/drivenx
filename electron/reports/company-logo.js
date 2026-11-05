'use strict';
const { backendError } = require('../security/user-errors.js');

const MAX_LOGO_BYTES = 1024 * 1024;
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Read only a bounded regular file and confirm its PNG/JPEG signature. */
async function readCompanyLogo(fs, file) {
  const initial = await fs.stat(file);
  ensureLogoFile(initial);
  const handle = await fs.open(file, 'r');
  let data;
  try {
    ensureLogoFile(await handle.stat());
    // Limit the read itself, not merely the stat size: the file can grow while open.
    // One extra byte distinguishes an over-limit file from a valid 1 MiB file.
    const bounded = Buffer.alloc(MAX_LOGO_BYTES + 1);
    let total = 0;
    while (total < bounded.length) {
      const { bytesRead } = await handle.read(bounded, total, bounded.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_LOGO_BYTES) throw backendError('companyLogoTooLarge');
    data = bounded.subarray(0, total);
  } finally {
    await handle.close();
  }
  if (data.length > MAX_LOGO_BYTES) throw backendError('companyLogoTooLarge');
  const png = data.subarray(0, PNG_HEADER.length).equals(PNG_HEADER);
  const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (!png && !jpeg) throw backendError('companyLogoOnlyImages');
  return `data:image/${png ? 'png' : 'jpeg'};base64,${data.toString('base64')}`;
}

function ensureLogoFile(stat) {
  if (!stat.isFile() || stat.size > MAX_LOGO_BYTES) {
    throw backendError('companyLogoTooLarge');
  }
}

module.exports = { readCompanyLogo };
