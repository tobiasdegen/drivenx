import { useEffect, useRef, useState } from 'react';
import { createAsyncViewGuard } from '../../async-view-guard.mjs';
import type { Device } from '../../types';
import { translate, type Locale } from '../../i18n.mts';
export default function HostIoPanel({
  active,
  reportId,
  locale,
  platform,
}: {
  active: Device;
  reportId: string;
  locale: Locale;
  platform?: string;
}) {
  const tr = (key: string) => translate(locale, 'smartView', key);
  const requests = useRef(createAsyncViewGuard());
  const [ioBusy, setIoBusy] = useState(false);
  const [ioError, setIoError] = useState('');
  const [io, setIo] = useState<Partial<
    Record<
      | 'bytesRead'
      | 'bytesWritten'
      | 'operationsRead'
      | 'operationsWrite'
      | 'errorsRead'
      | 'errorsWrite'
      | 'retriesRead'
      | 'retriesWrite',
      number
    >
  > | null>(null);
  const [ioChecked, setIoChecked] = useState(false);
  const [trim, setTrim] = useState<{
    supported: boolean;
    ntfs: string | null;
    refs: string | null;
  } | null>(null);
  useEffect(() => {
    const guard = requests.current;
    guard.invalidate();
    setIoBusy(false);
    setIo(null);
    setIoChecked(false);
    setIoError('');
    setTrim(null);
    // Query host counters once when this specific physical device is selected.
    // Subsequent refresh is user-triggered; this is not a drive benchmark.
    if (platform === 'darwin') {
      const ticket = guard.begin('mac-io');
      if (ticket) {
        setIoBusy(true);
        void window.diagnostics
          .macHostIo(active, reportId)
          .then((data) => {
            if (guard.isCurrent(ticket)) {
              setIo(data);
              setIoChecked(true);
            }
          })
          .catch((error) => {
            if (guard.isCurrent(ticket)) setIoError(String(error));
          })
          .finally(() => {
            if (guard.isCurrent(ticket)) setIoBusy(false);
            guard.finish(ticket);
          });
      }
    }
    // This is a Windows host setting, not the drive's USB TRIM capability.
    if (platform === 'win32') {
      const ticket = guard.begin('windows-trim');
      void window.diagnostics
        .windowsTrim()
        .then((data) => {
          if (guard.isCurrent(ticket)) setTrim(data);
        })
        .catch(() => {
          if (guard.isCurrent(ticket)) setTrim(null);
        })
        .finally(() => guard.finish(ticket));
    }
    return () => guard.invalidate();
  }, [active.name, active.type, reportId, platform]);

  async function checkIo() {
    if (platform !== 'darwin') return;
    const guard = requests.current;
    const ticket = guard.begin('mac-io');
    if (!ticket) return;
    setIoBusy(true);
    setIoError('');
    setIo(null);
    setIoChecked(false);
    try {
      const data = await window.diagnostics.macHostIo(active, reportId);
      if (guard.isCurrent(ticket)) {
        setIo(data);
        setIoChecked(true);
      }
    } catch (error) {
      if (guard.isCurrent(ticket)) setIoError(String(error));
    } finally {
      if (guard.isCurrent(ticket)) setIoBusy(false);
      guard.finish(ticket);
    }
  }

  if (platform !== 'darwin' && !trim?.supported) return null;
  return (
    <section className="panel host-io-panel">
      <h3>{tr('hostIoSection')}</h3>
      {platform === 'darwin' && (
        <div className="history-trends">
          <h4>{tr('macIoTitle')}</h4>
          <p className="panel-description">{tr('macIoNotice')}</p>
          <button className="button secondary" disabled={ioBusy} onClick={() => void checkIo()}>
            {ioBusy ? tr('macIoChecking') : tr('macIoCheck')}
          </button>
          {ioError && (
            <p role="alert" className="history-error">
              {ioError}
            </p>
          )}
          {ioChecked && !io && <p className="panel-description">{tr('macIoUnknown')}</p>}
          {io && (
            <dl className="ata-details-list">
              {Object.entries(io).map(([key, value]) => (
                <div key={key}>
                  <dt>{tr(`macIo_${key}`)}</dt>
                  <dd>{typeof value === 'number' ? value.toLocaleString(locale) : '–'}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
      {trim?.supported && (
        <div className="history-trends">
          <h4>{tr('trimOsTitle')}</h4>
          <p className="panel-description">{tr('trimOsNotice')}</p>
          <p>
            NTFS: {tr(`trimOs_${trim.ntfs || 'unknown'}`)} · ReFS:{' '}
            {tr(`trimOs_${trim.refs || 'unknown'}`)}
          </p>
        </div>
      )}
    </section>
  );
}
