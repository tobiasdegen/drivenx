'use strict';

const { identify } = require('./device-identity.js');
const { physicalFingerprint } = require('./scan-aliases.js');
const { performance } = require('node:perf_hooks');

// Alias detection is optional. A failing bridge must not make the device list
// wait for an unbounded series of smartctl identity timeouts.
const MAX_IDENTITY_PROBES = 4;
const IDENTITY_BUDGET_MS = 18000;
const IDENTITY_TIMEOUT_MS = 9000;

// A pathname is not a physical-drive identifier: RAID controllers can expose
// different disks through the same path using distinct -d selectors.
function accessKey(device) {
  return `${device.name}\0${device.type}`;
}

function collectAccessModes(items) {
  const modes = new Map();
  for (const item of items) {
    if (!modes.has(accessKey(item))) modes.set(accessKey(item), item);
  }
  return [...modes.values()];
}

function samePhysicalDisk(a, b) {
  const aProtocol = a?.device?.protocol;
  const bProtocol = b?.device?.protocol;
  if (aProtocol && bProtocol && aProtocol !== bProtocol) return false;
  if (
    aProtocol === 'NVMe' ||
    bProtocol === 'NVMe' ||
    a?.device?.type === 'nvme' ||
    b?.device?.type === 'nvme'
  ) {
    const aId = physicalFingerprint(a);
    return !!aId && aId === physicalFingerprint(b);
  }
  const x = identify(a);
  const y = identify(b);
  if (!x.model || !y.model || x.model !== y.model || !x.capacity || x.capacity !== y.capacity)
    return false;
  if (x.serial && y.serial && x.serial !== y.serial) return false;
  if (x.wwn && y.wwn && x.wwn !== y.wwn) return false;
  return !!((x.serial && x.serial === y.serial) || (x.wwn && x.wwn === y.wwn));
}

// Different MegaRAID target indices refer to independent controller slots.
// Never hide one just because a bridge/controller reports identical metadata.
function distinctMegaRaidTargets(first, second) {
  const a = /^megaraid,(\d+)$/.exec(first.type);
  const b = /^megaraid,(\d+)$/.exec(second.type);
  return !!a && !!b && a[1] !== b[1];
}

/**
 * Probe only conflicting selectors for the same OS path. A scan is primarily
 * an inventory: an unverified mode must remain visible rather than blocking
 * the entire list or accidentally hiding an independently addressed RAID disk.
 *
 * Alias reads are performed sequentially (the selectors may reach the same
 * physical disk), with a shared time/probe budget across all conflicts.
 * readIdentity(device, timeoutMs) must respect the supplied timeout.
 */
async function resolveAccessModes(
  devices,
  readIdentity,
  {
    maxProbes = MAX_IDENTITY_PROBES,
    budgetMs = IDENTITY_BUDGET_MS,
    now = () => performance.now(),
  } = {},
) {
  const distinct = collectAccessModes(devices);
  const groups = new Map();
  for (const device of distinct) {
    const group = groups.get(device.name) || [];
    group.push(device);
    groups.set(device.name, group);
  }
  const eliminated = new Set();
  const startedAt = now();
  let probes = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Controller-indexed members are separate targets even if serial/model
    // strings coincide. They require no probing for de-duplication.
    if (
      group.every((d) => /^megaraid,\d+$/.test(d.type)) &&
      new Set(group.map((d) => d.type)).size === group.length
    )
      continue;

    const seen = [];
    for (const [index, device] of group.entries()) {
      // Two selectors with no verified reference cannot be de-duplicated;
      // avoid a second pointless timeout if the first identity was unreadable.
      if (group.length === 2 && index === 1 && seen.length === 0) break;
      const remainingMs = Math.floor(budgetMs - (now() - startedAt));
      if (probes >= maxProbes || remainingMs <= 0) break;
      probes++;
      let raw = null;
      try {
        raw = await readIdentity(device, Math.min(IDENTITY_TIMEOUT_MS, remainingMs));
      } catch {
        /* Keep the unverified access mode. */
      }
      if (
        raw &&
        seen.some(
          (prior) =>
            !distinctMegaRaidTargets(prior.device, device) && samePhysicalDisk(prior.raw, raw),
        )
      ) {
        eliminated.add(accessKey(device));
      } else if (raw) {
        seen.push({ device, raw });
      }
    }
  }
  return distinct.filter((d) => !eliminated.has(accessKey(d)));
}

module.exports = {
  accessKey,
  collectAccessModes,
  samePhysicalDisk,
  resolveAccessModes,
  MAX_IDENTITY_PROBES,
  IDENTITY_BUDGET_MS,
};
