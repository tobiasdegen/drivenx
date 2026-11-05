import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HardDrive, X } from 'lucide-react';
import { translate, type Locale } from '../i18n.mts';
import type { Device } from '../types';
import { usbMediaOptions, type UsbMediaKind } from '../../shared/usb-media-choice.mjs';

/** Prompt only after a non-opening scan has identified an ambiguous USB bridge.
 * The backend refuses hardware access until an explicit selection is made.
 */
export default function UsbMediaChoiceDialog({
  device,
  locale,
  changing,
  onChoose,
  onLater,
}: {
  device: Device;
  locale: Locale;
  changing: boolean;
  onChoose: (kind: UsbMediaKind) => void;
  onLater: () => void;
}) {
  const [kind, setKind] = useState<UsbMediaKind | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const tr = (name: string) => translate(locale, 'smartView', name);
  const modes = usbMediaOptions(device.type);
  const onLaterRef = useRef(onLater);
  onLaterRef.current = onLater;
  useEffect(() => {
    first.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !changing) {
        event.preventDefault();
        onLaterRef.current();
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const controls = Array.from(
        dialog.current.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)'),
      );
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls[controls.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
        event.preventDefault();
        controls[0].focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [changing]);
  return createPortal(
    <div className="access-mode-overlay">
      <div
        ref={dialog}
        className="access-mode-dialog usb-media-choice-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr('usbChoiceTitle')}
      >
        <header className="access-mode-dialog-header">
          <div>
            <h3>
              <HardDrive size={17} aria-hidden="true" /> {tr('usbChoiceTitle')}
            </h3>
            <p>
              {device.name} · {tr('usbChoiceBridgeHint')}
            </p>
          </div>
          <button
            className="access-mode-close"
            type="button"
            disabled={changing}
            onClick={onLater}
            aria-label={tr('usbChoiceLater')}
          >
            <X size={18} />
          </button>
        </header>
        <div className="access-mode-dialog-body">
          <p>{tr('usbChoiceText')}</p>
          <fieldset className="usb-media-options" disabled={changing}>
            {(['sata', 'nvme', 'unknown'] as const)
              .filter((option) => modes?.[option])
              .map((option) => (
                <label key={option} className="usb-media-option">
                  <input
                    ref={option === 'sata' ? first : undefined}
                    type="radio"
                    name="usb-media-kind"
                    value={option}
                    checked={kind === option}
                    onChange={() => setKind(option)}
                  />
                  {tr(
                    option === 'sata'
                      ? 'usbChoiceSata'
                      : option === 'nvme'
                        ? 'usbChoiceNvme'
                        : 'usbChoiceUnknown',
                  )}
                </label>
              ))}
          </fieldset>
          {!modes?.nvme && (
            <p className="access-mode-warning">{tr('usbChoiceDriverUnavailable')}</p>
          )}
          {kind === 'unknown' && <p className="access-mode-warning">{tr('usbChoiceRisk')}</p>}
        </div>
        <footer className="access-mode-dialog-footer">
          <button type="button" className="button secondary" onClick={onLater} disabled={changing}>
            {tr('usbChoiceLater')}
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => {
              if (kind) onChoose(kind);
            }}
            disabled={changing || !kind}
          >
            {tr('usbChoiceApply')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
