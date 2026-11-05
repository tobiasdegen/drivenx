'use strict';
// smartctl on Windows may expose one NVMe controller through /dev/sdX and
// /dev/nvmeX. Never collapse entries based on model, size or path alone.
const { identify } = require('./device-identity.js');

const isWindowsNvme = (d) =>
  d?.type === 'nvme' &&
  (/^\/dev\/sd[a-z]+$/i.test(d.name) || /^\/dev\/nvme\d+(?:n\d+)?$/i.test(d.name));

function possibleWindowsAliases(devices) {
  if (!Array.isArray(devices)) return [];
  const candidates = devices.filter(isWindowsNvme);
  // Do not query disks unnecessarily. This check targets the observed dual
  // NVMe access paths, not distinct SATA disks or a set of NVMe controllers.
  if (
    !candidates.some((d) => /^\/dev\/sd[a-z]+$/i.test(d.name)) ||
    !candidates.some((d) => /^\/dev\/nvme\d+/i.test(d.name))
  )
    return [];
  return candidates;
}

function namespaceSignature(raw) {
  const namespaces = raw?.nvme_namespaces;
  // Do not merge distinct namespaces just because they share a controller serial.
  if (!Array.isArray(namespaces) || namespaces.length === 0) return null;
  const parts = [];
  for (const ns of namespaces) {
    if (
      !Number.isSafeInteger(ns?.id) ||
      ns.id < 1 ||
      !Number.isSafeInteger(ns?.size?.bytes) ||
      ns.size.bytes < 1
    )
      return null;
    const oui = ns?.eui64?.oui;
    const extId = ns?.eui64?.ext_id;
    const eui =
      Number.isSafeInteger(oui) && Number.isSafeInteger(extId) && (oui > 0 || extId > 0)
        ? `${oui}:${extId}`
        : '';
    parts.push(`${ns.id}:${ns.size.bytes}:${eui}`);
  }
  return parts.sort().join('|');
}

function physicalFingerprint(raw) {
  if (raw?.device?.type !== 'nvme' && raw?.device?.protocol !== 'NVMe') return null;
  const id = identify(raw);
  const namespaces = namespaceSignature(raw);
  if (!id.serial || !id.model || !id.capacity || !namespaces) return null;
  const controller = raw.nvme_controller_id;
  if (controller !== undefined && (!Number.isSafeInteger(controller) || controller < 0))
    return null;
  // A namespace signature prevents hiding two distinct namespaces on one SSD.
  return JSON.stringify([id.serial, id.model, id.capacity, namespaces, controller ?? null]);
}

async function findWindowsNvmeAliases(devices, readIdentity) {
  const candidates = possibleWindowsAliases(devices);
  if (!candidates.length) return [];
  const results = new Array(candidates.length);
  // Limit extra disk probes to two at a time; the caller runs this after the
  // initial device list has already been returned to the renderer.
  const workers = Array.from({ length: Math.min(2, candidates.length) }, async (_, worker) => {
    for (let i = worker; i < candidates.length; i += 2) {
      try {
        results[i] = physicalFingerprint(await readIdentity(candidates[i]));
      } catch {
        results[i] = null; // An unidentifiable drive must remain visible.
      }
    }
  });
  await Promise.all(workers);
  const byIdentity = new Map();
  results.forEach((fingerprint, index) => {
    if (!fingerprint) return;
    const members = byIdentity.get(fingerprint) || [];
    members.push({ name: candidates[index].name, type: candidates[index].type });
    byIdentity.set(fingerprint, members);
  });
  return [...byIdentity.values()].filter(
    (group) =>
      group.length > 1 &&
      group.some((d) => /^\/dev\/sd[a-z]+$/i.test(d.name)) &&
      group.some((d) => /^\/dev\/nvme\d+/i.test(d.name)),
  );
}

module.exports = { possibleWindowsAliases, physicalFingerprint, findWindowsNvmeAliases };
