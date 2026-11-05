'use strict';

// Prefer a name tied to the same BSD whole-disk over the path-only placeholder.
// Never invent a model from USB VID/PID: a bridge may expose many SSD models.
function usefulName(value) {
  if (typeof value !== 'string') return null;
  const clean = value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+Media$/i, '')
    .trim();
  if (!clean || clean.length > 180 || /[\x00-\x1f\x7f]/.test(value)) return null;
  if (/^(?:\/dev\/)?disk\d+$/i.test(clean)) return null;
  if (
    /^(?:USB(?: Mass)? Storage(?: Device)?|External(?: USB)?(?: Disk| Drive| Media)?|Mass Storage|Generic(?: Storage)?|Disk Media|Untitled|Media|Storage Device|Physical Disk)$/i.test(
      clean,
    )
  )
    return null;
  return clean;
}

function macDisplayName(device, basic, connection) {
  const existing = usefulName(device.info_name);
  const osName = usefulName(basic.osMetadata?.mediaName);
  // The connection is bound to the exact BSD disk by the IOKit / profiler parser.
  const last =
    connection?.verified && Array.isArray(connection.chain) ? connection.chain.at(-1) : null;
  const boundName = last?.category === 'disk' ? usefulName(last.name) : null;
  return existing || osName || boundName || device.info_name || device.name;
}

module.exports = { macDisplayName, usefulName };
