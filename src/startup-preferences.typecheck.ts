import type { DiagnosticsBridge } from './ipc-contract';
import { startWithPreferences } from './startup-preferences.mjs';

declare const api: DiagnosticsBridge;
const stop = startWithPreferences({
  api,
  onPreferences: (settings) => {
    const enabled: boolean = settings.backgroundDetails;
    void enabled;
  },
  onScan: async () => {},
});
stop();
