'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installWebSecurity } = require('../../electron/security/web-security.js');
test('all webContents deny window creation, webviews and permissions', () => {
  const app = new EventEmitter(),
    contents = new EventEmitter(),
    session = {};
  let windowPolicy, permissionAllowed, permissionCheck;
  contents.setWindowOpenHandler = (fn) => {
    windowPolicy = fn;
  };
  contents.session = session;
  session.setPermissionRequestHandler = (fn) => {
    permissionAllowed = fn;
  };
  session.setPermissionCheckHandler = (fn) => {
    permissionCheck = fn;
  };
  installWebSecurity(app);
  app.emit('web-contents-created', {}, contents);
  assert.equal(windowPolicy().action, 'deny');
  let prevented = false;
  contents.emit('will-attach-webview', {
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  permissionAllowed(null, 'camera', (allowed) => assert.equal(allowed, false));
  assert.equal(permissionCheck(), false);
});
