'use strict';
// Windows inventory is read-only. Mapping is anchored in Win32_DiskDrive.Index,
// which corresponds to smartctl /dev/sdX for normal smartmontools Windows scan paths.
// No arbitrary USB adapter is selected merely because it is attached.
const { windowsMetadata } = require('./os-metadata.js');
const lettersToIndex = (name) => {
  const m = /^\/dev\/sd([a-z]+)$/.exec(String(name || '').toLowerCase());
  if (!m) return null;
  let index = 0;
  for (const char of m[1]) index = index * 26 + (char.charCodeAt(0) - 96);
  return index - 1;
};
const toText = (x) => (typeof x === 'string' ? x.trim() : '');
const norm = (x) => toText(x).toUpperCase();
const meaningful = (x) => toText(x) || null;
const hex4 = (x) =>
  typeof x === 'string' && /^[0-9A-Fa-f]{4}$/.test(x) ? `0x${x.toLowerCase()}` : null;
function usbIds(id) {
  const s = toText(id);
  return {
    vendorId: hex4(s.match(/VID_([0-9a-f]{4})/i)?.[1]),
    productId: hex4(s.match(/PID_([0-9a-f]{4})/i)?.[1]),
  };
}
function parseWindowsInventory(input, device) {
  const index = lettersToIndex(device?.name);
  if (index === null || !input || typeof input !== 'object') return {};
  const drives = Array.isArray(input.drives) ? input.drives : input.drives ? [input.drives] : [];
  const found = drives.filter(
    (d) =>
      Number(d?.index) === index &&
      new RegExp(`^\\\\\\\\\\.\\\\PHYSICALDRIVE${index}$`, 'i').test(String(d.deviceId || '')),
  );
  if (found.length !== 1) return {};
  const disk = found[0];
  const nodes = Array.isArray(disk.nodes) ? disk.nodes : [];
  const seen = new Set();
  const clean = [];
  for (const node of nodes.slice(0, 25)) {
    if (!node || typeof node !== 'object') continue;
    const id = toText(node.instanceId);
    if (!id || seen.has(norm(id))) break;
    seen.add(norm(id));
    clean.push(node);
  }
  const ids = [disk.pnpDeviceId, ...clean.map((n) => n.instanceId)].map(norm);
  const interfaceType = norm(disk.interfaceType);
  // Storage BusType identifies the actual host connection; CIM InterfaceType
  // often reports SCSI for USB/UASP and NVMe devices alike.
  const busType = norm(disk.busType);
  const usb =
    busType === 'USB' ||
    interfaceType === 'USB' ||
    ids.some(
      (s) => s.startsWith('USB\\') || s.startsWith('USBSTOR\\') || s.startsWith('UASPSTOR\\'),
    );
  const nvme =
    busType === 'NVME' || ids.some((s) => s.includes('NVME') || s.includes('NVM EXPRESS'));
  const sata =
    interfaceType === 'IDE' ||
    interfaceType === 'SATA' ||
    ids.some((s) => s.startsWith('SCSI\\DISK') && /SATA|ATA/.test(s));
  const transport = usb
    ? 'USB'
    : nvme
      ? 'PCIe'
      : busType === 'SATA'
        ? 'SATA'
        : sata
          ? 'SATA'
          : null;
  const result = {
    ...windowsMetadata(disk),
    transport,
    internal: usb ? false : transport ? true : null,
  };
  if (clean.length < 2) return result;
  const top = clean.slice().reverse();
  const chain = top.map((node, i) => {
    const id = toText(node.instanceId),
      props = usbIds(id);
    return {
      category: i === top.length - 1 ? 'disk' : i === 0 ? 'controller' : 'usb',
      name:
        meaningful(node.friendlyName) ||
        meaningful(node.description) ||
        meaningful(node.name) ||
        'PnP-Gerät',
      manufacturer: meaningful(node.manufacturer),
      ...props,
      speed: null,
      locationId: meaningful(node.location),
      serial: null,
    };
  });
  if (!chain.some((part) => part.name)) return result;
  return {
    ...result,
    connection: {
      verified: true,
      source: 'windows-pnp',
      usbDriver: ids.some((id) => id.startsWith('UASPSTOR\\'))
        ? 'uasp'
        : ids.some((id) => id.startsWith('USBSTOR\\'))
          ? 'usb-storage'
          : null,
      chain,
      adapter: usb
        ? [...chain].reverse().find((part, i) => i > 0 && part.vendorId && part.productId) || null
        : null,
    },
  };
}
// Uses built-in Windows PowerShell 5.1 cmdlets, no extra modules or admin-only APIs.
// Get-PnpDeviceProperty may be missing or restricted on some systems: optional parents
// then remain unavailable and the app reports only Win32_DiskDrive transport.
const INVENTORY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$result = @{ drives = @() }
# Parent devices (notably hubs/controllers) frequently occur in several disk chains.
# Query each distinct PnP node at most once per inventory scan.
$nodeCache = @{}
# Get-Disk.BusType is authoritative for USB/UASP, even when CIM labels it SCSI.
$busTypes = @{}
try {
  foreach ($storageDisk in @(Get-Disk -ErrorAction Stop)) {
    $busTypes[[int]$storageDisk.Number] = [string]$storageDisk.BusType
  }
} catch {
  # Continue with CIM/PnP evidence if Storage cmdlets are unavailable.
}
$keys = @('DEVPKEY_Device_Parent', 'DEVPKEY_Device_DeviceDesc', 'DEVPKEY_Device_Manufacturer', 'DEVPKEY_Device_LocationInfo')
foreach ($disk in @(Get-CimInstance Win32_DiskDrive)) {
  $entry = @{ index = [int]$disk.Index; deviceId = [string]$disk.DeviceID; model = [string]$disk.Model; size = [string]$disk.Size; bytesPerSector = [string]$disk.BytesPerSector; mediaType = [string]$disk.MediaType; serialNumber = [string]$disk.SerialNumber; interfaceType = [string]$disk.InterfaceType; pnpDeviceId = [string]$disk.PNPDeviceID; busType = [string]$busTypes[[int]$disk.Index]; nodes = @() }
  # Only USB disks need the expensive PnP parent walk. Keep CIM metadata for all disks.
  $isUsb = [string]$entry.busType -eq 'USB' -or [string]$disk.InterfaceType -eq 'USB' -or [string]$disk.PNPDeviceID -match '^(USB|USBSTOR|UASPSTOR)\\'
  if (-not $isUsb) { $result.drives += $entry; continue }
  $current = [string]$disk.PNPDeviceID
  $seen = @{}
  for ($i = 0; $i -lt 20 -and $current -and -not $seen.ContainsKey($current); $i++) {
    $seen[$current] = $true
    if (-not $nodeCache.ContainsKey($current)) {
      try {
        $device = Get-PnpDevice -InstanceId $current -ErrorAction Stop
        # One property request per node rather than four sequential requests.
        $props = @{}
        foreach ($prop in @(Get-PnpDeviceProperty -InstanceId $current -KeyName $keys -ErrorAction SilentlyContinue)) {
          if ($null -ne $prop -and $prop.KeyName) { $props[[string]$prop.KeyName] = $prop.Data }
        }
        $parent = $props['DEVPKEY_Device_Parent']
        $parentId = if ($parent -is [string]) { $parent } else { '' }
        $nodeCache[$current] = @{
          node = @{ instanceId = $current; friendlyName = [string]$device.FriendlyName; description = [string]$props['DEVPKEY_Device_DeviceDesc']; manufacturer = [string]$props['DEVPKEY_Device_Manufacturer']; location = [string]$props['DEVPKEY_Device_LocationInfo'] }
          parent = $parentId
        }
      } catch {
        # Missing or inaccessible parent data must not hide the disk itself.
        $nodeCache[$current] = @{ node = $null; parent = '' }
      }
    }
    $cached = $nodeCache[$current]
    if ($null -eq $cached.node) { break }
    $entry.nodes += $cached.node
    $current = [string]$cached.parent
    # The PCI/ACPI hierarchy above the USB host controller does not help
    # diagnose a USB port and can require many slow PnP property calls.
    if ([string]$cached.node.friendlyName -match '(?i)(xHCI|eXtensible.Hostcontroller|USB.Host.Controller)') { break }
  }
  $result.drives += $entry
}
$result | ConvertTo-Json -Depth 12 -Compress
`;
function parseInventoryOutput(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('Ungültige Windows-Geräteliste');
  return parsed;
}
module.exports = { lettersToIndex, parseWindowsInventory, parseInventoryOutput, INVENTORY_SCRIPT };
