// @ts-check
'use strict';
const { getCatalogSection } = require('../ui/translator.js');
/** @typedef {import('../backend-contracts').Device} Device */
/** @typedef {import('../backend-contracts').ScanDependencies} ScanDependencies */
/** @typedef {import('../backend-contracts').ScanResult} ScanResult */
/** @typedef {import('../backend-contracts').WindowsInventoryResult} WindowsInventoryResult */
const { backendError } = require('../security/user-errors.js');
const { enrichUsbNames } = require('./usb-id-lookup.js');
const { allowedManualAccessMode } = require('../../shared/manual-access-modes.mjs');
const { validScanUsbMode } = require('../../shared/scan-usb-mode.mjs');

/**
 * Owns a single discovery generation and its optional follow-up reads.
 * No Electron windows, dialogs or IPC dependencies belong here.
 */
/** @param {ScanDependencies} deps */
function createScanController(deps) {
  const {
    platform,
    getLocale = () => 'de-DE',
    scanDevices,
    safeDevice,
    deviceKey,
    startWindowsInventory,
    parseWindowsInventory,
    possibleWindowsAliases,
    findWindowsNvmeAliases,
    runSmart,
    operations,
    reports,
    logStartup,
    isTestPending,
  } = deps;

  /** @type {Map<string, Device>} */
  const known = new Map();
  // A path awaiting user choice is not authorized for hardware reads.
  const pendingUsbPaths = new Set();
  let generation = 0;
  /** @type {Promise<ScanResult> | null} */
  let scanInFlight = null;
  /** @type {{generation: number; job: Promise<WindowsInventoryResult>} | null} */
  let windowsInventory = null;
  let accessRevision = 0;
  /** @type {{generation: number; revision: number; promise: Promise<{groups: unknown[]}>} | null} */
  let aliasInFlight = null;

  /** @param {unknown} device @returns {Device} */
  function assertDevice(device, allowPending = false) {
    const checked = safeDevice(device);
    if (!known.has(deviceKey(checked))) throw backendError('deviceNotInScan');
    if (!allowPending && pendingUsbPaths.has(checked.name))
      throw backendError('usbMediaChoiceRequired');
    return checked;
  }

  /** @param {number} requested */
  function assertGeneration(requested) {
    if (!Number.isSafeInteger(requested) || requested < 1) {
      throw backendError('invalidScanGeneration');
    }
    if (requested !== generation || scanInFlight) {
      throw backendError('scanGenerationChanged');
    }
  }

  /** @param {Device} device @param {Map<string, Device>} discovered */
  function deviceSummary(device, discovered) {
    const info = discovered.get(deviceKey(device)) || device;
    return enrichUsbNames({
      ...device,
      info_name: info.info_name || device.name,
      capacityBytes:
        typeof info.capacityBytes === 'number' &&
        Number.isSafeInteger(info.capacityBytes) &&
        info.capacityBytes > 0
          ? info.capacityBytes
          : undefined,
      osMetadata: info.osMetadata || undefined,
      transport: info.transport ?? null,
      internal: info.internal ?? null,
      connection: info.connection ?? null,
    });
  }

  /** @param {number} scanGeneration @param {string} preferredUsbMode @returns {Promise<ScanResult>} */
  async function performScan(scanGeneration, preferredUsbMode) {
    const startedAt = Date.now();
    // The optional Windows inventory starts only after smartctl discovery;
    // this preserves reliable --scan-open USB detection and a fast first list.
    const result = await scanDevices(preferredUsbMode);
    logStartup('scan-timing', Date.now() - startedAt);

    // Validate the complete inventory before publishing *any* authorization.
    // A malformed later entry must never leave a partially trusted device list
    // after the scan has failed.
    /** @type {Map<string, Device>} */
    const nextKnown = new Map();
    for (const device of result.devices) {
      const checked = safeDevice(device);
      nextKnown.set(deviceKey(checked), checked);
    }

    const warnings = [...result.warnings];
    let inventoryJob = null;
    if (platform === 'win32' && nextKnown.size) {
      try {
        // A rejected optional CIM/PnP job must not break the SMART list or
        // surface as a renderer-level scan failure. Consume it immediately.
        inventoryJob = Promise.resolve(startWindowsInventory()).catch(() => ({
          inventory: null,
          warning: getCatalogSection(getLocale(), 'backendErrors').inventoryFailed,
          durationMs: 0,
        }));
      } catch {
        // CIM/PnP enrichment is optional: never discard a valid SMART list
        // merely because starting PowerShell unexpectedly failed.
        warnings.push(getCatalogSection(getLocale(), 'backendErrors').inventoryFailed);
      }
    }
    windowsInventory = inventoryJob ? { generation: scanGeneration, job: inventoryJob } : null;
    for (const [key, device] of nextKnown) known.set(key, device);
    for (const device of result.devices) {
      if (device.requiresUsbChoice === true) pendingUsbPaths.add(device.name);
    }
    const discovered = new Map(result.devices.map((device) => [deviceKey(device), device]));
    return {
      devices: [...known.values()].map((device) => ({
        ...deviceSummary(device, discovered),
        ...(pendingUsbPaths.has(device.name) ? { requiresUsbChoice: true } : {}),
      })),
      message: warnings,
      generation: scanGeneration,
      metadataPending: !!inventoryJob,
      aliasCheckPending: platform === 'win32' && possibleWindowsAliases(result.devices).length > 0,
    };
  }

  async function scan(preferredUsbMode = 'auto') {
    if (!validScanUsbMode(preferredUsbMode)) throw backendError('invalidManualAccessMode');
    if (scanInFlight) return scanInFlight;
    if (isTestPending()) {
      throw backendError('selfTestBlocksScan');
    }
    // Invalidate old authorization and reports *before* the asynchronous
    // discovery begins. IPC operations must never use yesterday's identity
    // and SMART snapshot while a new scan is in flight (or after it fails).
    generation++;
    accessRevision++;
    windowsInventory = null;
    known.clear();
    pendingUsbPaths.clear();
    reports.reset();
    const running = performScan(generation, preferredUsbMode);
    scanInFlight = running;
    try {
      return await running;
    } finally {
      if (scanInFlight === running) scanInFlight = null;
    }
  }

  /** @param {number} requested */
  function scanAliases(requested) {
    assertGeneration(requested);
    const revision = accessRevision;
    // Concurrent renderer calls share identity probes, not duplicated disk I/O.
    if (aliasInFlight?.generation === requested && aliasInFlight.revision === revision)
      return aliasInFlight.promise;
    const promise = (async () => {
      const startedAt = Date.now();
      const groups = await findWindowsNvmeAliases(
        [...known.values()].filter((device) => !pendingUsbPaths.has(device.name)),
        (device) => {
          // The per-path queue may keep an identity probe waiting behind a
          // detail read. Never start it after a rescan or manual mode switch.
          const assertCurrent = () => {
            assertGeneration(requested);
            if (revision !== accessRevision) throw backendError('scanGenerationChanged');
          };
          assertCurrent();
          return operations.run(device.name, async () => {
            assertCurrent();
            // Identity probes must not read SMART counters or start self-tests.
            const result = await runSmart(['-i', '-j', '-d', device.type, device.name], 9000);
            return result.json;
          });
        },
      );
      assertGeneration(requested);
      if (revision !== accessRevision) throw backendError('scanGenerationChanged');
      logStartup('nvme-alias-timing', `${Date.now() - startedAt}ms groups=${groups.length}`);
      return { groups };
    })();
    const current = { generation: requested, revision, promise };
    aliasInFlight = current;
    const clear = () => {
      if (aliasInFlight === current) aliasInFlight = null;
    };
    // Attach both handlers: cleanup must not create an unhandled rejection.
    promise.then(clear, clear);
    return promise;
  }

  /** @param {number} requested */
  async function scanMetadata(requested) {
    assertGeneration(requested);
    const request = windowsInventory;
    if (!request || request.generation !== requested) return { devices: [], message: [] };
    const { inventory, warning, durationMs } = await request.job;
    logStartup('windows-metadata-timing', durationMs ?? 'unknown');
    assertGeneration(requested);
    // Inventory is path-based and independent of the -d selector. Enrich the
    // *current* authorized mode, even if the user changed it while CIM ran.
    return {
      devices: inventory
        ? [...known.values()]
            .map((device) => ({
              ...device,
              ...parseWindowsInventory(inventory, device),
            }))
            .map((device) => enrichUsbNames(device))
        : [],
      message: warning ? [warning] : [],
    };
  }

  // This changes only the authorized access selector for a device discovered
  // in this scan. It does not execute smartctl and cannot authorize a new path.
  // Never copy renderer-supplied metadata into the privileged inventory.
  /** @param {unknown} input @param {string} requestedMode @param {number} requestedGeneration */
  function selectAccessMode(input, requestedMode, requestedGeneration) {
    if (scanInFlight) throw backendError('scanInProgress');
    assertGeneration(requestedGeneration);
    if (isTestPending()) throw backendError('selfTestBlocksScan');
    const current = assertDevice(input, true);
    if (!allowedManualAccessMode(requestedMode)) throw backendError('invalidManualAccessMode');
    if (current.type === requestedMode) {
      if (pendingUsbPaths.delete(current.name)) accessRevision++;
      return current;
    }
    const replacement = safeDevice({ name: current.name, type: requestedMode });
    if (known.has(deviceKey(replacement))) throw backendError('manualAccessModeAlreadyPresent');
    // A different authorized access type on this same path may already exist.
    // Do not let changing one row remove another controller/RAID member.
    const priorKey = deviceKey(current);
    known.delete(priorKey);
    known.set(deviceKey(replacement), replacement);
    pendingUsbPaths.delete(current.name);
    accessRevision++;
    reports.invalidate(priorKey);
    reports.invalidate(deviceKey(replacement));
    return replacement;
  }

  return {
    scan,
    scanAliases,
    scanMetadata,
    selectAccessMode,
    assertDevice,
    isScanning: () => scanInFlight !== null,
    scanGeneration: () => generation,
  };
}

module.exports = { createScanController };
