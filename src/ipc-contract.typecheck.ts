/** Compile-only checks for public bridge signatures; not included in production app. */
import type { DeviceReference, DiagnosticsBridge, SelfTestKind, ScanResult } from './ipc-contract';
import type { Detail, Health, HistoryRecord } from './types';
import type {
  Health as BackendHealth,
  HistoryRecord as BackendHistoryRecord,
} from '../electron/backend-contracts';
import type { OverviewData } from '../shared/overview-metrics.mjs';
type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type _Scan = Assert<Equal<Awaited<ReturnType<DiagnosticsBridge['scan']>>, ScanResult>>;
type _ScanGenerationRequired = Assert<Equal<ScanResult['generation'], number>>;
/** Batch USB mode is an allowlisted argument, not a user-controlled smartctl flag. */
type _ScanUsbMode = Assert<
  Equal<
    NonNullable<Parameters<DiagnosticsBridge['scan']>[0]>,
    import('../shared/scan-usb-mode.mjs').ScanUsbMode
  >
>;
type _Detail = Assert<Equal<Awaited<ReturnType<DiagnosticsBridge['detail']>>, Detail>>;
/** Backend persisted records and health states must match renderer expectations. */
type _HealthContract = Assert<Equal<BackendHealth, Health>>;
type _HistoryContract = Assert<Equal<BackendHistoryRecord, HistoryRecord>>;
type _Test = Assert<Equal<Parameters<DiagnosticsBridge['test']>[1], SelfTestKind>>;

/** Main-process summaries are additive for older/imported report fixtures. */
type _Metric = Assert<Equal<Detail['metrics'], OverviewData | undefined>>;

/** History actions must refer to a concrete SMART report, not just its drive. */
type _HistoryReadReport = Assert<Equal<Parameters<DiagnosticsBridge['history']>[1], string>>;
type _HistoryImportReport = Assert<
  Equal<Parameters<DiagnosticsBridge['importHistory']>[1], string>
>;
type _HistoryExportReport = Assert<
  Equal<Parameters<DiagnosticsBridge['exportHistory']>[1], string>
>;

/** The privilege boundary consumes only the scanned access identity, not USB/OS display metadata. */
type DeviceBoundCommand =
  | 'detail'
  | 'history'
  | 'saveHistory'
  | 'importHistory'
  | 'exportHistory'
  | 'macHostIo'
  | 'test'
  | 'exportReport';
type _DevicePayload = Assert<
  Equal<Parameters<DiagnosticsBridge[DeviceBoundCommand]>[0], DeviceReference>
>;
type _OnlyIdentity = Assert<Equal<keyof DeviceReference, 'name' | 'type'>>;
type _NoConstantScanExitCode = Assert<
  Equal<'exitCode' extends keyof ScanResult ? true : false, false>
>;
