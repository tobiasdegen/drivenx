import { useMemo } from 'react';
import type { SmartctlReport } from '../../smartctl-types';
import { translate, type Locale } from '../../i18n.mts';
import { phyEvents, logDirectory } from '../../ata-details.mjs';

export default function AtaHardwareDetails({
  raw,
  locale,
}: {
  raw: SmartctlReport;
  locale: Locale;
}) {
  const number = (value: number | null) => (value === null ? '–' : value.toLocaleString(locale));
  const yesNo = (value?: boolean) =>
    value === undefined
      ? '–'
      : value
        ? translate(locale, 'smartView', 'autoYes')
        : translate(locale, 'smartView', 'autoNo');
  const cap = raw.ata_smart_data?.capabilities;
  const properties: [string, string][] = [
    [translate(locale, 'smartView', 'autoATAStandard'), raw.ata_version?.string || '–'],
    [translate(locale, 'smartView', 'autoKnownToDriveDB'), yesNo(raw.in_smartctl_database)],
    [
      translate(locale, 'smartView', 'autoMaximumSATASpeed'),
      raw.interface_speed?.max?.string || '–',
    ],
    [
      translate(locale, 'smartView', 'autoPhysicalBlockSize'),
      raw.physical_block_size
        ? `${raw.physical_block_size} ${translate(locale, 'smartView', 'unitBytes')}`
        : '–',
    ],
    [translate(locale, 'smartView', 'autoFormFactor'), raw.form_factor?.name || '–'],
    [translate(locale, 'smartView', 'autoWriteCache'), yesNo(raw.write_cache?.enabled)],
    [translate(locale, 'smartView', 'autoReadLookahead'), yesNo(raw.read_lookahead?.enabled)],
    ['TRIM', yesNo(raw.trim?.supported)],
    [translate(locale, 'smartView', 'autoDeterministicTRIM'), yesNo(raw.trim?.deterministic)],
    [translate(locale, 'smartView', 'autoTRIMReturnsZeros'), yesNo(raw.trim?.zeroed)],
    [
      'APM',
      raw.ata_apm
        ? `${yesNo(raw.ata_apm.enabled)}${raw.ata_apm.level != null ? ` · ${raw.ata_apm.level}` : ''}`
        : '–',
    ],
    ['AAM', yesNo(raw.ata_aam?.enabled)],
    [translate(locale, 'smartView', 'autoATASecurityEnabled'), yesNo(raw.ata_security?.enabled)],
    [translate(locale, 'smartView', 'autoATASecurityFrozen'), yesNo(raw.ata_security?.frozen)],
    [
      translate(locale, 'smartView', 'autoSCTErrorRecoveryControlSupported'),
      yesNo(raw.ata_sct_capabilities?.error_recovery_control_supported),
    ],
    [
      translate(locale, 'smartView', 'autoSCTFeatureControlSupported'),
      yesNo(raw.ata_sct_capabilities?.feature_control_supported),
    ],
    [
      translate(locale, 'smartView', 'autoSCTDataTableSupported'),
      yesNo(raw.ata_sct_capabilities?.data_table_supported),
    ],
    [
      translate(locale, 'smartView', 'autoSCTERCReadEnabled'),
      yesNo(raw.ata_sct_erc?.read?.enabled),
    ],
    [
      translate(locale, 'smartView', 'autoSCTERCWriteEnabled'),
      yesNo(raw.ata_sct_erc?.write?.enabled),
    ],
    [
      translate(locale, 'smartView', 'autoOfflineDataCollectionSupported'),
      yesNo(cap?.exec_offline_immediate_supported),
    ],
    [
      translate(locale, 'smartView', 'autoSelectiveSelfTestsSupported'),
      yesNo(cap?.selective_self_test_supported),
    ],
    [
      translate(locale, 'smartView', 'autoConveyanceSelfTestsSupported'),
      yesNo(cap?.conveyance_self_test_supported),
    ],
    [
      translate(locale, 'smartView', 'autoErrorLoggingSupported'),
      yesNo(cap?.error_logging_supported),
    ],
    [
      translate(locale, 'smartView', 'autoGeneralPurposeLogSupported'),
      yesNo(cap?.gp_logging_supported),
    ],
  ];
  const shownProperties = properties.filter(([, value]) => value !== '–');
  const primary = shownProperties.slice(0, 8);
  const extra = shownProperties.slice(8);
  const phyTranslationKeys: Record<string, string> = {
    'Command failed due to ICRC error': 'ataPhyCommandFailedDueToIcrcError',
    'R_ERR response for data FIS': 'ataPhyRErrResponseForDataFis',
    'R_ERR response for device-to-host data FIS': 'ataPhyRErrResponseForDeviceToHostDataFis',
    'R_ERR response for host-to-device data FIS': 'ataPhyRErrResponseForHostToDeviceDataFis',
    'R_ERR response for non-data FIS': 'ataPhyRErrResponseForNonDataFis',
    'R_ERR response for device-to-host non-data FIS': 'ataPhyRErrResponseForDeviceToHostNonDataFis',
    'R_ERR response for host-to-device non-data FIS': 'ataPhyRErrResponseForHostToDeviceNonDataFis',
    'Device-to-host non-data FIS retries': 'ataPhyDeviceToHostNonDataFisRetries',
    'Transition from drive PhyRdy to drive PhyNRdy':
      'ataPhyTransitionFromDrivePhyrdyToDrivePhynrdy',
    'Device-to-host register FISes sent due to a COMRESET':
      'ataPhyDeviceToHostRegisterFisesSentDueToAComreset',
    'CRC errors within host-to-device FIS': 'ataPhyCrcErrorsWithinHostToDeviceFis',
    'Non-CRC errors within host-to-device FIS': 'ataPhyNonCrcErrorsWithinHostToDeviceFis',
    'R_ERR response for host-to-device data FIS, CRC':
      'ataPhyRErrResponseForHostToDeviceDataFisCrc',
    'R_ERR response for host-to-device data FIS, non-CRC':
      'ataPhyRErrResponseForHostToDeviceDataFisNonCrc',
    'R_ERR response for host-to-device non-data FIS, CRC':
      'ataPhyRErrResponseForHostToDeviceNonDataFisCrc',
    'R_ERR response for host-to-device non-data FIS, non-CRC':
      'ataPhyRErrResponseForHostToDeviceNonDataFisNonCrc',
  };
  const phyLabel = (name: string) =>
    phyTranslationKeys[name] ? translate(locale, 'smartView', phyTranslationKeys[name]) : name;
  const { events, nonzero, logs, vendorLogs, standardLogs } = useMemo(() => {
    const events = phyEvents(raw);
    const nonzero = events.filter(
      (event) => event.overflow || (event.value != null && event.value !== 0),
    );
    const logs = logDirectory(raw);
    const vendorLogs = logs.filter((entry) => /vendor specific/i.test(entry.name));
    const standardLogs = logs.filter((entry) => !/vendor specific/i.test(entry.name));
    return { events, nonzero, logs, vendorLogs, standardLogs };
  }, [raw]);
  const showLogs = (rows: typeof logs) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{translate(locale, 'smartView', 'autoAddress')}</th>
            <th>{translate(locale, 'smartView', 'autoLog')}</th>
            <th>{translate(locale, 'smartView', 'autoRead')}</th>
            <th>{translate(locale, 'smartView', 'autoWrite')}</th>
            <th>GPL</th>
            <th>SMART</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.address}>
              <td className="mono">0x{entry.address.toString(16).padStart(2, '0')}</td>
              <td>{entry.name}</td>
              <td>{entry.read ? translate(locale, 'smartView', 'autoYes') : '–'}</td>
              <td>{entry.write ? translate(locale, 'smartView', 'autoYes') : '–'}</td>
              <td>{number(entry.gpSectors)}</td>
              <td>{number(entry.smartSectors)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  if (raw.device?.protocol !== 'ATA') return null;
  return (
    <>
      {shownProperties.length > 0 && (
        <section className="panel ata-extra-panel">
          <h3>{translate(locale, 'smartView', 'autoATACapabilitiesAndSettings')}</h3>
          <dl className="ata-details-list">
            {primary.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {extra.length > 0 && (
            <details className="ata-extra-group">
              <summary>
                {translate(locale, 'smartView', 'autoOtherATASettingsAndFeatures')} ({extra.length})
              </summary>
              <dl className="ata-details-list">
                {extra.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </section>
      )}
      {events.length > 0 && (
        <section className="panel ata-extra-panel">
          <h3>{translate(locale, 'smartView', 'autoSATAPHYEventCounters')}</h3>
          <p className="ata-data-note">
            {translate(locale, 'smartView', 'autoHistoricTransportEventsIsolatedResetsDo')}
          </p>
          {nonzero.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{translate(locale, 'smartView', 'autoEventSmartctl')}</th>
                    <th>{translate(locale, 'smartView', 'autoValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {nonzero.map((event) => (
                    <tr key={event.id}>
                      <td>{event.id}</td>
                      <td title={event.name}>{phyLabel(event.name)}</td>
                      <td className="mono">
                        {event.overflow
                          ? translate(locale, 'smartView', 'autoOverflow')
                          : number(event.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ata-data-note">
              {translate(locale, 'smartView', 'autoAllReadOutSATAPHYCounters')}
            </p>
          )}
          {events.length > nonzero.length && (
            <details className="ata-extra-group">
              <summary>
                {translate(locale, 'smartView', 'autoAllSATAPHYCountersIncludingZero')} (
                {events.length})
              </summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>{translate(locale, 'smartView', 'autoEventSmartctl')}</th>
                      <th>{translate(locale, 'smartView', 'autoValue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id}>
                        <td>{event.id}</td>
                        <td title={event.name}>{phyLabel(event.name)}</td>
                        <td className="mono">
                          {event.overflow
                            ? translate(locale, 'smartView', 'autoOverflow')
                            : number(event.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>
      )}
      {logs.length > 0 && (
        <section className="panel ata-extra-panel">
          <details className="ata-extra-group">
            <summary>
              {translate(locale, 'smartView', 'autoATALogDirectory')} ({logs.length})
            </summary>
            <p className="ata-data-note">
              {translate(locale, 'smartView', 'autoAvailableLogAreasPresenceOfA')}
            </p>
            {standardLogs.length > 0 && showLogs(standardLogs)}
            {vendorLogs.length > 0 && (
              <details className="ata-extra-group">
                <summary>
                  {translate(locale, 'smartView', 'autoVendorSpecificLogAreas')} (
                  {vendorLogs.length})
                </summary>
                {showLogs(vendorLogs)}
              </details>
            )}
          </details>
        </section>
      )}
    </>
  );
}
