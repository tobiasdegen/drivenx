import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Device, Detail, Environment, Preferences } from '../types';
import { initialLocale, labels, translate, type Locale } from '../i18n.mts';
import { k } from '../drive-display';
import { createRequestTracker } from '../request-tracker.mjs';
import { createDetailRequests } from '../detail-requests.mjs';
import { beginScanSession, keepVisibleDriveEntries } from '../scan-session.mjs';
import { exportSelectedReport, runSelectedSelfTest } from '../drive-commands.mjs';
import { startWithPreferences } from '../startup-preferences.mjs';
import { watchSystemTheme } from '../system-theme.mjs';
import {
  scanWarnings,
  chooseScannedDevice,
  scheduleScanFollowups,
  startBackgroundReads,
} from '../scan-followups.mjs';
import type { Tab } from '../components/SmartTabs';
import type { MenuCommand } from '../ipc-contract';
import { usbMediaAccessMode, type UsbMediaKind } from '../../shared/usb-media-choice.mjs';
import { validScanUsbMode, type ScanUsbMode } from '../../shared/scan-usb-mode.mjs';

const MENU_TABS: ReadonlySet<string> = new Set<Tab>([
  'overview',
  'hardware',
  'history',
  'attributes',
  'tests',
  'errors',
]);

function isMenuTab(command: MenuCommand): command is Tab {
  return MENU_TABS.has(command);
}

/** The only owner of active drive selection, diagnostic requests and async UI state.
 * Hardware access stays behind the context-isolated diagnostics bridge. */
export function useDriveSession() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const t = labels[locale];
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('theme') === 'light' ? 'light' : 'dark',
  );
  const [themePreference, setThemePreference] = useState<'dark' | 'light' | 'system'>(theme);
  const [env, setEnv] = useState<Environment | null>(null),
    [devices, setDevices] = useState<Device[]>([]),
    [selected, setSelected] = useState(''),
    [details, setDetails] = useState<Record<string, Detail>>({});
  const backgroundDetailsRef = useRef(false);
  const [detailErrors, setDetailErrors] = useState<Record<string, boolean>>({});
  const [attributeMode, setAttributeMode] = useState<'friendly' | 'technical'>('friendly');
  const selectedRef = useRef('');
  const deviceRef = useRef<Device[]>([]);
  // Keep imperative references in sync after commit; avoid mutating refs during
  // concurrent React renders. Event handlers update them immediately as needed.
  useLayoutEffect(() => {
    selectedRef.current = selected;
    deviceRef.current = devices;
  }, [selected, devices]);
  const [scanUsbMode, setScanUsbMode] = useState<ScanUsbMode>('auto');
  const scanUsbModeRef = useRef<ScanUsbMode>('auto');
  const scanRunning = useRef(false);
  const scanGenerationRef = useRef<number | null>(null);
  const aliasGroupsRef = useRef<Pick<Device, 'name' | 'type'>[][]>([]);
  const requestTracker = useRef(createRequestTracker());
  const detailRequests = useMemo(
    () =>
      createDetailRequests((device: Device, fresh: boolean) =>
        window.diagnostics.detail(device, fresh),
      ),
    [],
  );
  const pendingTests = useRef(new Set<string>());
  const changingAccessRef = useRef(false);
  const [changingAccess, setChangingAccess] = useState(false);
  const [pendingUsbChoice, setPendingUsbChoice] = useState<string | null>(null);
  const refreshInFlight = useRef(new Map<string, symbol>());

  const [busy, setBusy] = useState(false),
    [loadingDevice, setLoadingDevice] = useState<string | null>(null),
    [testing, setTesting] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [tab, setTab] = useState<Tab>('overview'),
    [query, setQuery] = useState('');
  const active = devices.find((d) => k(d) === selected);
  const detail = details[selected];
  // The UI disables device switching for the duration of a self-test, so
  // only one visible test state is required. pendingTests remains the
  // synchronous command lock; React state is solely the render signal.
  const loading = loadingDevice === selected || testing;
  const load = useCallback(
    async (d: Device, { fresh = false }: { fresh?: boolean } = {}) => {
      const target = k(d);
      const tracker = requestTracker.current;
      const ticket = tracker.beginDetail(target);
      // Do not render or export the previous SMART snapshot during a refresh.
      // If this read fails, the old assessment must stay invalid.
      setDetails((previous) => {
        if (!Object.prototype.hasOwnProperty.call(previous, target)) return previous;
        const next = { ...previous };
        delete next[target];
        return next;
      });
      setLoadingDevice(target);
      setError('');
      try {
        const data = await detailRequests.read(d, { fresh });
        if (tracker.isDetailCurrent(ticket)) {
          setDetails((prev) => ({ ...prev, [target]: data }));
          setDetailErrors((prev) => ({ ...prev, [target]: false }));
        }
      } catch (e) {
        if (tracker.isDetailCurrent(ticket)) {
          const message = String(e);
          setError(message);
          // The macOS diskutil fallback can produce a usable disk list even if
          // smartctl cannot execute. Do not show the same failure twice.
          setNotice((previous) => (previous && message.includes(previous) ? '' : previous));
          setDetailErrors((prev) => ({ ...prev, [target]: true }));
        }
      } finally {
        if (tracker.isDetailCurrent(ticket))
          setLoadingDevice((key) => (key === target ? null : key));
      }
    },
    [detailRequests],
  );
  const scan = useCallback(
    async (overrideMode?: ScanUsbMode) => {
      if (scanRunning.current || pendingTests.current.size || changingAccessRef.current) return;
      scanRunning.current = true;
      scanGenerationRef.current = null;
      setPendingUsbChoice(null);
      refreshInFlight.current.clear();
      aliasGroupsRef.current = [];
      const tracker = requestTracker.current;
      const { epoch, previousKey, previousName } = beginScanSession(
        tracker,
        deviceRef,
        selectedRef,
      );
      detailRequests.clear();
      // The main process revokes the old allowlist at scan start. Remove the
      // renderer's device list and selection in the same transition, rather
      // than leaving disconnected hardware visible until discovery completes.
      setDevices([]);
      setSelected('');
      setDetails({});
      setDetailErrors({});
      setLoadingDevice(null);
      setBusy(true);
      setError('');
      setNotice('');
      try {
        const result = await window.diagnostics.scan(overrideMode ?? scanUsbModeRef.current);
        if (!tracker.isScanCurrent(epoch)) return;
        scanGenerationRef.current = Number.isSafeInteger(result.generation)
          ? result.generation
          : null;
        // Only the identity hint survived the invalidation, never old metadata.
        const next = chooseScannedDevice(result.devices, previousKey, previousName);
        const nextKey = next ? k(next) : '';
        deviceRef.current = result.devices;
        setDevices(result.devices);
        tracker.select(nextKey);
        selectedRef.current = nextKey;
        setSelected(nextKey);
        const warnings = scanWarnings(result.message).map((message) =>
          message === 'smartctlAccessLimited'
            ? translate(locale, 'smartView', 'scanSmartctlLimited')
            : message,
        );
        if (warnings.length) setNotice(warnings.join(' · '));
        if (next?.requiresUsbChoice) setPendingUsbChoice(next.name);
        else if (next) void load(next);

        const aliasReady = scheduleScanFollowups({
          result,
          epoch,
          tracker,
          api: window.diagnostics,
          deviceRef,
          aliasGroupsRef,
          selectedRef,
          onDevices: (nextDevices) => {
            setDevices(nextDevices);
            setDetails((previous) => keepVisibleDriveEntries(previous, nextDevices));
            setDetailErrors((previous) => keepVisibleDriveEntries(previous, nextDevices));
          },
          onNotice: (message) =>
            setNotice((previous) => [previous, message].filter(Boolean).join(' · ')),
        });
        if (backgroundDetailsRef.current) {
          // Identity-verified aliases can disappear after the first scan list.
          // Defer optional reads until the alias check has settled; a hidden
          // smartctl access path must not create another automatic history entry.
          void aliasReady.then(() => {
            if (!tracker.isScanCurrent(epoch)) return;
            void startBackgroundReads({
              devices: deviceRef.current.filter((device) => !device.requiresUsbChoice),
              selectedKey: selectedRef.current,
              epoch,
              tracker,
              api: { detail: detailRequests.read },
              isDeviceCurrent: (target) => deviceRef.current.some((device) => k(device) === target),
              onDetail: (target, data) => {
                setDetails((prev) => ({ ...prev, [target]: data }));
                setDetailErrors((prev) => ({ ...prev, [target]: false }));
              },
              onError: (target) => setDetailErrors((prev) => ({ ...prev, [target]: true })),
            });
          });
        }
      } catch (e) {
        if (tracker.isScanCurrent(epoch)) {
          // The main process revokes its old allowlist at scan start. A failed
          // scan must not leave stale, unqueryable devices in the renderer.
          deviceRef.current = [];
          selectedRef.current = '';
          tracker.select('');
          setDevices([]);
          setSelected('');
          setError(String(e));
        }
      } finally {
        scanRunning.current = false;
        setBusy(false);
      }
    },
    [load, detailRequests],
  );
  function scanWithUsbMode(mode: string) {
    if (
      !validScanUsbMode(mode) ||
      scanRunning.current ||
      pendingTests.current.size ||
      changingAccessRef.current
    )
      return;
    scanUsbModeRef.current = mode;
    setScanUsbMode(mode);
    void scan(mode);
  }
  const refreshActive = useCallback(async () => {
    if (scanRunning.current || pendingTests.current.size || changingAccessRef.current) return;
    const current = deviceRef.current.find((device) => k(device) === selectedRef.current);
    if (!current) {
      await scan();
      return;
    }
    const target = k(current);
    // A click during an existing refresh must not queue another costly
    // smartctl read. A normal in-flight read may still be explicitly refreshed.
    if (current.requiresUsbChoice) {
      setPendingUsbChoice(current.name);
      return;
    }
    if (refreshInFlight.current.has(target)) return;
    const token = Symbol('refresh');
    refreshInFlight.current.set(target, token);
    requestTracker.current.select(target);
    selectedRef.current = target;
    setNotice('');
    setError('');
    setLoadingDevice(null);
    try {
      await load(current, { fresh: true });
    } finally {
      // An old completion may not unlock a refresh started after a new scan.
      if (refreshInFlight.current.get(target) === token) refreshInFlight.current.delete(target);
    }
  }, [load, scan]);
  useEffect(() => {
    function applyPreferences(next: Preferences) {
      backgroundDetailsRef.current = next.backgroundDetails === true;
      setLocale(next.locale);
      setThemePreference(next.theme);
      setAttributeMode(next.attributeMode);
    }
    return startWithPreferences({
      api: window.diagnostics,
      onPreferences: applyPreferences,
      onScan: scan,
    });
  }, [scan]);
  useEffect(() => {
    let active = true;
    void window.diagnostics
      .environment()
      .then((value) => {
        if (active) setEnv(value);
      })
      .catch((e: unknown) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(
    () => watchSystemTheme(themePreference, setTheme, window.matchMedia.bind(window)),
    [themePreference],
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem('locale', locale);
  }, [locale]);
  async function exportAs(format: 'pdf' | 'json' | 'html') {
    if (!detail || busy || loading) return;
    await exportSelectedReport({
      device: detail.device,
      format,
      locale,
      reportId: detail.reportId,
      selectedKey: selected,
      tracker: requestTracker.current,
      exportReport: window.diagnostics.exportReport,
      onNotice: setNotice,
      onError: setError,
    });
  }
  // A self-test can change SMART state even if its command later reports an error.
  function invalidateTestSnapshot(targetKey: string, generation: number) {
    if (!requestTracker.current.isScanCurrent(generation)) return;
    requestTracker.current.invalidateDetail(targetKey);
    detailRequests.invalidate(targetKey);
    setLoadingDevice((previous) => (previous === targetKey ? null : previous));
    setDetails((previous) => {
      const remaining = { ...previous };
      delete remaining[targetKey];
      return remaining;
    });
  }

  function selectDevice(device: Device) {
    if (scanRunning.current) return;
    const target = k(device);
    requestTracker.current.select(target);
    selectedRef.current = target;
    setSelected(target);
    setNotice('');
    setError('');
    setLoadingDevice(null);
    setTab('overview');
    setQuery('');
    if (device.requiresUsbChoice) setPendingUsbChoice(device.name);
    else {
      setPendingUsbChoice(null);
      if (!details[target]) void load(device);
    }
  }

  // The mode switch is a privileged, per-scan authorization update, not a
  // renderer-supplied smartctl command. Only the newly authorized selector
  // can be used for subsequent diagnostics, tests and history actions.
  async function changeAccessMode(mode: string) {
    const current = deviceRef.current.find((device) => k(device) === selectedRef.current);
    if (
      !current ||
      scanRunning.current ||
      pendingTests.current.size ||
      changingAccessRef.current ||
      (current.type === mode && !current.requiresUsbChoice)
    )
      return;
    const generation = scanGenerationRef.current;
    if (generation === null) return;
    const oldKey = k(current);
    const tracker = requestTracker.current;
    const ticket = tracker.selectedTicket(oldKey);
    changingAccessRef.current = true;
    setChangingAccess(true);
    setError('');
    setNotice('');
    try {
      const updatedRef = await window.diagnostics.selectAccessMode(current, mode, generation);
      if (!tracker.isSelected(ticket)) return;
      const newDevice = {
        ...current,
        name: updatedRef.name,
        type: updatedRef.type,
        requiresUsbChoice: false,
      };
      setPendingUsbChoice(null);
      const newKey = k(newDevice);
      tracker.invalidateDetail(oldKey);
      tracker.select(newKey);
      detailRequests.invalidate(oldKey);
      detailRequests.invalidate(newKey);
      deviceRef.current = deviceRef.current.map((d) => (k(d) === oldKey ? newDevice : d));
      selectedRef.current = newKey;
      setDevices(deviceRef.current);
      setSelected(newKey);
      setDetails((previous) => {
        const next = { ...previous };
        delete next[oldKey];
        delete next[newKey];
        return next;
      });
      setDetailErrors((previous) => {
        const next = { ...previous };
        delete next[oldKey];
        delete next[newKey];
        return next;
      });
      setLoadingDevice(null);
      setTab('overview');
      setQuery('');
      // A fresh diagnosis must be made with the chosen -d mode.
      void load(newDevice, { fresh: true });
    } catch (error) {
      if (tracker.isSelected(ticket)) setError(String(error));
    } finally {
      changingAccessRef.current = false;
      setChangingAccess(false);
    }
  }

  function chooseUsbMedium(kind: UsbMediaKind) {
    const current = deviceRef.current.find((device) => k(device) === selectedRef.current);
    if (!current?.requiresUsbChoice || current.name !== pendingUsbChoice) return;
    const mode = usbMediaAccessMode(kind, current.type);
    if (mode) void changeAccessMode(mode);
  }

  async function startTest(kind: 'short' | 'long') {
    if (!active || !detail || loading || busy) return;
    const device = active;
    const targetKey = k(device);
    await runSelectedSelfTest({
      device,
      kind,
      reportId: detail.reportId,
      selectedKey: targetKey,
      tracker: requestTracker.current,
      pendingTests: pendingTests.current,
      scanRunning: () => scanRunning.current,
      confirm: () =>
        window.confirm(
          t.selfWarning + '\n' + (kind === 'short' ? t.startShort : t.startLong) + '?',
        ),
      execute: window.diagnostics.test,
      invalidate: invalidateTestSnapshot,
      reload: (device) => load(device, { fresh: true }),
      onRunning: setTesting,
      onNotice: () => setNotice(translate(locale, 'smartView', 'selfTestStarted')),
      onError: setError,
      onShowTests: () => setTab('tests'),
    });
  }
  // The IPC listener is installed only once. Always use actions from the
  // latest render so a menu click never exports an old drive selection.
  const menuActions = useRef({
    scan,
    pdf: () => exportAs('pdf'),
    json: () => exportAs('json'),
    html: () => exportAs('html'),
  });
  useLayoutEffect(() => {
    menuActions.current = {
      scan,
      pdf: () => exportAs('pdf'),
      json: () => exportAs('json'),
      html: () => exportAs('html'),
    };
  });
  useEffect(
    () =>
      window.diagnostics.onMenuCommand((command) => {
        if (command === 'scan') void menuActions.current.scan();
        else if (command === 'pdf') void menuActions.current.pdf();
        else if (command === 'json') void menuActions.current.json();
        else if (command === 'html') void menuActions.current.html();
        else if (isMenuTab(command)) setTab(command);
      }),
    [],
  );
  return {
    changingAccess,
    changeAccessMode,
    pendingUsbChoice,
    chooseUsbMedium,
    deferUsbChoice: () => setPendingUsbChoice(null),
    scanUsbMode,
    scanWithUsbMode,
    locale,
    env,
    devices,
    selected,
    details,
    detailErrors,
    attributeMode,
    setAttributeMode,
    busy: busy || changingAccess,
    testing,
    loading,
    error,
    setError,
    notice,
    setNotice,
    tab,
    setTab,
    query,
    setQuery,
    active,
    detail,
    scan,
    refreshActive,
    selectDevice,
    startTest,
    exportAs,
  };
}
