/** Load persisted settings before the first scan. Preference events win over late reads. */
/**
 * @param {{
 * api: Pick<import('./ipc-contract').DiagnosticsBridge, 'settings' | 'onPreferencesChanged'>,
 * onPreferences: (preferences: import('./types').Preferences) => void,
 * onScan: () => void | Promise<void>
 * }} options
 * @returns {() => void}
 */
export function startWithPreferences({ api, onPreferences, onScan }) {
  let active = true;
  let settingsChanged = false;

  const unsubscribe = api.onPreferencesChanged((value) => {
    if (!active) return;
    settingsChanged = true;
    onPreferences(value);
  });

  async function initialize() {
    try {
      const settings = await api.settings();
      if (active && !settingsChanged) onPreferences(settings);
    } catch {
      // Continue discovery with defaults if reading stored settings fails.
    }
    if (active) await onScan();
  }

  void initialize();
  return () => {
    active = false;
    unsubscribe();
  };
}
