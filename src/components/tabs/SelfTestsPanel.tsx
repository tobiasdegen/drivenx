import { Play } from 'lucide-react';
import type { SmartctlReport } from '../../smartctl-types';
import { labels, translate, type Locale } from '../../i18n.mts';
import { display, failed, testAvailable, tests } from '../../drive-display';
import { translateTest } from '../../smart-test-translation';
import { configuredSelectiveSpans } from '../../ata-details.mjs';
import { selfTestSupport } from '../../../shared/self-test-assessment.mjs';

export default function SelfTestsPanel({
  raw,
  locale,
  loading,
  onStartTest,
}: {
  raw: SmartctlReport;
  locale: Locale;
  loading: boolean;
  onStartTest: (kind: 'short' | 'long') => void;
}) {
  const t = labels[locale];
  const tr = (key: string) => translate(locale, 'smartView', key);
  const startTest = onStartTest;
  const capability = selfTestSupport(raw);
  const canStart = !loading && testAvailable(raw);
  const selfTests = tests(raw);
  const ataState = raw.ata_smart_data?.self_test;
  const duration = ataState?.polling_minutes;
  const selectiveSpans = configuredSelectiveSpans(raw);
  const testStatus = ataState?.status;
  const nvmeOperation = raw.nvme_self_test_log?.current_self_test_operation?.string;
  const remaining =
    typeof testStatus?.remaining_percent === 'number' ? testStatus.remaining_percent : null;
  return (
    <section className="panel">
      <div className="table-head">
        <h3>{t.tests}</h3>
        {capability === 'supported' && (
          <div className="header-actions">
            <button
              className="button secondary"
              disabled={!canStart}
              onClick={() => void startTest('short')}
            >
              <Play size={15} />
              {t.startShort}
            </button>
            <button
              className="button secondary"
              disabled={!canStart}
              onClick={() => void startTest('long')}
            >
              <Play size={15} />
              {t.startLong}
            </button>
          </div>
        )}
      </div>
      <p className={capability === 'supported' ? 'caution-text' : 'panel-description'}>
        {capability === 'unknown'
          ? tr('selfTestEmptyUnknown')
          : capability === 'unsupported'
            ? tr('selfTestEmptyUnsupported')
            : t.selfWarning}
      </p>
      {(duration?.short != null || duration?.extended != null || testStatus?.string) && (
        <dl className="ata-details-list ata-test-summary">
          {duration?.short != null && (
            <div>
              <dt>{translate(locale, 'smartView', 'shortEstimated')}</dt>
              <dd>{duration.short} min</dd>
            </div>
          )}
          {duration?.extended != null && (
            <div>
              <dt>{translate(locale, 'smartView', 'longEstimated')}</dt>
              <dd>{duration.extended} min</dd>
            </div>
          )}
          {testStatus?.string && (
            <div>
              <dt>{translate(locale, 'smartView', 'testStatusRegister')}</dt>
              <dd>
                {translateTest(testStatus.string, locale)}
                {remaining != null
                  ? ` · ${remaining} % ${translate(locale, 'smartView', 'remaining')}`
                  : ''}
              </dd>
            </div>
          )}
        </dl>
      )}
      {nvmeOperation && (
        <p className="panel-description">
          {translate(locale, 'smartView', 'nvmeTestStatus')}: {translateTest(nvmeOperation, locale)}
        </p>
      )}
      {selfTests.length === 0 ? (
        <p className="panel-description">{tr('selfTestEmptyHistory')}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{t.tests}</th>
                <th>{tr('autoStatus')}</th>
                <th>{t.hours}</th>
                <th>LBA</th>
              </tr>
            </thead>
            <tbody>
              {selfTests.map((r, i: number) => (
                <tr key={i} className={failed(r) ? 'attention-row' : ''}>
                  <td>{i + 1}</td>
                  <td>{translateTest(r.type, locale, 'type')}</td>
                  <td>
                    {translateTest(r.status, locale)}
                    {typeof r.status === 'object' && r.status?.remaining_percent != null
                      ? ` (${r.status.remaining_percent} % ${translate(locale, 'smartView', 'remaining')})`
                      : ''}
                  </td>
                  <td>{display(r.lifetime_hours ?? r.power_on_hours)}</td>
                  <td>{display(r.lba)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectiveSpans.length > 0 ? (
        <details className="ata-extra-group">
          <summary>{translate(locale, 'smartView', 'selectiveSpans')}</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>LBA min</th>
                  <th>LBA max</th>
                  <th>{tr('autoStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {selectiveSpans.map((span, index) => (
                  <tr key={index}>
                    <td>{display(span.lba_min)}</td>
                    <td>{display(span.lba_max)}</td>
                    <td>{translateTest(span.status?.string, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
