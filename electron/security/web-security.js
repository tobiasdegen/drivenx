'use strict';
function installWebSecurity(app) {
  const configuredSessions = new WeakSet();
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
    const session = contents.session;
    // The application requires neither camera/microphone/geolocation nor browser permissions.
    if (session && !configuredSessions.has(session)) {
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.setPermissionCheckHandler(() => false);
      configuredSessions.add(session);
    }
  });
}
module.exports = { installWebSecurity };
