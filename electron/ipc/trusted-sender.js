'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
function trustedSender({
  frameUrl,
  senderId,
  mainWindow,
  preferencesWindow,
  queryWindow,
  packaged,
  devServerUrl,
  htmlPath,
}) {
  if (typeof frameUrl !== 'string' || !frameUrl) return false;
  const windows = [
    [mainWindow, ''],
    [preferencesWindow, '#preferences'],
    [queryWindow, '#query-log'],
  ];
  const authorized = windows.find(([w]) => w && !w.isDestroyed() && w.webContents.id === senderId);
  if (!authorized) return false;
  const base =
    !packaged && devServerUrl ? devServerUrl : pathToFileURL(path.resolve(htmlPath)).href;
  let actual, expected;
  try {
    actual = new URL(frameUrl);
    expected = new URL(base);
  } catch {
    return false;
  }
  if (
    actual.origin !== expected.origin ||
    actual.pathname !== expected.pathname ||
    actual.search !== expected.search
  )
    return false;
  return actual.hash === authorized[1];
}
module.exports = { trustedSender };
