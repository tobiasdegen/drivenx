import { AlertTriangle, Download, HardDrive, Info, LoaderCircle, RefreshCw } from 'lucide-react';
import { labels, translate } from '../i18n.mts';
import { macUsbScsiSmartLimitation } from '../mac-usb-smart-limitation.mjs';
import DriveHeader from './DriveHeader';
import DeviceAccessDialog from './DeviceAccessDialog';
import UsbMediaChoiceDialog from './UsbMediaChoiceDialog';
import DriveSidebar from './DriveSidebar';
import SmartTabs from './SmartTabs';
import type { useDriveSession } from '../hooks/useDriveSession';

/** Presentation only: all device commands are owned by useDriveSession. */
export default function DriveWorkspace({
  session,
}: {
  session: ReturnType<typeof useDriveSession>;
}) {
  const {
    changingAccess,
    changeAccessMode,
    pendingUsbChoice,
    chooseUsbMedium,
    deferUsbChoice,
    scanUsbMode,
    scanWithUsbMode,
    locale,
    env,
    devices,
    selected,
    details,
    detailErrors,
    attributeMode,
    setAttributeMode,
    busy,
    testing,
    loading,
    error,
    setError,
    notice,
    setNotice,
    tab,
    setTab,
    query,
    setQuery,
    active,
    detail,
    scan,
    refreshActive,
    selectDevice,
    startTest,
    exportAs,
  } = session;
  const t = labels[locale];
  return (
    <div className="shell">
      {pendingUsbChoice && active?.name === pendingUsbChoice && active.requiresUsbChoice && (
        <UsbMediaChoiceDialog
          device={active}
          locale={locale}
          changing={changingAccess}
          onChoose={chooseUsbMedium}
          onLater={deferUsbChoice}
        />
      )}
      <DriveSidebar
        locale={locale}
        devices={devices}
        selected={selected}
        details={details}
        detailErrors={detailErrors}
        env={env}
        onScan={() => void scan()}
        busy={busy || testing}
        onSelect={selectDevice}
        onOpenPreferences={() => void window.diagnostics.openPreferences()}
      />
      <main className="main">
        <header className="topbar">
          <h1>{t.title}</h1>
          <div className="header-actions">
            <DeviceAccessDialog
              locale={locale}
              disabled={busy || testing}
              changing={changingAccess}
              device={active}
              scanMode={scanUsbMode}
              onScanMode={scanWithUsbMode}
              onDeviceMode={(mode) => void changeAccessMode(mode)}
            />
            <button
              className="button secondary"
              onClick={() => void refreshActive()}
              disabled={busy || testing}
            >
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
              {translate(locale, 'smartView', 'refreshDiagnosisAction')}
            </button>
            <button
              className="button primary"
              onClick={() => void exportAs('pdf')}
              disabled={!detail || busy || loading}
            >
              <Download size={15} />
              {t.export}
            </button>
          </div>
        </header>
        {error && (
          <div className="banner error">
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button
              type="button"
              aria-label={translate(locale, 'smartView', 'uiDismissMessage')}
              onClick={() => setError('')}
            >
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="banner info">
            <Info size={16} />
            <span>{notice}</span>
            <button
              type="button"
              aria-label={translate(locale, 'smartView', 'uiDismissMessage')}
              onClick={() => setNotice('')}
            >
              ×
            </button>
          </div>
        )}
        {!active ? (
          <div className="center-empty">
            <HardDrive size={32} />
            {busy ? t.running : t.noDrives}
          </div>
        ) : (
          <>
            <DriveHeader device={active} detail={detail} locale={locale} />
            {macUsbScsiSmartLimitation(
              active,
              env?.platform,
              detail?.health.readout.status,
              detailErrors[selected],
            ) && (
              <div className="banner info" role="status">
                <Info size={17} />
                <span>{translate(locale, 'smartView', 'macUsbScsiReadUnavailable')}</span>
              </div>
            )}
            {!detail && (loading || busy) && (
              <div className="center-empty">
                <LoaderCircle className="spin" /> {t.running}
              </div>
            )}
            {!detail && !loading && !busy && active.requiresUsbChoice && (
              <div className="center-empty">
                <Info size={23} />
                {translate(locale, 'smartView', 'usbChoicePending')}
                <button className="button secondary" onClick={() => void refreshActive()}>
                  {translate(locale, 'smartView', 'usbChoiceTitle')}
                </button>
              </div>
            )}
            {!detail && !loading && !busy && !active.requiresUsbChoice && (
              <div className="center-empty">
                <Info size={23} />
                {translate(locale, 'smartView', 'noCurrentDiagnosis')}
                <button className="button secondary" onClick={() => void refreshActive()}>
                  {t.refresh}
                </button>
              </div>
            )}
            {detail && (
              <SmartTabs
                tab={tab}
                setTab={setTab}
                locale={locale}
                active={active}
                detail={detail}
                env={env}
                attributeMode={attributeMode}
                setAttributeMode={setAttributeMode}
                query={query}
                setQuery={setQuery}
                loading={loading}
                onStartTest={(kind) => void startTest(kind)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
