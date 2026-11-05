'use strict';

const permittedChannels = new Set([
  'diagnostics:queryLogAppearance',
  'diagnostics:queryLog',
  'diagnostics:queryLogResult',
  'diagnostics:saveQueryLogResult',
  'diagnostics:clearQueryLog',
  'diagnostics:exportQueryLog',
]);

/** Prevent the separate log renderer from requesting SMART commands or settings writes. */
function queryLogChannelAllowed(senderId, queryWindow, channel) {
  if (!queryWindow || queryWindow.isDestroyed() || queryWindow.webContents.id !== senderId)
    return true;
  return permittedChannels.has(channel);
}

module.exports = { queryLogChannelAllowed };
