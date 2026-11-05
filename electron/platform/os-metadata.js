'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

// OS metadata is advisory, never used to claim SMART health. Missing values remain absent.
function positiveInt(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
function metadataResult({
  source,
  capacityBytes,
  logicalBlockSize,
  physicalBlockSize,
  identifier,
  mediaName,
  solidState,
  removable,
  ejectable,
  transport,
  internal,
}) {
  const meta = { source };
  for (const [key, value] of Object.entries({
    logicalBlockSize: positiveInt(logicalBlockSize),
    physicalBlockSize: positiveInt(physicalBlockSize),
    identifier,
    mediaName,
    solidState,
    removable,
    ejectable,
  })) {
    if (value !== undefined && value !== null && value !== '') meta[key] = value;
  }
  return {
    ...(positiveInt(capacityBytes) ? { capacityBytes: positiveInt(capacityBytes) } : {}),
    ...(Object.keys(meta).length > 1 ? { osMetadata: meta } : {}),
    ...(transport ? { transport } : {}),
    ...(typeof internal === 'boolean' ? { internal } : {}),
  };
}
function windowsMetadata(disk) {
  if (!disk || typeof disk !== 'object') return {};
  const interfaceType = String(disk.interfaceType || '').toUpperCase();
  return metadataResult({
    source: 'windows-wmi',
    capacityBytes: disk.size,
    logicalBlockSize: disk.bytesPerSector,
    identifier: disk.deviceId,
    mediaName: disk.model,
    // Win32_DiskDrive.MediaType is not a reliable SSD/HDD indicator.
    removable:
      typeof disk.mediaType === 'string' && /removable/i.test(disk.mediaType) ? true : undefined,
    transport: interfaceType === 'USB' ? 'USB' : undefined,
  });
}
function parseLinuxBlockName(name) {
  const m = /^\/dev\/(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|xvd[a-z]+|mmcblk\d+)$/.exec(String(name || ''));
  return m?.[1] || null;
}
async function linuxMetadata(name, { readFile = fs.readFile, realpath = fs.realpath } = {}) {
  const block = parseLinuxBlockName(name);
  if (!block) return {};
  const base = path.posix.join('/sys/class/block', block);
  async function read(relative) {
    try {
      return String(await readFile(path.posix.join(base, relative), 'utf8')).trim();
    } catch {
      return null;
    }
  }
  const [sectors, logical, physical, removable, rotational, model] = await Promise.all([
    read('size'),
    read('queue/logical_block_size'),
    read('queue/physical_block_size'),
    read('removable'),
    read('queue/rotational'),
    read('device/model'),
  ]);
  // Linux sysfs size always counts 512-byte sectors, even on 4K-native disks.
  const sectorCount = positiveInt(sectors);
  const capacityBytes =
    sectorCount && Number.isSafeInteger(sectorCount * 512) ? sectorCount * 512 : undefined;
  let transport;
  try {
    const target = String(await realpath(path.posix.join(base, 'device')));
    if (target.includes('/usb')) transport = 'USB';
    else if (/\/nvme\//.test(target) || block.startsWith('nvme')) transport = 'PCIe';
    else if (/\/ata\d+\//.test(target)) transport = 'SATA';
  } catch {
    if (block.startsWith('nvme')) transport = 'PCIe';
  }
  return metadataResult({
    source: 'linux-sysfs',
    capacityBytes,
    logicalBlockSize: logical,
    physicalBlockSize: physical,
    identifier: block,
    mediaName: model,
    solidState: rotational === '0' ? true : rotational === '1' ? false : undefined,
    removable: removable === '1' ? true : removable === '0' ? false : undefined,
    transport,
    internal: transport === 'USB' ? false : undefined,
  });
}
module.exports = {
  positiveInt,
  metadataResult,
  windowsMetadata,
  parseLinuxBlockName,
  linuxMetadata,
};
