'use strict';
// Source data is deliberately not interpreted as a device-access policy.
// Rebuild after changing vendor/usb-ids/usb.ids; generated names are UI hints only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function buildIndex(source) {
  const text = source.toString('utf8');
  const version = text.match(/^# Version:\s*([0-9.]+)/m)?.[1];
  if (!version) throw new Error('usb.ids: version missing');
  const vendors = Object.create(null);
  let active = null;
  let productCount = 0;
  for (const line of text.split(/\r?\n/)) {
    const vendor = /^([0-9a-fA-F]{4})\s{2,}([^\r\n]+)$/.exec(line);
    if (vendor) {
      const id = vendor[1].toLowerCase();
      const name = vendor[2].trim();
      if (!name || name.length > 200 || Object.hasOwn(vendors, id))
        throw new Error(`usb.ids: duplicate or invalid vendor ${id}`);
      vendors[id] = [name, Object.create(null)];
      active = vendors[id];
      continue;
    }
    if (!line.startsWith('\t') && !line.startsWith('#') && line.trim() !== '') active = null;
    // Only immediate product lines; interface definitions are excluded.
    const device = /^\t([0-9a-fA-F]{4})\s{2,}([^\r\n]+)$/.exec(line);
    if (!device || !active) continue;
    const id = device[1].toLowerCase();
    const name = device[2].trim();
    if (!name || name.length > 300 || Object.hasOwn(active[1], id))
      throw new Error(`usb.ids: duplicate or invalid product ${id}`);
    active[1][id] = name;
    productCount++;
  }
  return {
    source: 'usb.ids',
    version,
    sha256: crypto.createHash('sha256').update(source).digest('hex'),
    vendorCount: Object.keys(vendors).length,
    productCount,
    vendors,
  };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'vendor', 'usb-ids', 'usb.ids'));
  const target = path.join(root, 'vendor', 'usb-ids', 'index.json');
  const next = JSON.stringify(buildIndex(source));
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== next + '\n') {
      console.error('USB-ID-Index ist veraltet: npm run usbids:generate');
      process.exitCode = 1;
    } else console.log('USB-ID-Index ist aktuell.');
  } else {
    fs.writeFileSync(target, next + '\n');
    console.log(`USB-ID-Index erstellt: ${target}`);
  }
}
module.exports = { buildIndex };
