// @ts-check
'use strict';
/**
 * An iframe shares its BrowserWindow's webContents ID and may have the same
 * URL as the main frame. Require the live main frame itself, not just the URL.
 *
 * @param {{ sender?: {isDestroyed?: () => boolean; mainFrame?: unknown}; senderFrame?: unknown } | null | undefined} event
 */
function isMainFrameSender(event) {
  if (!event?.sender || typeof event.sender.isDestroyed !== 'function') return false;
  if (event.sender.isDestroyed()) return false;
  const mainFrame = event.sender.mainFrame;
  const frame = event.senderFrame;
  if (!mainFrame || !frame) return false;
  if (frame === mainFrame) return true;
  // Electron can expose distinct JS wrappers for the same native WebFrameMain.
  // Their process/routing pair is the stable frame identity; a same-origin
  // subframe cannot claim both IDs of its parent's main frame.
  if (
    typeof frame !== 'object' ||
    typeof mainFrame !== 'object' ||
    !('routingId' in frame) ||
    !('processId' in frame) ||
    !('routingId' in mainFrame) ||
    !('processId' in mainFrame)
  )
    return false;
  return (
    typeof frame.routingId === 'number' &&
    Number.isSafeInteger(frame.routingId) &&
    typeof frame.processId === 'number' &&
    Number.isSafeInteger(frame.processId) &&
    frame.routingId === mainFrame.routingId &&
    frame.processId === mainFrame.processId
  );
}
module.exports = { isMainFrameSender };
