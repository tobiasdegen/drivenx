import { useMemo } from 'react';
import type { SmartctlReport } from '../../smartctl-types';
import { translate, translateParams, type Locale } from '../../i18n.mts';
import { statistics, temperatureHistory, temperatureBands } from '../../ata-details.mjs';

const pageTitleKeys: Record<number, string> = {
  1: 'ataPage1',
  4: 'ataPage4',
  5: 'ataPage5',
  6: 'ataPage6',
  7: 'ataPage7',
};
const metricKeys: Record<string, string> = {
  'Lifetime Power-On Resets': 'ataMetricLifetimePowerOnResets',
  'Power-on Hours': 'ataMetricPowerOnHours',
  'Logical Sectors Written': 'ataMetricLogicalSectorsWritten',
  'Logical Sectors Read': 'ataMetricLogicalSectorsRead',
  'Number of Write Commands': 'ataMetricNumberOfWriteCommands',
  'Number of Read Commands': 'ataMetricNumberOfReadCommands',
  'Date and Time TimeStamp': 'ataMetricDateAndTimeTimestamp',
  'Number of Reported Uncorrectable Errors': 'ataMetricNumberOfReportedUncorrectableErrors',
  'Resets Between Cmd Acceptance and Completion':
    'ataMetricResetsBetweenCmdAcceptanceAndCompletion',
  'Current Temperature': 'ataMetricCurrentTemperature',
  'Highest Temperature': 'ataMetricHighestTemperature',
  'Lowest Temperature': 'ataMetricLowestTemperature',
  'Specified Maximum Operating Temperature': 'ataMetricSpecifiedMaximumOperatingTemperature',
  'Number of Hardware Resets': 'ataMetricNumberOfHardwareResets',
  'Number of ASR Events': 'ataMetricNumberOfAsrEvents',
  'Number of Interface CRC Errors': 'ataMetricNumberOfInterfaceCrcErrors',
  'Percentage Used Endurance Indicator': 'ataMetricPercentageUsedEnduranceIndicator',
};
export default function AtaStatisticsPanel({
  raw,
  locale,
}: {
  raw: SmartctlReport;
  locale: Locale;
}) {
  const { groups, history, bands, validSamples } = useMemo(() => {
    const groups = statistics(raw);
    const history = temperatureHistory(raw);
    const bands = temperatureBands(history);
    const validSamples = bands.reduce((sum, band) => sum + band.count, 0);
    return { groups, history, bands, validSamples };
  }, [raw]);
  // ATA HDDs can expose spare_available too: this is not proof of SSD media.
  const isSsd =
    raw.rotation_rate === 0 && (raw.device?.protocol === 'ATA' || !!raw.ata_smart_attributes);
  const endurance = isSsd ? raw.endurance_used?.current_percent : undefined;
  const spare = isSsd ? raw.spare_available : undefined;
  const sct = raw.ata_sct_status?.temperature;
  if (!groups.length && !history && !sct && endurance == null && spare?.current_percent == null)
    return null;
  const number = (v: number | null) => (v === null ? '–' : v.toLocaleString(locale));
  const maxOp = sct?.op_limit_max;
  const maxLife = sct?.lifetime_max;
  return (
    <>
      {(endurance != null || spare?.current_percent != null) && (
        <section className="panel ata-extra-panel">
          <h3>{translate(locale, 'smartView', 'autoSSDSpareAndEndurance')}</h3>
          <dl className="ata-details-list">
            {endurance != null && (
              <div>
                <dt>
                  {translate(locale, 'smartView', 'autoEnduranceUsedInCurrentSmartctlReadout')}
                </dt>
                <dd>{number(endurance)} %</dd>
              </div>
            )}
            {spare?.current_percent != null && (
              <div>
                <dt>{translate(locale, 'smartView', 'autoAvailableSpare')}</dt>
                <dd>{number(spare.current_percent)} %</dd>
              </div>
            )}
            {spare?.threshold_percent != null && (
              <div>
                <dt>{translate(locale, 'smartView', 'autoSpareThreshold')}</dt>
                <dd>{number(spare.threshold_percent)} %</dd>
              </div>
            )}
          </dl>
          <p className="ata-data-note">
            {translate(locale, 'smartView', 'autoDeviceReportedValuesNotACalculated')}
          </p>
        </section>
      )}
      {groups.length > 0 && (
        <section className="panel ata-extra-panel">
          <h3>{translate(locale, 'smartView', 'autoATADeviceStatistics')}</h3>
          <p className="panel-description">
            {translate(locale, 'smartView', 'autoIndependentDeviceStatisticsHistoricalCountersAre')}
          </p>
          {groups.map((group, index) => (
            <details
              className="ata-extra-group"
              key={group.number}
              open={index === 0 ? true : undefined}
            >
              <summary>
                {pageTitleKeys[group.number]
                  ? translate(locale, 'smartView', pageTitleKeys[group.number])
                  : group.name}{' '}
                ({group.rows.length})
              </summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{translate(locale, 'smartView', 'autoMetric')}</th>
                      <th>{translate(locale, 'smartView', 'autoValue')}</th>
                      <th>{translate(locale, 'smartView', 'autoStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((item) => (
                      <tr key={item.offset}>
                        <td title={item.name}>
                          {metricKeys[item.name]
                            ? translate(locale, 'smartView', metricKeys[item.name])
                            : item.name}
                        </td>
                        <td className="mono">{number(item.value)}</td>
                        <td>
                          {!item.valid || item.value === null
                            ? translate(locale, 'smartView', 'autoUnavailable')
                            : item.monitored
                              ? translate(locale, 'smartView', 'autoMonitoredConditionMet')
                              : item.normalized
                                ? translate(locale, 'smartView', 'autoNormalized')
                                : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </section>
      )}
      {(history || sct) && (
        <section className="panel ata-extra-panel">
          <h3>{translate(locale, 'smartView', 'autoSCTTemperatureData')}</h3>
          {sct && (
            <dl className="ata-details-list">
              {[
                [translate(locale, 'smartView', 'autoCurrent'), sct.current],
                [translate(locale, 'smartView', 'autoMinSincePowerOn'), sct.power_cycle_min],
                [translate(locale, 'smartView', 'autoMaxSincePowerOn'), sct.power_cycle_max],
                [translate(locale, 'smartView', 'autoLifetimeMinimum'), sct.lifetime_min],
                [translate(locale, 'smartView', 'autoLifetimeMaximum'), sct.lifetime_max],
                [translate(locale, 'smartView', 'autoMaximumOperatingLimit'), maxOp],
                [
                  translate(locale, 'smartView', 'autoUnderOverLimitEvents'),
                  sct.under_limit_count != null || sct.over_limit_count != null
                    ? `${number(sct.under_limit_count ?? null)} / ${number(sct.over_limit_count ?? null)}`
                    : undefined,
                ],
              ]
                .filter((entry) => entry[1] !== undefined)
                .map(([label, value]) => (
                  <div key={String(label)}>
                    <dt>{label}</dt>
                    <dd>{typeof value === 'number' ? `${number(value)} °C` : value}</dd>
                  </div>
                ))}
            </dl>
          )}
          {typeof maxLife === 'number' && typeof maxOp === 'number' && maxLife > maxOp && (
            <p className="ata-data-note ata-data-attention">
              {translateParams(locale, 'smartView', 'ataTemperatureAboveLimit', {
                maximum: maxLife,
                limit: maxOp,
              })}
            </p>
          )}
          {history && (
            <div className="ata-temperature-overview">
              <h4>
                {translate(locale, 'smartView', 'autoDistributionOfStoredTemperatureSamples')}
              </h4>
              <p className="ata-data-note">
                {translateParams(locale, 'smartView', 'ataTemperatureSamplesSummary', {
                  valid: number(validSamples),
                  missing: number(history.missing),
                })}
              </p>
              <div className="ata-temperature-bands">
                {bands.map((band: { label: string; count: number }) => (
                  <div className="ata-temperature-band" key={band.label}>
                    <div>
                      <span>{band.label}</span>
                      <strong>{number(band.count)}</strong>
                    </div>
                    <span className="ata-temperature-bar">
                      <span
                        style={{
                          width: `${validSamples ? (100 * band.count) / validSamples : 0}%`,
                        }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {history && (
            <details className="ata-extra-group">
              <summary>
                {translate(locale, 'smartView', 'autoShowAllIndividualTemperatureSamples')} (
                {history.values.length})
              </summary>
              <p className="ata-data-note">
                {translateParams(locale, 'smartView', 'ataTemperatureRingBuffer', {
                  sampling: number(history.sampleMinutes),
                  logging: number(history.logMinutes),
                  missing: history.missing,
                  index: number(history.index),
                  slots: number(history.slots),
                })}
              </p>
              <div className="ata-temperature-samples">
                {history.values.map((value, slot) => (
                  <span key={slot} title={`${translate(locale, 'smartView', 'autoSlot')} ${slot}`}>
                    <small>{slot}</small>
                    {value === null ? '–' : `${value} °C`}
                  </span>
                ))}
              </div>
            </details>
          )}
        </section>
      )}
    </>
  );
}
