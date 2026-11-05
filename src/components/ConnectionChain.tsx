import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cable,
  CheckCircle2,
  ChevronRight,
  Copy,
  HardDrive,
  Info,
  Laptop,
  Network,
  Server,
  X,
} from 'lucide-react';
import type { Device, Health } from '../types';
import type { SmartctlReport } from '../smartctl-types';
import { translate, type Locale } from '../i18n.mts';
import {
  buildConnectionPath,
  formatConnectionIdentifiers,
  type PathStage,
} from '../connection-path.mjs';
import { createAsyncViewGuard } from '../async-view-guard.mjs';
import { bytes, diskKind } from '../drive-display';

export const connectionChain = (
  device: Device | undefined,
  locale: Locale,
  raw?: SmartctlReport | null,
  platform?: string,
  health?: Health,
) => (
  <ConnectionChainView
    device={device}
    locale={locale}
    raw={raw}
    platform={platform}
    health={health}
  />
);

function stageRole(role: PathStage['role'], locale: Locale) {
  switch (role) {
    case 'host':
      return translate(locale, 'usbConnection', 'roleHost');
    case 'hub':
      return translate(locale, 'usbConnection', 'roleHub');
    case 'bridge':
      return translate(locale, 'usbConnection', 'roleBridge');
    case 'drive':
      return translate(locale, 'usbConnection', 'roleDrive');
    default:
      return translate(locale, 'usbConnection', 'roleUsb');
  }
}
function StageIcon({ kind, role }: { kind: PathStage['kind']; role: PathStage['role'] }) {
  if (kind === 'host') return <Laptop size={17} aria-hidden="true" />;
  if (kind === 'drive') return <HardDrive size={17} aria-hidden="true" />;
  if (role === 'hub') return <Network size={17} aria-hidden="true" />;
  if (role === 'bridge') return <Cable size={17} aria-hidden="true" />;
  return <Server size={17} aria-hidden="true" />;
}

/** Separate modal keeps the physical path at a fixed, comparable height. */
function UsbTechnicalDialog({
  stage,
  locale,
  onClose,
  onCopy,
  copied,
  copyError,
}: {
  stage: PathStage;
  locale: Locale;
  onClose: () => void;
  onCopy: () => void;
  copied: boolean;
  copyError: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    function keyHandler(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const actions = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      );
      if (!actions.length) return;
      const first = actions[0];
      const last = actions[actions.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('keydown', keyHandler);
      previousFocus?.focus();
    };
  }, [onClose]);
  const node = stage.node;
  const fields: [string, string | null | undefined][] = [
    [translate(locale, 'usbConnection', 'deviceName'), stage.name],
    [translate(locale, 'usbConnection', 'osVendor'), node?.manufacturer],
    [
      translate(locale, 'usbConnection', 'idVendor'),
      stage.hints?.vendor && stage.hints.vendor !== node?.manufacturer ? stage.hints.vendor : null,
    ],
    ['VID', node?.vendorId],
    ['PID', node?.productId],
    [translate(locale, 'usbConnection', 'locationId'), node?.locationId],
    [translate(locale, 'usbConnection', 'scsiInquiryBridgeName'), stage.inquiryName],
  ];
  const visibleFields = fields.filter(([, value]) => Boolean(value));
  return (
    <div
      className="usb-flow-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="usb-flow-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="usb-flow-dialog-title"
      >
        <header className="usb-flow-dialog-header">
          <div>
            <span className="usb-flow-dialog-eyebrow">
              {translate(locale, 'usbConnection', 'title')}
            </span>
            <h4 id="usb-flow-dialog-title">
              {translate(locale, 'usbConnection', 'technicalDetails')}
            </h4>
            <span className="usb-flow-dialog-device">{stage.name}</span>
          </div>
          <button type="button" ref={closeRef} className="button secondary" onClick={onClose}>
            <X size={16} />
            {translate(locale, 'usbConnection', 'close')}
          </button>
        </header>
        <div className="usb-flow-dialog-content">
          <dl className="usb-flow-dialog-fields">
            {visibleFields.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {stage.hints?.product && (
            <div className="usb-flow-dialog-note">
              <strong>{translate(locale, 'usbConnection', 'additionalIdentification')}</strong>
              <p>
                {stage.hints.ambiguous
                  ? translate(locale, 'usbConnection', 'thisUSBIdentifierIsShared')
                  : translate(locale, 'usbConnection', 'nameFromTheDeviceIdentifier')}
              </p>
              <p className="usb-flow-dialog-hints">{stage.hints.product}</p>
            </div>
          )}
          {copyError && (
            <p className="usb-flow-dialog-error" role="alert">
              {translate(locale, 'usbConnection', 'copyFailure')}
            </p>
          )}
        </div>
        <footer className="usb-flow-dialog-footer">
          <button type="button" className="button secondary" onClick={onCopy}>
            <Copy size={15} />
            {copied
              ? translate(locale, 'usbConnection', 'copied')
              : translate(locale, 'usbConnection', 'copyIdentifiers')}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ConnectionChainView({
  device,
  locale,
  raw,
  platform,
  health,
}: {
  device: Device | undefined;
  locale: Locale;
  raw?: SmartctlReport | null;
  platform?: string;
  health?: Health;
}) {
  const [copied, setCopied] = useState<number | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [openStage, setOpenStage] = useState<number | null>(null);
  const copyGuard = useRef(createAsyncViewGuard());
  const closeStage = useCallback(() => {
    copyGuard.current.invalidate();
    setOpenStage(null);
  }, []);
  useEffect(() => {
    copyGuard.current.invalidate();
    setOpenStage(null);
  }, [device?.name, device?.type, device?.connection?.chain]);
  if (!device || device.transport?.toLowerCase() !== 'usb') return null;
  const v = device.connection;
  if (!v?.verified || !Array.isArray(v.chain) || !v.chain.length) {
    return (
      <section className="panel connection-panel">
        <h3>{translate(locale, 'usbConnection', 'title')}</h3>
        <p className="connection-caption">
          {translate(locale, 'usbConnection', 'usbConnectionDetectedTheActual')}
        </p>
      </section>
    );
  }
  const { stages, summary, hasSataMaximumOnly } = buildConnectionPath(device, raw, platform);
  const isHdd = typeof raw?.rotation_rate === 'number' && raw.rotation_rate > 0;
  // The authoritative health evaluator assesses ATA, NVMe AND SCSI data.
  // Do not improvise a second SMART-readability heuristic in the UI.
  const smartReadable =
    health?.readout.status === 'vollstaendig' || health?.readout.status === 'eingeschraenkt';
  const trim = isHdd
    ? translate(locale, 'usbConnection', 'trimHdd')
    : raw?.trim?.supported === true
      ? translate(locale, 'usbConnection', 'trimSupported')
      : raw?.trim?.supported === false
        ? translate(locale, 'usbConnection', 'trimUnsupported')
        : translate(locale, 'usbConnection', 'unknown');
  async function copyIds(stage: PathStage, index: number) {
    const ticket = copyGuard.current.begin('copy');
    if (!ticket) return;
    try {
      await navigator.clipboard.writeText(
        formatConnectionIdentifiers(stage, {
          location: translate(locale, 'usbConnection', 'copyLocation'),
          inquiry: translate(locale, 'usbConnection', 'copyInquiry'),
          vendor: translate(locale, 'usbConnection', 'copyVendor'),
          product: translate(locale, 'usbConnection', 'copyProduct'),
        }),
      );
      if (copyGuard.current.isCurrent(ticket)) {
        setCopied(index);
        setCopyError(false);
      }
    } catch {
      if (copyGuard.current.isCurrent(ticket)) {
        setCopied(null);
        setCopyError(true);
      }
    } finally {
      copyGuard.current.finish(ticket);
    }
  }

  return (
    <section className="panel connection-panel usb-flow-panel">
      <div className="usb-flow-heading">
        <h3>{translate(locale, 'usbConnection', 'title')}</h3>
        <span className="usb-flow-confirmed">
          <CheckCircle2 size={14} />
          {translate(locale, 'usbConnection', 'pathMatched')}
        </span>
      </div>
      <div className="usb-flow-summary">
        <Info size={17} aria-hidden="true" />
        <div>
          <strong>
            {summary === 'sata-lower'
              ? translate(locale, 'usbConnection', 'sataBelowMax')
              : translate(locale, 'usbConnection', 'pathDetected')}
          </strong>
          <p>
            {summary === 'sata-lower'
              ? translate(locale, 'usbConnection', 'theReportedCurrentSATASpeed')
              : hasSataMaximumOnly
                ? translate(locale, 'usbConnection', 'availableUSBSpeedValuesAre')
                : translate(locale, 'usbConnection', 'availableSpeedValuesAreShown')}
          </p>
        </div>
      </div>

      <div
        className={`usb-flow-path usb-flow-path--${stages.length >= 6 ? 'many' : stages.length === 5 ? 'five' : stages.length === 4 ? 'four' : 'few'}`}
        aria-label={translate(locale, 'usbConnection', 'pathAria')}
      >
        {stages.map((stage, index) => (
          <div className="usb-flow-unit" key={`${stage.kind}-${index}`}>
            {index > 0 && (
              <div
                className="usb-flow-link"
                title={
                  stage.link?.kind === 'maximum'
                    ? translate(locale, 'usbConnection', 'reportedMaximumNotNecessarilyThe')
                    : stage.link?.kind === 'reported'
                      ? translate(locale, 'usbConnection', 'osUsbSpeed')
                      : stage.link?.kind === 'current'
                        ? translate(locale, 'usbConnection', 'smartSataSpeed')
                        : undefined
                }
              >
                <span className="usb-flow-link-value">
                  {stage.link?.label
                    ? stage.link.label.startsWith('USB up to ')
                      ? translate(locale, 'usbConnection', 'speedUpTo').replace(
                          '{speed}',
                          stage.link.label.slice(10),
                        )
                      : stage.link.label.startsWith('SATA max. ')
                        ? translate(locale, 'usbConnection', 'sataMaximum').replace(
                            '{speed}',
                            stage.link.label.slice(10),
                          )
                        : stage.link.label
                    : translate(locale, 'usbConnection', 'unknown')}
                </span>
                <span
                  className={`usb-flow-link-line${summary === 'sata-lower' && stage.link?.kind === 'current' ? ' usb-flow-link-line--warn' : ''}`}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              </div>
            )}
            <article
              className={`usb-flow-node${stage.kind === 'drive' ? ' usb-flow-node--drive' : ''}`}
            >
              <div className="usb-flow-node-top">
                <span className="usb-flow-icon">
                  <StageIcon kind={stage.kind} role={stage.role} />
                </span>
                <span className="usb-flow-role">{stageRole(stage.role, locale)}</span>
              </div>
              <div className="usb-flow-node-body">
                <strong className="usb-flow-name" title={stage.name}>
                  {stage.name ||
                    translate(
                      locale,
                      'usbConnection',
                      stage.kind === 'drive' ? 'drive' : 'unknownUsbDevice',
                    )}
                </strong>
                {stage.kind === 'drive' ? (
                  <span className="usb-flow-secondary">
                    {raw ? diskKind(raw, locale) : translate(locale, 'usbConnection', 'drive')}
                    {raw?.user_capacity?.bytes || device.capacityBytes
                      ? ` · ${bytes(raw?.user_capacity?.bytes ?? device.capacityBytes, locale)}`
                      : ''}
                  </span>
                ) : stage.kind === 'host' ? (
                  <span className="usb-flow-secondary">
                    {translate(locale, 'usbConnection', 'computerUsbPort')}
                  </span>
                ) : (
                  <>
                    <span className="usb-flow-secondary">
                      {stage.node?.manufacturer ||
                        stage.hints?.vendor ||
                        translate(locale, 'usbConnection', 'vendorUnknown')}
                    </span>
                    {stage.hints?.product && (
                      <div className="usb-flow-identity">
                        {stage.hints.ambiguous
                          ? translate(locale, 'usbConnection', 'idAmbiguous')
                          : `${stage.hints.product} · ${translate(locale, 'usbConnection', 'fromDeviceId')}`}
                      </div>
                    )}
                  </>
                )}
              </div>
              {stage.kind !== 'drive' &&
                stage.kind !== 'host' &&
                (stage.node?.vendorId ||
                  stage.node?.productId ||
                  stage.node?.locationId ||
                  stage.inquiryName ||
                  stage.hints?.product) && (
                  <button
                    className="usb-flow-details-trigger"
                    type="button"
                    onClick={() => {
                      copyGuard.current.invalidate();
                      setCopied(null);
                      setCopyError(false);
                      setOpenStage(index);
                    }}
                    aria-haspopup="dialog"
                  >
                    {translate(locale, 'usbConnection', 'technicalDetails')}{' '}
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                )}
            </article>
          </div>
        ))}
      </div>

      {openStage !== null && stages[openStage] && (
        <UsbTechnicalDialog
          stage={stages[openStage]}
          locale={locale}
          onClose={closeStage}
          onCopy={() => void copyIds(stages[openStage], openStage)}
          copied={copied === openStage}
          copyError={copyError}
        />
      )}

      <div className="usb-flow-capabilities">
        <div>
          <span>SMART</span>
          <strong>
            {smartReadable
              ? translate(locale, 'usbConnection', 'diagnosticsReadable')
              : translate(locale, 'usbConnection', 'unconfirmed')}
          </strong>
        </div>
        <div>
          <span>{translate(locale, 'usbConnection', 'sataLink')}</span>
          <strong>
            {raw?.interface_speed?.current?.string
              ? `${raw.interface_speed.current.string} (${translate(locale, 'usbConnection', 'current')})`
              : raw?.interface_speed?.max?.string
                ? `${raw.interface_speed.max.string} (${translate(locale, 'usbConnection', 'maximum')})`
                : translate(locale, 'usbConnection', 'unknown')}
          </strong>
        </div>
        <div>
          <span>TRIM</span>
          <strong>{trim}</strong>
        </div>
        <div>
          <span>UASP</span>
          <strong>
            {v.usbDriver === 'uasp'
              ? translate(locale, 'usbConnection', 'uaspDriver')
              : v.usbDriver === 'usb-storage'
                ? translate(locale, 'usbConnection', 'usbStorageDriver')
                : translate(locale, 'usbConnection', 'unknown')}
          </strong>
        </div>
      </div>
      {!stages.some((stage) => stage.kind === 'usb' && stage.link?.kind === 'reported') && (
        <p className="usb-flow-note">{translate(locale, 'usbConnection', 'usbSpeedLimited')}</p>
      )}
      {raw?.trim?.supported === true && !isHdd && (
        <p className="usb-flow-note">{translate(locale, 'usbConnection', 'trimIsReportedByThe')}</p>
      )}
    </section>
  );
}
