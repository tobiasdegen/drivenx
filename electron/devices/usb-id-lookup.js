'use strict';
const fs = require('node:fs');
const path = require('node:path');

// This lookup supplies *display names only*. Never use its results to select
// a smartctl -d selector, validate device identity or assess drive health.
function normalizeUsbId(value) {
  if (typeof value !== 'string') return null;
  const text = String(value).trim().replace(/^0x/i, '');
  return /^[0-9a-f]{4}$/i.test(text) ? text.toLowerCase() : null;
}

function indexPath() {
  const packagedFile =
    process.resourcesPath && path.join(process.resourcesPath, 'usb-ids', 'index.json');
  if (packagedFile && fs.existsSync(packagedFile)) return packagedFile;
  return path.join(__dirname, '..', '..', 'vendor', 'usb-ids', 'index.json');
}

function createUsbIdLookup({ file = indexPath(), read = fs.readFileSync } = {}) {
  let data;
  function load() {
    if (data !== undefined) return data;
    try {
      // A corrupt or missing optional database must not prevent device discovery.
      const bytes = read(file);
      if (bytes.length > 2 * 1024 * 1024) throw new Error('USB-ID-Index zu groß');
      const parsed = JSON.parse(bytes.toString('utf8'));
      data =
        parsed?.source === 'usb.ids' &&
        /^[0-9.]+$/.test(parsed.version) &&
        parsed.vendors &&
        typeof parsed.vendors === 'object'
          ? parsed
          : null;
    } catch {
      data = null;
    }
    return data;
  }
  function lookup(vendorId, productId) {
    const vid = normalizeUsbId(vendorId);
    if (!vid) return null;
    const index = load();
    const vendor = index?.vendors?.[vid];
    if (!Array.isArray(vendor) || typeof vendor[0] !== 'string') return null;
    const pid = normalizeUsbId(productId);
    const productName = pid && Object.hasOwn(vendor[1] || {}, pid) ? vendor[1][pid] : null;
    return {
      vendorName: vendor[0],
      productName: typeof productName === 'string' ? productName : null,
      source: 'usb.ids',
      version: index.version,
    };
  }
  return { lookup };
}

const defaultLookup = createUsbIdLookup();
function enrichUsbNames(device, resolver = defaultLookup) {
  if (
    device?.transport?.toLowerCase() !== 'usb' ||
    device.connection?.verified !== true ||
    !Array.isArray(device.connection.chain)
  )
    return device;
  const append = (node) => {
    if (!node || typeof node !== 'object') return node;
    const match = resolver.lookup(node.vendorId, node.productId);
    return match ? { ...node, usbIdNames: match } : node;
  };
  const connection = device.connection;
  return {
    ...device,
    connection: {
      ...connection,
      chain: connection.chain.map(append),
      ...(connection.adapter ? { adapter: append(connection.adapter) } : {}),
    },
  };
}
module.exports = { normalizeUsbId, createUsbIdLookup, enrichUsbNames };
