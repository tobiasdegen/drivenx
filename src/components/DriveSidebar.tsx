import { HardDrive, RefreshCw, Settings, Shield } from 'lucide-react';
import appIcon from '../../build/icon.png';
import type { Device, Detail, Environment } from '../types';
import { labels, translate, type Locale } from '../i18n.mts';
import { k, resolvedBusName, diskKindWithOs, bytes } from '../drive-display';
import { macUsbScsiSmartLimitation } from '../mac-usb-smart-limitation.mjs';
import { visibleDiagnosisStatus } from '../../shared/diagnosis-model.mjs';

export type DriveSidebarProps = {
  locale: Locale;
  devices: Device[];
  selected: string;
  details: Record<string, Detail>;
  detailErrors: Record<string, boolean>;
  env: Environment | null;
  busy: boolean;
  onScan: () => void;
  onSelect: (device: Device) => void;
  onOpenPreferences: () => void;
};

export default function DriveSidebar({
  locale,
  devices,
  selected,
  details,
  detailErrors,
  env,
  busy,
  onScan,
  onSelect,
  onOpenPreferences,
}: DriveSidebarProps) {
  const t = labels[locale];
  const groups = [
    {
      id: 'internal',
      label: 'devicesInternal',
      drives: devices.filter((d) => d.internal === true),
    },
    {
      id: 'external',
      label: 'devicesExternal',
      drives: devices.filter((d) => d.internal === false),
    },
    { id: 'unknown', label: 'devicesUnknown', drives: devices.filter((d) => d.internal == null) },
  ].filter((group) => group.drives.length > 0);
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-symbol">
          <img src={appIcon} width={44} height={44} alt="" aria-hidden="true" />
        </span>
        <strong>DriveNX</strong>
      </div>
      <div className="sidebar-title">
        {t.drives}
        <button
          type="button"
          className="icon-button"
          onClick={onScan}
          disabled={busy}
          title={translate(locale, 'smartView', 'scanDevicesAction')}
          aria-label={translate(locale, 'smartView', 'scanDevicesAction')}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="device-list">
        {groups.map((group) => (
          <div key={group.id} className="drive-sidebar-group">
            {groups.length > 1 && (
              <h3 className="drive-sidebar-group-heading">
                {translate(locale, 'smartView', group.label)}
              </h3>
            )}
            {group.drives.map((d) => {
              const detail = details[k(d)];
              const raw = detail?.raw;
              const status = detail ? visibleDiagnosisStatus(detail.health) : null;
              const limitedMacUsb = macUsbScsiSmartLimitation(
                d,
                env?.platform,
                detail?.health.readout.status,
                detailErrors[k(d)],
              );
              const statusLabel = limitedMacUsb
                ? translate(locale, 'smartView', 'macUsbSmartSidebar')
                : status
                  ? translate(locale, 'diagnosis', status)
                  : detailErrors[k(d)]
                    ? translate(locale, 'smartView', 'sidebarSmartUnavailable')
                    : translate(locale, 'smartView', 'sidebarSelectToRead');
              const capacity = bytes(raw?.user_capacity?.bytes ?? d.capacityBytes, locale);
              // macOS/Windows may identify capacity and SSD type before smartctl succeeds.
              const summary = raw
                ? `${diskKindWithOs(raw, d, locale)} · ${capacity}`
                : [
                    d.osMetadata?.solidState === true ? diskKindWithOs(null, d, locale) : null,
                    capacity !== '–' ? capacity : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || d.name;
              return (
                <button
                  type="button"
                  key={k(d)}
                  className={`device-item ${selected === k(d) ? 'chosen' : ''}`}
                  onClick={() => onSelect(d)}
                  disabled={busy}
                  aria-current={selected === k(d) ? 'true' : undefined}
                >
                  <HardDrive size={18} />
                  <span className="device-copy">
                    <b title={raw?.model_name || d.info_name || d.name}>
                      {raw?.model_name || d.info_name || d.name}
                    </b>
                    <small>
                      {summary} · {resolvedBusName(d, raw, locale)}
                    </small>
                    {detail && !Number.isNaN(Date.parse(detail.capturedAt)) && (
                      <small className="sidebar-measured">
                        {translate(locale, 'smartView', 'lastMeasured')}:{' '}
                        {new Date(detail.capturedAt).toLocaleString(locale)}
                      </small>
                    )}
                    {detail ? (
                      <>
                        <span className="device-status-line">
                          <span className={`status-dot ${status || 'unbekannt'}`} />
                          <span>{statusLabel}</span>
                        </span>
                      </>
                    ) : (
                      <span className="device-status-line loading-status">{statusLabel}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {!devices.length && <span className="empty-sidebar">{busy ? t.scanning : t.noDrives}</span>}
      </div>
      <div className="sidebar-foot">
        {env?.platform === 'win32' && (
          <div className="system-line">
            <Shield size={15} />
            <span>{`${t.admin}: ${env?.elevated === true ? t.adminYes : env?.elevated === false ? t.adminNo : t.adminUnknown}`}</span>
          </div>
        )}
        <button type="button" className="settings-shortcut" onClick={onOpenPreferences}>
          <Settings size={15} />
          {translate(locale, 'preferences', 'title')}
        </button>
      </div>
    </aside>
  );
}
