'use strict';
const path = require('node:path');
const { MAX_DEVICE_NAME_LENGTH, MAX_DEVICE_TYPE_LENGTH } = require('../../shared/device-limits.js');
const fs = require('node:fs');
const { runSmartProcess } = require('./smart-process.js');
const { sessionQueryLog } = require('../data/query-log.js');
const { verifyBundledBinaryAsync } = require('../platform/bundled-smartctl.js');
const { verifyPackagedMacSmartctl } = require('../platform/mac-smartctl-integrity.js');
const { verifiedDriveDatabaseAsync } = require('./drive-database.js');
const { app } = require('electron');
const { parseUsbProfiler, parseIoregTree } = require('./connection.js');
const { resolveMacConnections } = require('../platform/mac-connection-scan.js');
const { parseApplePlist } = require('../platform/apple-plist.js');
const { linuxMetadata } = require('../platform/os-metadata.js');
const {
  SMARTCTL_PATHS,
  findTrustedExecutable,
  linuxSmartInvocation,
  needsRootAccess,
} = require('../platform/linux-smartctl.js');
const { linuxSmartSession } = require('../platform/linux-smart-session.js');
const { resolveAccessModes } = require('./scan-access-modes.js');
const { needsUsbMediaChoice } = require('../../shared/usb-media-choice.mjs');
const {
  validScanUsbMode,
  applyScanUsbMode,
  mergeOpenedAndListed,
} = require('../../shared/scan-usb-mode.mjs');

function binaryCandidates() {
  const exe = process.platform === 'win32' ? 'smartctl.exe' : 'smartctl';
  const base = app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, '..', '..', 'vendor');
  const folder = path.join(base, 'smartmontools');
  if (process.platform === 'linux') return [...SMARTCTL_PATHS];
  const names = [path.join(folder, process.platform, exe)];
  if (!app.isPackaged && process.platform === 'darwin')
    names.push('/opt/homebrew/bin/smartctl', '/usr/local/bin/smartctl');
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    names.push(path.join(pf, 'smartmontools', 'bin', exe));
  }
  // Never resolve a bare executable through the working directory/PATH.
  // A local planted smartctl.exe must not be executed implicitly.
  return names;
}
// Check on every use, without caching a digest after a file is replaced.
// Asynchronous hashing avoids blocking Electron's main event loop.
async function lookupBinaryAsync() {
  let failure = null;
  if (process.platform === 'linux') {
    return { binary: await findTrustedExecutable(SMARTCTL_PATHS), failure: null };
  }
  for (const candidate of binaryCandidates()) {
    if (!path.isAbsolute(candidate)) continue;
    if (app.isPackaged) {
      if (process.platform === 'darwin' && process.arch === 'arm64') {
        const result = await verifyPackagedMacSmartctl(candidate, {
          resourcesPath: process.resourcesPath,
          hostVersion: process.getSystemVersion(),
        });
        if (result.ok) return { binary: candidate, failure: null };
        failure = result;
      } else if (await verifyBundledBinaryAsync(candidate, { packaged: true })) {
        return { binary: candidate, failure: null };
      }
    } else {
      try {
        if ((await fs.promises.stat(candidate)).isFile())
          return { binary: candidate, failure: null };
      } catch {
        // Try the next configured candidate.
      }
    }
  }
  return { binary: null, failure };
}
function runSmart(args, timeout = 18000) {
  return sessionQueryLog.track(args, async () => {
    const [database, resolved] = await Promise.all([
      process.platform === 'linux'
        ? Promise.resolve(null)
        : verifiedDriveDatabaseAsync({ packaged: app.isPackaged }),
      lookupBinaryAsync(),
    ]);
    if (!resolved.binary && resolved.failure) {
      throw Object.assign(new Error(resolved.failure.reason), {
        code: resolved.failure.code,
        macIntegrityKey: resolved.failure.reasonKey,
        macIntegrityValues: resolved.failure.reasonValues,
      });
    }
    // Linux uses the distribution's own DriveDB. A root-run smartctl cannot
    // reliably read an AppImage FUSE mount, and no writable app data may be
    // passed to a privileged process as a database.
    const safeArgs = database ? ['-B', database, ...args] : args;
    if (
      process.platform === 'linux' &&
      resolved.binary &&
      needsRootAccess(safeArgs) &&
      (await linuxSmartSession.available())
    ) {
      return linuxSmartSession.run(resolved.binary, safeArgs, timeout);
    }
    const invocation =
      process.platform === 'linux' && resolved.binary
        ? await linuxSmartInvocation(resolved.binary, safeArgs)
        : { executable: resolved.binary, args: safeArgs };
    return runSmartProcess(invocation.executable, invocation.args, { timeout });
  });
}

// macOS: --scan-open can return no devices when opening disks is restricted.
// diskutil can still enumerate physical whole disks without administrator rights.
function parseDiskutilList(output) {
  const names = [...output.matchAll(/^\/dev\/(disk\d+)\s+\(([^\n)]*)\):/gm)]
    .filter(([, , description]) => /\bphysical\b/i.test(description))
    .map(([, disk]) => ({ name: `/dev/${disk}`, type: 'auto', info_name: `/dev/${disk}` }));
  return [...new Map(names.map((d) => [d.name, d])).values()];
}
// `-plist physical` requests *only physical whole disks*. Disk images and
// synthesized APFS devices are omitted by diskutil rather than guessed from a name.
function parseDiskutilPhysicalList(output) {
  const data = parseApplePlist(output);
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Unerwartete diskutil-Laufwerksliste');
  const disks = Array.isArray(data.AllDisksAndPartitions)
    ? data.AllDisksAndPartitions.map((item) => item?.DeviceIdentifier)
    : Array.isArray(data.WholeDisks)
      ? data.WholeDisks
      : null;
  if (!disks) throw new Error('diskutil-Laufwerksliste enthält keine ganzen Geräte');
  return [...new Set(disks.filter((id) => typeof id === 'string' && /^disk\d+$/.test(id)))].map(
    (id) => ({ name: `/dev/${id}`, type: 'auto', info_name: `/dev/${id}` }),
  );
}
const { runTextProcess } = require('../security/text-process.js');
function runText(executable, args, timeout = 15000, maxOutput = 1024 * 1024) {
  // These are the actual OS reads performed by discovery/connection metadata.
  // Only known system commands are classified; no renderer-provided shell text.
  const mode =
    executable === '/usr/sbin/diskutil' && args[0] === 'list'
      ? args.includes('-plist')
        ? 'diskutil-list'
        : 'diskutil-list-text'
      : executable === '/usr/sbin/diskutil' && args[0] === 'info'
        ? 'diskutil-info'
        : executable === '/usr/sbin/ioreg'
          ? 'ioreg-usb'
          : executable === '/usr/sbin/system_profiler'
            ? 'system-profiler-usb'
            : null;
  const run = () => runTextProcess(executable, args, { timeout, maxOutput });
  return mode
    ? sessionQueryLog.trackSystem(mode, run, mode === 'diskutil-info' ? args[2] : null)
    : run();
}
// The ATA/NVMe protocol describes the command set, not the physical host bus.
// diskutil exposes physical transport independently on macOS.
function parseDiskutilInfo(text) {
  const data = parseApplePlist(text);
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Unerwartete diskutil-Informationen');
  const str = (key) =>
    typeof data[key] === 'string' && data[key].trim() ? data[key].trim() : undefined;
  const bool = (key) => (typeof data[key] === 'boolean' ? data[key] : undefined);
  const positive = (value) => (Number.isSafeInteger(value) && value > 0 ? value : undefined);
  const capacityBytes = positive(data.TotalSize) ?? positive(data.Size);
  const osMetadata = {
    source: 'diskutil',
    ...(positive(data.DeviceBlockSize) ? { logicalBlockSize: data.DeviceBlockSize } : {}),
    ...(positive(data.PhysicalBlockSize) ? { physicalBlockSize: data.PhysicalBlockSize } : {}),
    ...(str('DeviceIdentifier') ? { identifier: str('DeviceIdentifier') } : {}),
    ...(str('MediaName') ? { mediaName: str('MediaName') } : {}),
    ...(bool('SolidState') !== undefined ? { solidState: bool('SolidState') } : {}),
    ...(bool('Removable') !== undefined || bool('RemovableMedia') !== undefined
      ? { removable: bool('Removable') ?? bool('RemovableMedia') }
      : {}),
    ...(bool('Ejectable') !== undefined ? { ejectable: bool('Ejectable') } : {}),
  };
  return {
    ...(capacityBytes === undefined ? {} : { capacityBytes }),
    ...(Object.keys(osMetadata).length > 1 ? { osMetadata } : {}),
    transport: str('BusProtocol') || null,
    internal: bool('Internal') ?? null,
    physical: str('VirtualOrPhysical') || null,
  };
}
async function connectionForDevice(device, usbInventory = null, ioTree = null) {
  if (process.platform !== 'darwin' || !/^\/dev\/disk\d+$/.test(device.name)) return {};
  try {
    const text = await runText('/usr/sbin/diskutil', ['info', '-plist', device.name]);
    const basic = parseDiskutilInfo(text);
    const usb =
      basic.transport?.toLowerCase() === 'usb'
        ? (usbInventory && parseUsbProfiler(usbInventory, device.name)) ||
          (ioTree && parseIoregTree(ioTree, device.name)) ||
          null
        : null;
    return { ...basic, connection: usb };
  } catch {
    return {};
  }
}
async function scanDevices(
  preferredUsbMode = 'auto',
  { runSmartProbe = runSmart, platform = process.platform } = {},
) {
  if (!validScanUsbMode(preferredUsbMode)) throw new Error('Invalid USB scan access mode');
  const warnings = [];
  const automatic = preferredUsbMode === 'auto';
  const discovered = { opened: [], listed: [] };
  // --scan does not open disks. Inspect unverified USB-to-NVMe selector hints *before*
  // --scan-open, which could otherwise block on an NVMe Identify timeout.
  // The policy is selector-based and never consults adapter VID/PID exceptions.
  // Other devices retain the verified --scan-open discovery path.
  const queries = automatic ? ['--scan', '--scan-open'] : ['--scan'];
  for (const flag of queries) {
    if (flag === '--scan-open' && discovered.listed.some((d) => d.requiresUsbChoice)) break;
    try {
      const result = await runSmartProbe([flag, '-j'], 25000);
      for (const d of result.json.devices || []) {
        try {
          const safe = safeDevice(d);
          const initial = {
            ...safe,
            info_name: typeof d.info_name === 'string' ? d.info_name.slice(0, 300) : safe.name,
          };
          const requiresUsbChoice =
            automatic && flag === '--scan' && needsUsbMediaChoice(initial, platform);
          const resolved = automatic
            ? {
                ...initial,
                type: safe.type,
                ...(requiresUsbChoice ? { requiresUsbChoice: true, transport: 'USB' } : {}),
              }
            : applyScanUsbMode(initial, preferredUsbMode);
          discovered[flag === '--scan-open' ? 'opened' : 'listed'].push(resolved);
        } catch {
          /* Unsupported or malformed entry. */
        }
      }
      if (result.json.smartctl?.messages?.some((m) => m.severity === 'error'))
        warnings.push('smartctlAccessLimited');
    } catch (err) {
      warnings.push(err.message);
      if (err.code === 'executable_blocked' || err.code === 'missing_binary') break;
    }
  }
  const combined = automatic
    ? mergeOpenedAndListed(discovered.opened, discovered.listed)
    : discovered.listed;
  const devices = new Map();
  for (const d of combined) {
    const key = deviceKey(d);
    if (!devices.has(key)) devices.set(key, d);
  }
  if (platform === 'darwin') {
    try {
      let physicalDisks;
      try {
        const raw = await runText('/usr/sbin/diskutil', ['list', '-plist', 'physical'], 15000);
        physicalDisks = parseDiskutilPhysicalList(raw);
        // An empty *valid* physical inventory is meaningful, not a reason to
        // enumerate synthesized APFS disks via the legacy text fallback.
      } catch {
        // Compatibility fallback for older/atypical diskutil versions.
        physicalDisks = parseDiskutilList(await runText('/usr/sbin/diskutil', ['list'], 15000));
      }
      for (const disk of physicalDisks)
        if (![...devices.values()].some((item) => item.name === disk.name))
          devices.set(deviceKey(disk), disk);
    } catch (err) {
      warnings.push(`diskutil: ${err.message}`);
    }
  }
  if (!devices.size && warnings.length)
    throw new Error(`Laufwerkserkennung fehlgeschlagen: ${warnings.join(' | ')}`);
  // Do not send any optional -i probes to a bridge whose medium is unknown.
  // Preserve its list entry unchanged until the user chooses the access mode.
  const listedDevices = [...devices.values()];
  const recognizedSafe = await resolveAccessModes(
    listedDevices.filter((device) => !device.requiresUsbChoice),
    async (d, timeoutMs) => {
      const response = await runSmartProbe(['-i', '-j', '-d', d.type, d.name], timeoutMs);
      if ((response.exitCode & 3) !== 0) return null;
      return response.json;
    },
  );
  const recognizedKeys = new Set(recognizedSafe.map(deviceKey));
  const recognized = listedDevices.filter(
    (device) => device.requiresUsbChoice || recognizedKeys.has(deviceKey(device)),
  );
  let result;
  if (platform === 'darwin') {
    result = await resolveMacConnections(recognized, {
      parseInfo: parseDiskutilInfo,
      getInfo: (name) => runText('/usr/sbin/diskutil', ['info', '-plist', name]),
      readIoreg: () =>
        runText(
          '/usr/sbin/ioreg',
          ['-p', 'IOService', '-r', '-c', 'IOUSBHostDevice', '-l', '-w0'],
          20000,
          4 * 1024 * 1024,
        ),
      readProfiler: async () =>
        JSON.parse(
          await runText(
            '/usr/sbin/system_profiler',
            ['SPUSBDataType', '-json', '-detailLevel', 'full'],
            18000,
          ),
        ),
    });
  } else if (platform === 'linux') {
    result = await Promise.all(
      recognized.map(async (d) => ({ ...d, ...(await linuxMetadata(d.name)) })),
    );
  } else {
    // On Windows, optional CIM/PnP metadata is fetched separately.
    // The initial device list depends only on smartctl discovery.
    result = recognized;
  }
  return { devices: result, warnings };
}
function deviceKey(device) {
  return `${device.name}\u0000${device.type || 'auto'}`;
}
function safeDevice(d) {
  if (
    !d ||
    typeof d !== 'object' ||
    typeof d.name !== 'string' ||
    d.name.length > MAX_DEVICE_NAME_LENGTH ||
    !/^(\/dev\/|[A-Za-z]:|\\\\\.\\)/.test(d.name)
  )
    throw new Error('Ungültiger Gerätepfad');
  if (
    typeof d.type !== 'string' ||
    d.type.length > MAX_DEVICE_TYPE_LENGTH ||
    !/^(?:[a-zA-Z0-9][a-zA-Z0-9,+_-]{0,59}|snt(?:jmicron|asmedia|realtek)\/sat)$/.test(d.type)
  )
    throw new Error('Ungültiger Gerätetyp');
  return { name: d.name, type: d.type };
}
module.exports = {
  parseDiskutilInfo,
  connectionForDevice,
  binaryCandidates,
  runSmart,
  safeDevice,
  deviceKey,
  lookupBinaryAsync,
  scanDevices,
  parseDiskutilList,
  parseDiskutilPhysicalList,
};
