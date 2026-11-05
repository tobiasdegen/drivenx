import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings2, X } from 'lucide-react';
import type { Device } from '../types';
import { translate, type Locale } from '../i18n.mts';
import { MANUAL_ACCESS_MODES } from '../../shared/manual-access-modes.mjs';
import { SCAN_USB_MODES, type ScanUsbMode } from '../../shared/scan-usb-mode.mjs';

type Props = {
  locale: Locale;
  disabled: boolean;
  changing?: boolean;
  device?: Device;
  scanMode: ScanUsbMode;
  onScanMode: (mode: string) => void;
  onDeviceMode: (mode: string) => void;
};

/** One hardware-access dialog, reachable independently of the selected tab.
 * Batch discovery and per-drive overrides remain separate, authorized actions.
 * A batch preset never authorizes a device path; an override never persists
 * beyond the current scan generation.
 */
export default function AccessModeSelector({
  device,
  scanMode,
  locale,
  disabled,
  changing = false,
  onScanMode,
  onDeviceMode,
}: Props) {
  const tr = (key: string) => translate(locale, 'smartView', key);
  const [open, setOpen] = useState(false);
  const [pendingScan, setPendingScan] = useState<string>(scanMode);
  const [pendingDevice, setPendingDevice] = useState<string>(device?.type || 'auto');
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLSelectElement>(null);

  // A dialog opened for an earlier disk must never apply to the next disk.
  useEffect(() => {
    setOpen(false);
  }, [device?.name, device?.type]);
  useEffect(() => {
    if (!open) {
      setPendingScan(scanMode);
      setPendingDevice(device?.type || 'auto');
    }
  }, [open, scanMode, device?.type]);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    function keyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const controls = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled),select:not(:disabled)',
        ),
      ];
      if (!controls.length) return;
      const start = controls[0];
      const end = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      }
    }
    document.addEventListener('keydown', keyDown);
    return () => {
      document.removeEventListener('keydown', keyDown);
      trigger.current?.focus();
    };
  }, [open]);

  const scanCategories = [
    { key: 'accessModeAuto', types: ['auto'] },
    { key: 'accessModeSat', types: ['sat'] },
    {
      key: 'accessModeNvmeUsb',
      types: SCAN_USB_MODES.filter((type) => type !== 'auto' && type !== 'sat'),
    },
  ];
  const manualCategories = [
    { key: 'accessModeAuto', types: ['auto'] },
    { key: 'accessModeSystem', types: ['scsi', 'ata', 'nvme'] },
    { key: 'accessModeSat', types: ['sat', 'sat,12', 'sat,16'] },
    {
      key: 'accessModeNvmeUsb',
      types: [
        'sntjmicron',
        'sntjmicron/sat',
        'sntasmedia',
        'sntasmedia/sat',
        'sntrealtek',
        'sntrealtek/sat',
      ],
    },
    {
      key: 'accessModeLegacyUsb',
      types: ['usbjmicron', 'usbprolific', 'usbcypress', 'usbsunplus', 'usbcyber'],
    },
  ];
  const options = (categories: typeof scanCategories) =>
    categories.map(({ key, types }) => (
      <optgroup key={key} label={tr(key)}>
        {types.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </optgroup>
    ));
  const locked = disabled || changing;
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="button secondary access-mode-toolbar"
        disabled={locked}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={tr('deviceAccessTitle')}
        title={tr('deviceAccessTitle')}
        onClick={() => {
          setPendingScan(scanMode);
          setPendingDevice(device?.type || 'auto');
          setOpen(true);
        }}
      >
        <Settings2 size={16} aria-hidden="true" />
        <span className="access-mode-toolbar-label">{tr('deviceAccessTitle')}</span>
      </button>
      {open &&
        createPortal(
          <div
            className="access-mode-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div
              ref={dialog}
              role="dialog"
              aria-modal="true"
              aria-label={tr('deviceAccessTitle')}
              className="access-mode-dialog"
            >
              <header className="access-mode-dialog-header">
                <div>
                  <h3>{tr('deviceAccessTitle')}</h3>
                  <p>{tr('deviceAccessSubtitle')}</p>
                </div>
                <button
                  type="button"
                  className="access-mode-close"
                  onClick={() => setOpen(false)}
                  aria-label={tr('accessModeClose')}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="access-mode-dialog-body">
                <section className="access-mode-section">
                  <h4>{tr('scanModeTitle')}</h4>
                  <p>{tr('scanModeSubtitle')}</p>
                  <label htmlFor="scan-usb-mode">{tr('accessModeChoice')}</label>
                  <select
                    id="scan-usb-mode"
                    ref={first}
                    value={pendingScan}
                    onChange={(event) => setPendingScan(event.target.value)}
                  >
                    {options(scanCategories)}
                  </select>
                  {pendingScan.endsWith('/sat') && (
                    <p className="access-mode-warning">{tr('accessModeHybridNotice')}</p>
                  )}
                  <p>{tr('scanModeNote')}</p>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={locked}
                    onClick={() => {
                      setOpen(false);
                      onScanMode(pendingScan);
                    }}
                  >
                    {tr('scanModeApply')}
                  </button>
                </section>
                <section className="access-mode-section">
                  <h4>{tr('deviceAccessSelectedTitle')}</h4>
                  {device ? (
                    <>
                      <p className="access-mode-device-name">{device.info_name || device.name}</p>
                      <label htmlFor="manual-smartctl-mode">{tr('accessModeChoice')}</label>
                      <select
                        id="manual-smartctl-mode"
                        value={pendingDevice}
                        onChange={(event) => setPendingDevice(event.target.value)}
                      >
                        {!MANUAL_ACCESS_MODES.includes(device.type) && (
                          <option value={device.type}>{device.type}</option>
                        )}
                        {options(manualCategories)}
                      </select>
                      {pendingDevice.endsWith('/sat') && (
                        <p className="access-mode-warning">{tr('accessModeHybridNotice')}</p>
                      )}
                      <p>
                        {tr('accessModeNote')} {tr('accessModeReset')}
                      </p>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={locked || pendingDevice === device.type}
                        onClick={() => {
                          setOpen(false);
                          onDeviceMode(pendingDevice);
                        }}
                      >
                        {tr('accessModeApply')}
                      </button>
                    </>
                  ) : (
                    <p>{tr('deviceAccessNoSelection')}</p>
                  )}
                </section>
              </div>
              <footer className="access-mode-dialog-footer">
                <button type="button" className="button secondary" onClick={() => setOpen(false)}>
                  {tr('accessModeClose')}
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
