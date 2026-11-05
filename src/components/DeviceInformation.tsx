import type { Device } from '../types';
import type { SmartctlReport } from '../smartctl-types';
import { translate, type Locale } from '../i18n.mts';
import { resolvedBusName, bytes, diskKind, display } from '../drive-display';
import { smartProtocol } from '../drive-protocol';
import { extendedMetrics } from '../extended-metrics.mjs';

type Entry = { label: string; value: unknown };
function TechnicalValue({ value, locale }: { value: unknown; locale: Locale }) {
  if (typeof value === 'boolean')
    return <>{translate(locale, 'deviceDetails', value ? 'yes' : 'no')}</>;
  return <>{display(value)}</>;
}
export default function DeviceInformation({
  device,
  raw,
  name,
  time,
  locale,
  compact = false,
  hardwareOnly = false,
}: {
  device: Device;
  raw: SmartctlReport;
  name: string;
  time: string;
  locale: Locale;
  compact?: boolean;
  hardwareOnly?: boolean;
}) {
  const os = device.osMetadata;
  const tr = (key: string) => translate(locale, 'deviceDetails', key);
  const protocol = smartProtocol(raw);
  const extended = protocol === 'ata' ? extendedMetrics(raw, null) : null;
  const general: Entry[] = [
    { label: tr('model'), value: name },
    ...(raw.model_family
      ? [
          {
            label: tr('modelFamily'),
            value: raw.model_family,
          },
        ]
      : []),
    { label: tr('serial'), value: raw.serial_number },
    { label: tr('firmware'), value: raw.firmware_version },
    {
      label: tr('capacity'),
      value: bytes(raw.user_capacity?.bytes ?? device.capacityBytes, locale),
    },
    { label: tr('driveType'), value: diskKind(raw, locale) },
    {
      label: tr('smartProtocol'),
      value: protocol === 'unknown' ? undefined : protocol.toUpperCase(),
    },
  ];
  const hardware: Entry[] = [
    { label: tr('connection'), value: resolvedBusName(device, raw, locale) },
    { label: tr('devicePath'), value: device.name },
    ...(device.internal != null
      ? [
          {
            label: tr('location'),
            value: device.internal ? tr('internal') : tr('external'),
          },
        ]
      : []),
    ...(os?.ejectable != null
      ? [
          {
            label: tr('ejectable'),
            value: os.ejectable,
          },
        ]
      : []),
  ];
  const technical: Entry[] = [
    { label: tr('smartSupported'), value: raw.smart_support?.available },
    { label: tr('smartEnabled'), value: raw.smart_support?.enabled },
    ...(raw.logical_block_size != null
      ? [{ label: tr('logicalDevice'), value: `${raw.logical_block_size} ${tr('unitBytes')}` }]
      : []),
    ...(protocol === 'nvme'
      ? [
          { label: tr('namespaces'), value: raw.nvme_number_of_namespaces },
          {
            label: translate(locale, 'deviceDetails', 'autoNVMeVersionReported'),
            value: raw.nvme_version?.string,
          },
          { label: tr('selfTestsSupported'), value: raw.nvme_optional_admin_commands?.self_test },
          ...(raw.nvme_pci_vendor?.id != null
            ? [
                {
                  label: translate(locale, 'deviceDetails', 'autoPCIVendorID'),
                  value:
                    `${raw.nvme_pci_vendor.id === 0x106b ? 'Apple ' : ''}(0x${raw.nvme_pci_vendor.id.toString(16).toUpperCase().padStart(4, '0')})`.trim(),
                },
              ]
            : []),
        ]
      : []),
    ...(protocol === 'ata'
      ? [
          { label: tr('sataVersion'), value: raw.sata_version?.string },
          { label: tr('sataSpeed'), value: raw.interface_speed?.current?.string },
          { label: 'TRIM', value: raw.trim?.supported },
          ...(extended?.hardwareResets != null
            ? [
                {
                  label: translate(locale, 'deviceDetails', 'autoHardwareResetsHistoric'),
                  value: extended.hardwareResets,
                },
              ]
            : []),
          ...(extended?.commandResets != null
            ? [
                {
                  label: translate(locale, 'deviceDetails', 'autoCommandResetsHistoric'),
                  value: extended.commandResets,
                },
              ]
            : []),
          ...(extended?.interfaceCrc != null
            ? [
                {
                  label: translate(locale, 'deviceDetails', 'autoInterfaceCRCErrors'),
                  value: extended.interfaceCrc,
                },
              ]
            : []),
          {
            label: tr('smartTestsSupported'),
            value: raw.ata_smart_data?.capabilities?.self_tests_supported,
          },
        ]
      : []),
    ...(os?.identifier ? [{ label: tr('deviceIdentifier'), value: os.identifier }] : []),
    ...(os?.mediaName && os.mediaName !== raw.model_name
      ? [{ label: translate(locale, 'deviceDetails', 'autoMediaNameOS'), value: os.mediaName }]
      : []),
    ...(os?.logicalBlockSize != null && os.logicalBlockSize !== raw.logical_block_size
      ? [
          {
            label: tr('logicalSize'),
            value: `${os.logicalBlockSize.toLocaleString(locale)} Byte`,
          },
        ]
      : []),
    ...(os?.physicalBlockSize != null
      ? [
          {
            label: tr('physicalSize'),
            value: `${os.physicalBlockSize.toLocaleString(locale)} Byte`,
          },
        ]
      : []),
    ...(os?.removable != null
      ? [
          {
            label: tr('removable'),
            value: os.removable,
          },
        ]
      : []),
  ];
  const diagnosis: Entry[] = [
    {
      label: tr('smartStatus'),
      value:
        raw.smart_status?.passed === true
          ? tr('smartPassed')
          : raw.smart_status?.passed === false
            ? tr('smartFailed')
            : undefined,
    },
    { label: tr('captured'), value: time },
    { label: tr('smartSource'), value: 'smartctl' },
    { label: tr('connectionSource'), value: device.connection?.source ?? os?.source },
  ];
  if (hardwareOnly)
    return (
      <section className="panel hardware-summary-panel">
        <h3>{tr('hardware')}</h3>
        <div className="hardware-card-grid">
          {hardware.map((e) => (
            <div className="hardware-info-card" key={e.label}>
              <span>{e.label}</span>
              <strong>
                <TechnicalValue value={e.value} locale={locale} />
              </strong>
            </div>
          ))}
        </div>
        {technical.length > 0 && (
          <details className="hardware-technical">
            <summary>{tr('additional')}</summary>
            <dl className="hardware-technical-list">
              {technical
                .filter((e) => e.value !== undefined && e.value !== null && e.value !== '')
                .map((e) => (
                  <div key={e.label}>
                    <dt>{e.label}</dt>
                    <dd>
                      <TechnicalValue value={e.value} locale={locale} />
                    </dd>
                  </div>
                ))}
            </dl>
          </details>
        )}
      </section>
    );
  const groups = compact
    ? [
        {
          title: tr('general'),
          entries: general.filter(
            (e) =>
              ![tr('model'), tr('capacity'), tr('driveType'), tr('smartProtocol')].includes(
                e.label,
              ),
          ),
        },
      ]
    : [
        { title: tr('general'), entries: general },
        { title: tr('hardware'), entries: hardware },
        { title: tr('smartDiagnosis'), entries: diagnosis },
      ];
  return (
    <section className={`panel device-information${compact ? ' overview-device-information' : ''}`}>
      <h3>{tr('deviceInfo')}</h3>
      {groups.map((g) => (
        <div className="device-info-group" key={g.title}>
          {!compact && <h4>{g.title}</h4>}
          <dl className="info-list">
            {g.entries.map((e) => (
              <div key={e.label}>
                <dt>{e.label}</dt>
                <dd>
                  <TechnicalValue value={e.value} locale={locale} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
