/** Presentation-only USB path. Never changes an OS device or a smartctl access mode. */
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const hasHardwareId = (node) => Boolean(text(node?.vendorId) || text(node?.productId));

function isHub(node) {
  const label = `${text(node?.name)} ${text(node?.usbIdNames?.productName)}`;
  return /\bhub\b/i.test(label);
}
function isBridge(node) {
  const label = `${text(node?.name)} ${text(node?.usbIdNames?.productName)}`;
  return node?.category === 'bridge' || /\bbridge\b|\bsata\b|\bnvme\b/i.test(label);
}
function connectionRole(node) {
  if (isHub(node)) return 'hub';
  if (isBridge(node)) return 'bridge';
  if (node?.category === 'controller') return 'usb'; // IOUSBHostDevice is not a host controller.
  return 'usb';
}
function sataSpeed(raw) {
  if (raw?.device?.protocol !== 'ATA') return null;
  const current = text(raw?.interface_speed?.current?.string);
  const maximum = text(raw?.interface_speed?.max?.string);
  if (current) return { label: `SATA ${current}`, kind: 'current', maximum: maximum || null };
  if (maximum) return { label: `SATA max. ${maximum}`, kind: 'maximum', maximum };
  return null;
}
function usbSpeed(node) {
  const speed = text(node?.speed);
  if (!speed) return null;
  return {
    label: /^up to\s+/i.test(speed)
      ? `USB up to ${speed.replace(/^up to\s+/i, '')}`
      : `USB ${speed}`,
    kind: /^up to\s+/i.test(speed) ? 'maximum' : 'reported',
  };
}
function usbDevices(chain) {
  if (!Array.isArray(chain)) return [];
  const nodes = chain
    .filter((node) => node && typeof node === 'object')
    .map((node) => ({ ...node }));
  // IOMedia / SCSI inquiry are representations of the same storage path, not
  // automatically independent physical USB devices. Retain their reported name.
  if (nodes.length >= 2) {
    const last = nodes.at(-1);
    if (last.category === 'disk' && !hasHardwareId(last) && !text(last.speed)) {
      const previous = nodes.at(-2);
      // Only merge a leaf SCSI/IOMedia representation with a positively
      // identified storage adapter. A hub or an anonymous parent is NOT proof
      // that two entries represent the same physical device.
      if (hasHardwareId(previous) && !isHub(previous) && isBridge(previous)) {
        if (text(last.name) && text(last.name) !== text(previous.name))
          previous.inquiryName = last.name;
        nodes.pop();
      }
    }
  }
  return nodes;
}
function modelHints(node) {
  const vendor = text(node.usbIdNames?.vendorName);
  const product = text(node.usbIdNames?.productName);
  if (!vendor && !product) return null;
  // A comma-separated USB ID product may enumerate multiple interchangeable
  // controller models. It is not a reliable device identification.
  const ambiguous = product.includes(',') || /\bor\b|\/\s*ASM\d/i.test(product);
  return { vendor, product, ambiguous };
}
function buildConnectionPath(device, raw, platform = '') {
  const chain = usbDevices(device?.connection?.chain);
  const stages = [
    {
      kind: 'host',
      name: platform === 'darwin' ? 'Mac' : 'Computer',
      role: 'host',
      node: null,
      link: null,
      hints: null,
      inquiryName: null,
    },
    ...chain.map((node) => ({
      kind: 'usb',
      name: text(node.name),
      role: connectionRole(node),
      node,
      link: usbSpeed(node),
      hints: modelHints(node),
      inquiryName: text(node.inquiryName) || null,
    })),
    {
      kind: 'drive',
      name:
        text(raw?.model_name) ||
        text(device?.info_name) ||
        text(device?.osMetadata?.mediaName) ||
        text(device?.name),
      role: 'drive',
      node: null,
      link: sataSpeed(raw),
      hints: null,
      inquiryName: null,
    },
  ];
  const sata = sataSpeed(raw);
  const known = stages.some((stage) => stage.link !== null);
  let summary = 'unknown';
  if (sata?.kind === 'current' && sata.maximum) {
    const speed = (s) => {
      const m = /([\d.,]+)\s*Gb\/s/i.exec(s);
      return m ? Number(m[1].replace(',', '.')) : null;
    };
    const current = speed(sata.label);
    const maximum = speed(sata.maximum);
    if (current !== null && maximum !== null && current < maximum) summary = 'sata-lower';
  }
  return { stages, summary, hasSpeeds: known, hasSataMaximumOnly: sata?.kind === 'maximum' };
}
/** Text for the explicit "copy identifiers" action; never invent an absent VID/PID. */
function formatConnectionIdentifiers(stage, labels = {}) {
  const node = stage?.node;
  return [
    text(node?.name) || text(stage?.name),
    text(node?.vendorId) && `VID: ${text(node.vendorId)}`,
    text(node?.productId) && `PID: ${text(node.productId)}`,
    text(node?.locationId) && `${labels.location || 'Location'}: ${text(node.locationId)}`,
    text(stage?.inquiryName) && `${labels.inquiry || 'Inquiry'}: ${text(stage.inquiryName)}`,
    text(stage?.hints?.vendor) &&
      `${labels.vendor || 'USB ID vendor'}: ${text(stage.hints.vendor)}`,
    text(stage?.hints?.product) &&
      `${labels.product || 'USB ID product'}: ${text(stage.hints.product)}`,
  ]
    .filter(Boolean)
    .join('\n');
}
export { buildConnectionPath, usbDevices, connectionRole, sataSpeed, formatConnectionIdentifiers };
