// @ts-check
'use strict';
/**
 * The IPC response envelope and sender authorization are shared by all
 * registered channels. Run the authorization outside the handler but never
 * let a malformed/disposed sender cause a rejected invoke() without an envelope.
 *
 * @param {{
 *   ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => void },
 *   authorize: (event: unknown, channel: string) => boolean,
 *   unauthorizedMessage: () => string,
 *   serializeError: (error: unknown) => string
 * }} options
 */
function createIpcRegistrar({ ipcMain, authorize, unauthorizedMessage, serializeError }) {
  /** @param {string} channel @param {(...args: unknown[]) => unknown | Promise<unknown>} handler */
  return function register(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      // Fail closed when a renderer is destroyed while the main process
      // performs the identity checks (including WebFrameMain getters).
      let authorized;
      try {
        authorized = authorize(event, channel) === true;
      } catch {
        return { ok: false, error: unauthorizedMessage() };
      }
      if (!authorized) return { ok: false, error: unauthorizedMessage() };
      try {
        return { ok: true, value: await handler(...args) };
      } catch (error) {
        return { ok: false, error: serializeError(error) };
      }
    });
  };
}
module.exports = { createIpcRegistrar };
