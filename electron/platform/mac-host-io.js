'use strict';
// Attribute I/O counters only to an IOBlockStorageDriver whose own subtree
// contains exactly the selected *whole* BSD disk. A flat search from one driver
// marker to the next can associate a sibling's disk with the wrong counters.
const keys = Object.freeze({
  'Bytes (Read)': 'bytesRead',
  'Bytes (Write)': 'bytesWritten',
  'Operations (Read)': 'operationsRead',
  'Operations (Write)': 'operationsWrite',
  'Errors (Read)': 'errorsRead',
  'Errors (Write)': 'errorsWrite',
  'Retries (Read)': 'retriesRead',
  'Retries (Write)': 'retriesWrite',
});
function parseMacHostIo(output, devicePath) {
  const target = /^\/dev\/(disk\d+)$/.exec(devicePath)?.[1];
  if (!target || typeof output !== 'string' || Buffer.byteLength(output) > 3 * 1024 * 1024)
    return null;
  const stack = [];
  const drivers = [];
  for (const line of output.split('\n')) {
    const head = /^(.*?)\+-o\s+.*?<class\s+([^,>]+)/.exec(line);
    if (head) {
      const depth = head[1].length;
      while (stack.length && stack.at(-1).depth >= depth) stack.pop();
      const parent = stack.at(-1);
      const node = { depth, cls: head[2], driver: null };
      node.driver =
        node.cls === 'IOBlockStorageDriver'
          ? { names: new Set(), stats: {} }
          : (parent?.driver ?? null);
      if (node.cls === 'IOBlockStorageDriver') drivers.push(node.driver);
      stack.push(node);
      continue;
    }
    const node = stack.at(-1);
    if (!node?.driver) continue;
    const bsd = /"BSD Name"\s*=\s*"(disk\d+(?:s\d+)?)"/.exec(line);
    // A BSD name belongs to the IOMedia node, never to a sibling or ancestor.
    if (node.cls === 'IOMedia' && bsd) node.driver.names.add(bsd[1]);
    if (node.cls !== 'IOBlockStorageDriver') continue;
    const stats = /"Statistics"\s*=\s*\{([^}]*)\}/.exec(line)?.[1];
    if (stats)
      for (const match of stats.matchAll(/"([^"\n]+)"\s*=\s*(\d+)/g)) {
        const name = keys[match[1]];
        const count = Number(match[2]);
        if (name && Number.isSafeInteger(count)) node.driver.stats[name] = count;
      }
  }
  const hits = drivers.filter(
    (driver) => driver.names.has(target) && Object.keys(driver.stats).length > 0,
  );
  return hits.length === 1 ? hits[0].stats : null;
}
module.exports = { parseMacHostIo };
