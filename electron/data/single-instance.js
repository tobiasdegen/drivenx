'use strict';

// Electron's instance lock is keyed to the configured application profile.
// Call this after configuring portable userData and before app.whenReady().
function enableSingleInstance(app, getWindows) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    const windows = getWindows();
    const target =
      windows.main && !windows.main.isDestroyed()
        ? windows.main
        : windows.preferences && !windows.preferences.isDestroyed()
          ? windows.preferences
          : null;
    if (!target) return; // Initial window may still be loading.
    if (target.isMinimized()) target.restore();
    if (!target.isVisible()) target.show();
    target.focus();
  });
  return true;
}

module.exports = { enableSingleInstance };
