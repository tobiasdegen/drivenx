import { Fragment } from 'react';
import type { SmartctlReport } from '../../smartctl-types';
import { labels, translate, translateParams, type Locale } from '../../i18n.mts';
import { display } from '../../drive-display';
import { smartProtocol } from '../../drive-protocol';
import { isRecord, readableErrorRows, selectedAtaErrorLog } from '../../error-log-view.mjs';

export default function ErrorLogPanel({
  raw,
  locale,
  countErrors,
}: {
  raw: SmartctlReport;
  locale: Locale;
  countErrors: unknown;
}) {
  const t = labels[locale];
  const tr = (key: string) => translate(locale, 'smartView', key);
  const protocol = smartProtocol(raw);
  const nvme = raw.nvme_smart_health_information_log;
  const nvmeLogFailed =
    protocol === 'nvme' &&
    Array.isArray(raw.smartctl?.messages) &&
    raw.smartctl.messages.some(
      (message) =>
        typeof message?.string === 'string' &&
        /(?:error information log|error log).*?(?:fail|unavailable)|(?:getlogpage failed)/i.test(
          message.string,
        ),
    );
  // SCSI/SAS exposes protocol error counters, not the ATA/NVMe event tables.
  // Preserve missing counters as unknown rather than silently displaying zero.
  if (protocol === 'scsi') {
    const counters = (['read', 'write', 'verify'] as const).map((operation) => ({
      operation,
      value: raw.scsi_error_counter_log?.[operation]?.total_uncorrected_errors,
    }));
    return (
      <section className="panel">
        <h3>{tr('errorLogScsi')}</h3>
        <p className="panel-description">{tr('scsiCounterExplanation')}</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{tr('description')}</th>
                <th>{t.errors}</th>
              </tr>
            </thead>
            <tbody>
              {counters.map(({ operation, value }) => (
                <tr key={operation}>
                  <td>{tr('overview_' + operation + 'Errors')}</td>
                  <td>
                    {typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
                      ? value.toLocaleString(locale)
                      : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  const { log: ataLog, rows: ataRows } = selectedAtaErrorLog(raw);
  const errorRows =
    protocol === 'nvme'
      ? readableErrorRows(raw.nvme_error_information_log?.table)
      : protocol === 'ata'
        ? ataRows
        : [];
  const reportedCapacity = raw.user_capacity?.blocks;
  const maxAddress =
    typeof reportedCapacity === 'number' &&
    Number.isSafeInteger(reportedCapacity) &&
    reportedCapacity > 0
      ? reportedCapacity - 1
      : null;
  const formatRegister = (value: unknown) =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : '–';
  const logTitle =
    protocol === 'nvme'
      ? tr('errorLogNvme')
      : protocol === 'ata'
        ? tr('errorLogAta')
        : t.errorDetails;
  const statusColumn =
    protocol === 'nvme' ? tr('nvmeStatusColumn') : protocol === 'ata' ? t.hours : tr('autoStatus');
  return (
    <section className="panel">
      <div className="table-head">
        <h3>
          {t.errors}
          {!nvmeLogFailed && countErrors != null ? ` · ${display(countErrors)}` : ''}
        </h3>
      </div>
      <h4>{logTitle}</h4>
      {protocol === 'nvme' && !nvmeLogFailed && (
        <p className="panel-description">{tr('nvmeErrorDetails')}</p>
      )}
      {protocol === 'nvme' && nvme && (
        <p className="panel-description">
          {translate(locale, 'smartView', 'autoReportedNVMeLifetimeErrorCount')}:{' '}
          {display(nvme.num_err_log_entries)}.
        </p>
      )}
      {protocol === 'ata' && ataLog && (
        <p className="panel-description">
          {translate(locale, 'smartView', 'autoLifetimeErrorCount')}: {display(ataLog.count)}.{' '}
          {translate(locale, 'smartView', 'autoReadableDetailRecords')}: {errorRows.length}.
          {ataLog.logged_count != null && (
            <>
              {' '}
              {translate(locale, 'smartView', 'autoLogReportedEntries')}: {ataLog.logged_count}.
            </>
          )}{' '}
          {translate(locale, 'smartView', 'autoNotEveryHistoricalErrorStillHas')}
        </p>
      )}
      {errorRows.length === 0 && (
        <div className="empty-details-state" role="status">
          <p>{nvmeLogFailed ? tr('errorLogUnavailable') : tr('errorLogNoRecords')}</p>
          {nvmeLogFailed && (
            <details>
              <summary>{tr('errorLogTechDetails')}</summary>
              {raw.smartctl?.messages
                ?.filter((entry) => typeof entry.string === 'string')
                .map((entry, index) => (
                  <p key={index}>{entry.string}</p>
                ))}
              {raw.smartctl?.exit_status != null && <p>smartctl: {raw.smartctl.exit_status}</p>}
            </details>
          )}
        </div>
      )}
      {errorRows.length > 0 && (
        <div className="table-scroll">
          <table className="ata-error-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{statusColumn}</th>
                <th>{tr('description')}</th>
              </tr>
            </thead>
            <tbody>
              {errorRows.map((r, i: number) => {
                const completionRegisters = isRecord(r.completion_registers)
                  ? r.completion_registers
                  : null;
                const previousCommands = Array.isArray(r.previous_commands)
                  ? r.previous_commands.filter(isRecord)
                  : [];
                const hasDetails =
                  protocol === 'ata' &&
                  (completionRegisters !== null || previousCommands.length > 0);
                const lba = completionRegisters?.lba;
                const outsideCapacity =
                  maxAddress !== null &&
                  typeof lba === 'number' &&
                  Number.isSafeInteger(lba) &&
                  lba > maxAddress;
                const formattedLba =
                  typeof lba === 'number' && Number.isSafeInteger(lba) && lba >= 0
                    ? lba.toLocaleString(locale)
                    : '–';
                return (
                  <Fragment key={i}>
                    <tr className="ata-error-main-row">
                      <td>{display(r.error_number ?? r.error_count)}</td>
                      <td>
                        {display(
                          protocol === 'nvme'
                            ? r.status_field?.status_code_type != null &&
                              r.status_field?.status_code != null
                              ? `${r.status_field.status_code_type}/${r.status_field.status_code}`
                              : undefined
                            : r.lifetime_hours,
                        )}
                      </td>
                      <td>{display(r.error_description ?? r.status_field?.string)}</td>
                    </tr>
                    {hasDetails && (
                      <tr className="ata-error-detail-row">
                        <td colSpan={3}>
                          <details className="ata-error-detail">
                            <summary>
                              {translate(
                                locale,
                                'smartView',
                                'autoTechnicalDetailsAndPreviousATACommands',
                              )}
                            </summary>
                            {outsideCapacity && (
                              <p className="ata-data-note ata-data-attention">
                                {translateParams(locale, 'smartView', 'errorLbaOutsideCapacity', {
                                  lba: formattedLba,
                                  maximum: maxAddress?.toLocaleString(locale) ?? '–',
                                })}
                              </p>
                            )}
                            {completionRegisters && (
                              <>
                                <h5>{translate(locale, 'smartView', 'autoCompletionRegisters')}</h5>
                                <dl className="ata-error-registers">
                                  {Object.entries(completionRegisters).map(([key, value]) => (
                                    <div key={key}>
                                      <dt>{key}</dt>
                                      <dd>{formatRegister(value)}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </>
                            )}
                            {previousCommands.length > 0 ? (
                              <>
                                <h5>{translate(locale, 'smartView', 'autoPreviousATACommands')}</h5>
                                <div className="ata-command-list">
                                  {previousCommands.map((cmd, index) => (
                                    <div className="ata-command" key={index}>
                                      <strong>
                                        {index + 1}.{' '}
                                        {typeof cmd.command_name === 'string'
                                          ? cmd.command_name
                                          : '–'}
                                      </strong>
                                      {isRecord(cmd.registers) && (
                                        <dl className="ata-error-registers">
                                          {Object.entries(cmd.registers)
                                            .filter(
                                              ([, value]) =>
                                                typeof value === 'number' ||
                                                typeof value === 'string',
                                            )
                                            .map(([key, value]) => (
                                              <div key={key}>
                                                <dt>{key}</dt>
                                                <dd>{formatRegister(value)}</dd>
                                              </div>
                                            ))}
                                        </dl>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : null}
                          </details>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
