// Windows metadata is advisory. Never replace a selected device identity or
// resurrect disks removed by a later scan when asynchronous enrichment arrives.
const key = (device) => `${device.name}\u0000${device.type}`;
/**
 * @param {import('./types').Device[]} current
 * @param {import('./types').Device[]} updates
 * @returns {import('./types').Device[]}
 */
export function mergeScanMetadata(current, updates) {
  if (!Array.isArray(updates) || !updates.length) return current;
  const byKey = new Map(updates.map((device) => [key(device), device]));
  return current.map((device) => {
    const update = byKey.get(key(device));
    if (!update) return device;
    return {
      ...device,
      // Only OS metadata. Do not change smartctl's device access parameters.
      capacityBytes:
        Number.isSafeInteger(update.capacityBytes) && update.capacityBytes > 0
          ? update.capacityBytes
          : device.capacityBytes,
      osMetadata: update.osMetadata ?? device.osMetadata,
      transport: update.transport ?? device.transport,
      internal: typeof update.internal === 'boolean' ? update.internal : device.internal,
      connection: update.connection ?? device.connection,
    };
  });
}

// Windows smartctl can report one NVMe SSD by two access paths. Only
// independently verified groups are eligible for collapse.
/**
 * @param {import('./types').Device[]} current
 * @param {Pick<import('./types').Device, 'name' | 'type'>[][]} groups
 * @param {string} selectedKey
 * @returns {import('./types').Device[]}
 */
export function collapseScanAliases(current, groups, selectedKey) {
  if (!Array.isArray(groups) || !groups.length) return current;
  const all = new Map(current.map((device) => [key(device), device]));
  const hidden = new Set();
  const enriched = new Map();
  for (const group of groups) {
    if (!Array.isArray(group) || group.length < 2) continue;
    const members = group.map((entry) => all.get(key(entry))).filter(Boolean);
    if (members.length < 2) continue;
    // Preserve an active access path (and its reportId) where possible.
    const keep =
      members.find((entry) => key(entry) === selectedKey) ||
      members.find((entry) => /^\/dev\/nvme\d+/i.test(entry.name)) ||
      members[0];
    // A verified alias can supply missing fields even if the retained access
    // path already has *some* metadata. Never replace values obtained for the
    // retained path (including explicit false); the alternative transport is
    // not necessarily authoritative for its current smartctl access path.
    const merged = supplementMissing(
      keep,
      members.filter((member) => member !== keep),
    );
    if (merged !== keep) enriched.set(key(keep), merged);
    for (const member of members) if (key(member) !== key(keep)) hidden.add(key(member));
  }
  if (!hidden.size) return current;
  return current
    .filter((device) => !hidden.has(key(device)))
    .map((device) => enriched.get(key(device)) || device);
}

/** Fill gaps only; a verified alias has a shared identity, not authority to
 * replace the retained path's own connection, transport, or OS metadata. */
function supplementMissing(device, candidates) {
  let merged = device;
  for (const candidate of candidates) {
    for (const [field, value] of Object.entries(optionalMetadata(candidate))) {
      if (merged[field] !== undefined && merged[field] !== null && merged[field] !== '') continue;
      if (field === 'capacityBytes' && (!Number.isSafeInteger(value) || value <= 0)) continue;
      if (field === 'internal' && typeof value !== 'boolean') continue;
      if (field === 'transport' && (typeof value !== 'string' || !value.trim())) continue;
      if (merged === device) merged = { ...device };
      merged[field] = value;
    }
  }
  return merged;
}

const hasMetadata = (d) =>
  !!(
    d?.capacityBytes ||
    d?.osMetadata ||
    d?.transport ||
    d?.connection ||
    typeof d?.internal === 'boolean'
  );
const optionalMetadata = (d) =>
  Object.fromEntries(
    ['capacityBytes', 'osMetadata', 'transport', 'internal', 'connection']
      .filter((name) => d[name] !== undefined)
      .map((name) => [name, d[name]]),
  );

// PhysicalDrive CIM metadata is normally indexed as /dev/sdX. Copy its
// optional metadata only to an identity-verified alias, without ever changing
// the actual smartctl name/type to which the renderer sends commands.
/**
 * @param {import('./types').Device[]} current
 * @param {import('./types').Device[]} updates
 * @param {Pick<import('./types').Device, 'name' | 'type'>[][]} groups
 * @returns {import('./types').Device[]}
 */
export function mergeAliasMetadata(current, updates, groups) {
  if (!Array.isArray(groups) || !groups.length) return mergeScanMetadata(current, updates);
  const byKey = new Map((Array.isArray(updates) ? updates : []).map((d) => [key(d), d]));
  return current.map((device) => {
    const direct = byKey.get(key(device));
    // Direct OS inventory for this exact access path takes precedence.
    const primary = direct ? mergeScanMetadata([device], [direct])[0] : device;
    const group = groups.find(
      (g) => Array.isArray(g) && g.some((alias) => key(alias) === key(device)),
    );
    if (!group) return primary;
    // A second, identity-verified access path may fill missing fields, but
    // must never overwrite the current path's directly collected metadata.
    const indirect = group
      .filter((alias) => key(alias) !== key(device))
      .map((alias) => byKey.get(key(alias)))
      .filter(hasMetadata);
    return supplementMissing(primary, indirect);
  });
}
