import type { Device, Detail, Environment } from '../types';
import { labels, translate, type Locale } from '../i18n.mts';
import { countDriveErrors } from '../drive-display';
import { connectionChain } from './ConnectionChain';
import DeviceInformation from './DeviceInformation';
import DriveOverview from './DriveOverview';
import HistoryPanel from './tabs/HistoryPanel';
import AttributesPanel from './tabs/AttributesPanel';
import SelfTestsPanel from './tabs/SelfTestsPanel';
import ErrorLogPanel from './tabs/ErrorLogPanel';
import AtaHardwareDetails from './tabs/AtaHardwareDetails';
import HostIoPanel from './tabs/HostIoPanel';
import type { Tab } from './tabs/types';
export type { Tab, SmartAttribute } from './tabs/types';

export type SmartTabsProps = {
  tab: Tab;
  setTab: (tab: Tab) => void;
  locale: Locale;
  active: Device;
  detail: Detail;
  env: Environment | null;
  attributeMode: 'friendly' | 'technical';
  setAttributeMode: (value: 'friendly' | 'technical') => void;
  query: string;
  setQuery: (value: string) => void;
  loading: boolean;
  onStartTest: (kind: 'short' | 'long') => void;
};

const tabs: Tab[] = ['overview', 'hardware', 'history', 'attributes', 'tests', 'errors'];

/** Navigation only. Every panel owns its own display and its own local state. */
export default function SmartTabs(props: SmartTabsProps) {
  const { tab, setTab, locale, active, detail, env } = props;
  const t = labels[locale];
  const tr = (key: string) => translate(locale, 'smartView', key);
  const raw = detail.raw;
  const name = raw.model_name || active.info_name || active.name || '–';
  const time = new Date(detail.capturedAt).toLocaleString(locale);
  // Only derive the error count when the error log is visible. Attributes are
  // prepared by their own mounted tab, not by every drive overview render.
  const countErrors = tab === 'errors' ? countDriveErrors(raw) : null;
  const snapshotKey = `${active.name}\u0000${active.type}\u0000${detail.reportId}`;

  return (
    <>
      <nav className="tabs">
        {tabs.map((id) => (
          <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>
            {id === 'hardware' ? tr('hardware') : id === 'history' ? tr('history') : t[id]}
          </button>
        ))}
      </nav>
      {tab === 'overview' && (
        <DriveOverview
          key={snapshotKey}
          detail={detail}
          device={active}
          name={name}
          time={time}
          locale={locale}
        />
      )}
      {tab === 'hardware' && (
        <div key={snapshotKey} className="hardware-view">
          <DeviceInformation
            device={active}
            raw={raw}
            name={name}
            time={time}
            locale={locale}
            hardwareOnly
          />
          {connectionChain(active, locale, raw, env?.platform, detail.health)}
          <AtaHardwareDetails raw={raw} locale={locale} />
          <HostIoPanel
            key={snapshotKey}
            active={active}
            reportId={detail.reportId}
            locale={locale}
            platform={env?.platform}
          />
        </div>
      )}
      {tab === 'history' && (
        <HistoryPanel
          key={snapshotKey}
          active={active}
          reportId={detail.reportId}
          locale={locale}
        />
      )}
      {tab === 'attributes' && (
        <AttributesPanel
          key={snapshotKey}
          raw={raw}
          health={detail.health}
          locale={locale}
          attributeMode={props.attributeMode}
          setAttributeMode={props.setAttributeMode}
          query={props.query}
          setQuery={props.setQuery}
        />
      )}
      {tab === 'tests' && (
        <SelfTestsPanel
          key={snapshotKey}
          raw={raw}
          locale={locale}
          loading={props.loading}
          onStartTest={props.onStartTest}
        />
      )}
      {tab === 'errors' && (
        <ErrorLogPanel key={snapshotKey} raw={raw} locale={locale} countErrors={countErrors} />
      )}
    </>
  );
}
