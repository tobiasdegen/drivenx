import type { DiagnosticsBridge, ScanResult } from './ipc-contract';
import type { Device, Detail } from './types';
import { createRequestTracker } from './request-tracker.mjs';
import { createDetailRequests } from './detail-requests.mjs';
import {
  chooseScannedDevice,
  scheduleScanFollowups,
  startBackgroundReads,
} from './scan-followups.mjs';

declare const devices: Device[];
declare const bridge: DiagnosticsBridge;
declare const scanResult: ScanResult;
declare const detail: Detail;

const tracker = createRequestTracker();
const selected = chooseScannedDevice(devices, '', devices[0].name);
const deviceRef = { current: devices };
const aliasGroupsRef = { current: [] as Pick<Device, 'name' | 'type'>[][] };
const selectedRef = { current: '' };

scheduleScanFollowups({
  result: scanResult,
  epoch: 1,
  tracker,
  api: bridge,
  deviceRef,
  aliasGroupsRef,
  selectedRef,
  onDevices: () => {},
  onNotice: () => {},
});
void startBackgroundReads({
  devices,
  selectedKey: '',
  epoch: 1,
  tracker,
  api: bridge,
  onDetail: (_key, result) => {
    const reportId: string = result.reportId;
    void reportId;
  },
  onError: () => {},
});
// The background reader deliberately accepts the cached request interface
// (`read(device, options?)`) without confusing its options object with the
// IPC bridge's boolean `fresh` parameter. This is also how useDriveSession
// wires these components together.
const cachedRequests = createDetailRequests((device, fresh) => bridge.detail(device, fresh));
void startBackgroundReads({
  devices,
  selectedKey: '',
  epoch: 1,
  tracker,
  api: { detail: cachedRequests.read },
  onDetail: () => {},
  onError: () => {},
});
void selected;
void detail;
