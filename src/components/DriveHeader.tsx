import { AlertTriangle, CheckCircle2, HardDrive, Info, XCircle } from 'lucide-react';
import type { Device, Detail } from '../types';
import { visibleDiagnosisStatus } from '../../shared/diagnosis-model.mjs';
import { translate, type Locale } from '../i18n.mts';
import ReadoutCoverage from './ReadoutCoverage';
import { resolvedBusName, diskKindWithOs, bytes } from '../drive-display';

const statusIcons = {
  ok: CheckCircle2,
  warnung: AlertTriangle,
  kritisch: XCircle,
  unbekannt: Info,
  observe: Info,
  warning: AlertTriangle,
  critical: XCircle,
  defective: XCircle,
  unassessable: Info,
};

/** Drive identity and assessment only; SMART tab layout belongs elsewhere. */
export default function DriveHeader({
  device,
  detail,
  locale,
}: {
  device: Device;
  detail?: Detail;
  locale: Locale;
}) {
  const raw = detail?.raw;
  const name = raw?.model_name || device.info_name || device.name;
  const healthStatus = detail ? visibleDiagnosisStatus(detail.health) : null;
  const StatusIcon = healthStatus ? statusIcons[healthStatus] : null;

  return (
    <section className="drive-heading">
      <div className="drive-icon">
        <HardDrive size={23} />
      </div>
      <div className="drive-name">
        <h2>{name}</h2>
        <div className="subline">
          {device.name} · {bytes(raw?.user_capacity?.bytes ?? device.capacityBytes, locale)} ·{' '}
          {diskKindWithOs(raw, device, locale)} · {resolvedBusName(device, raw, locale)}
        </div>
      </div>
      {detail && healthStatus && StatusIcon && (
        <div className="drive-status-group">
          <span className={`pill status-${healthStatus}`}>
            <StatusIcon size={15} /> {translate(locale, 'diagnosis', healthStatus)}
          </span>
          <ReadoutCoverage health={detail.health} raw={detail.raw} locale={locale} />
        </div>
      )}
    </section>
  );
}
