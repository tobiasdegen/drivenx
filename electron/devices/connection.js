'use strict';
// system_profiler SPUSBDataType -json is a documented macOS inventory source.
// Never associate an arbitrary USB adapter with a disk just because both are present.
const asText = (v) => (typeof v === 'string' ? v.trim() : '');
const diskId = (s) => (String(s || '').match(/\bdisk\d+\b/i) || [])[0]?.toLowerCase() || null;
function matchesDisk(node, target) {
  for (const key of [
    'bsd_name',
    'bsdName',
    'bsd_device',
    'device_identifier',
    'device_node',
    '_name',
  ]) {
    if (key === '_name' && !/^disk\d+$/i.test(asText(node[key]))) continue;
    if (diskId(node[key]) === target && /^(?:\/dev\/)?disk\d+$/i.test(asText(node[key])))
      return true;
  }
  return false;
}
const children = (node) =>
  Object.values(node).flatMap((value) =>
    Array.isArray(value) ? value.filter((x) => x && typeof x === 'object') : [],
  );
function makePart(node, category) {
  return {
    category,
    name: asText(node._name) || asText(node.name) || null,
    manufacturer: asText(node.manufacturer) || asText(node.vendor) || null,
    vendorId: asText(node.vendor_id) || null,
    productId: asText(node.product_id) || null,
    speed: asText(node.speed) || null,
    locationId: asText(node.location_id) || null,
    serial: asText(node.serial_num) || null,
  };
}
function parseUsbProfiler(json, devicePath) {
  const target = diskId(devicePath);
  if (!target || !/^\/dev\/disk\d+$/.test(devicePath)) return null;
  const roots = Array.isArray(json?.SPUSBDataType) ? json.SPUSBDataType : [];
  const visit = (node, ancestors = []) => {
    if (!node || typeof node !== 'object') return null;
    const path = [...ancestors, node];
    if (matchesDisk(node, target)) return path;
    for (const child of children(node)) {
      const found = visit(child, path);
      if (found) return found;
    }
    return null;
  };
  for (const root of roots) {
    const chain = visit(root);
    if (!chain) continue;
    const mapped = chain
      .map((node, index) =>
        makePart(node, index === chain.length - 1 ? 'disk' : index === 0 ? 'controller' : 'usb'),
      )
      .filter((x) => x.name || x.manufacturer || x.vendorId || x.productId);
    return {
      source: 'system_profiler',
      verified: true,
      chain: mapped,
      adapter: mapped.length > 1 ? mapped[mapped.length - 2] : null,
    };
  }
  return null;
}
// IORegistry service plane preserves the actual parent chain from IOMedia to USB bridge.
// Unlike system_profiler this works on macOS versions that return SPUSBDataType: [].
function parseIoregTree(output, devicePath) {
  const target = diskId(devicePath);
  if (!target || devicePath !== `/dev/${target}` || typeof output !== 'string') return null;
  const stack = [];
  let matched = null;
  for (const line of output.split('\n')) {
    const header = /^(.*?)\+-o (.*?) {2}<class ([^,>]+)/.exec(line);
    if (header) {
      const depth = header[1].length;
      while (stack.length && stack.at(-1).depth >= depth) stack.pop();
      stack.push({ depth, name: header[2].trim(), cls: header[3], props: {} });
      continue;
    }
    if (!stack.length) continue;
    const prop = /"([^"\n]+)"\s*=\s*(?:"([^"\n]*)"|(\d+))/.exec(line);
    if (prop) {
      const node = stack.at(-1);
      // Limit properties to the keys needed for connection details.
      if (
        [
          'BSD Name',
          'USB Product Name',
          'USB Vendor Name',
          'UsbLinkSpeed',
          'idVendor',
          'idProduct',
          'locationID',
          'USB Serial Number',
        ].includes(prop[1])
      )
        node.props[prop[1]] = prop[2] ?? prop[3];
      if (node.cls === 'IOMedia' && prop[1] === 'BSD Name' && prop[2] === target && !matched)
        matched = stack.map((n) => ({ name: n.name, cls: n.cls, props: { ...n.props } }));
    }
  }
  if (!matched) return null;
  const usb = matched.filter((n) => n.cls === 'IOUSBHostDevice');
  if (!usb.length) return null;
  const parts = usb.map((n, i) => ({
    category: i === 0 ? 'controller' : 'usb',
    name: n.props['USB Product Name'] || n.name.replace(/@.*$/, ''),
    manufacturer: n.props['USB Vendor Name'] || null,
    vendorId:
      n.props.idVendor !== undefined
        ? '0x' + Number(n.props.idVendor).toString(16).padStart(4, '0')
        : null,
    productId:
      n.props.idProduct !== undefined
        ? '0x' + Number(n.props.idProduct).toString(16).padStart(4, '0')
        : null,
    speed: n.props.UsbLinkSpeed !== undefined ? `${Number(n.props.UsbLinkSpeed) / 1e9} Gb/s` : null,
    locationId:
      n.props.locationID !== undefined
        ? '0x' + Number(n.props.locationID).toString(16).padStart(8, '0')
        : null,
    serial: n.props['USB Serial Number'] || null,
  }));
  parts.push({
    category: 'disk',
    name: matched.at(-1).name,
    manufacturer: null,
    vendorId: null,
    productId: null,
    speed: null,
    locationId: null,
    serial: null,
  });
  return {
    source: 'ioreg',
    verified: true,
    chain: parts,
    adapter: parts.at(-2),
    usbDriver: matched.some((n) => n.cls === 'IOUSBMassStorageUASDriver') ? 'uasp' : null,
  };
}
module.exports = { parseUsbProfiler, parseIoregTree };
