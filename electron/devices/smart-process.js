// @ts-check
'use strict';
const { spawn } = require('node:child_process');
const { smartProcessError } = require('./smart-errors.js');
const { validateSmartctlJson } = require('./smart-json.js');
const { errorMessage, errorCode } = require('../security/process-error-details.js');
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
// Kept independent of Electron to permit deterministic process fault tests.
/**
 * @typedef {{json: Record<string, unknown>; exitCode: number; stderr: string; executable: string}} SmartProcessResult
 * @typedef {{
 *   timeout?: number;
 *   maxBytes?: number;
 *   spawnProcess?: (executable: string, args: string[], options: import('node:child_process').SpawnOptions) => import('node:child_process').ChildProcess;
 * }} SmartProcessOptions
 * @param {string | undefined | null} executable
 * @param {string[]} args
 * @param {SmartProcessOptions} [options]
 * @returns {Promise<SmartProcessResult>}
 */
function runSmartProcess(
  executable,
  args,
  { timeout = 18000, spawnProcess = spawn, maxBytes = MAX_OUTPUT_BYTES } = {},
) {
  return new Promise((resolve, reject) => {
    if (!executable)
      return reject(
        smartProcessError(
          'smartctl nicht gefunden. Die benötigte ausführbare Datei ist für diese Plattform oder Architektur nicht verfügbar.',
          { code: 'ENOENT' },
        ),
      );
    let out = '',
      err = '',
      total = 0,
      finished = false,
      /** @type {(Error & {processCloseUnconfirmed?: boolean}) | null} */
      abortError = null,
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      abortGrace,
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      timer;
    /** @param {Error | null} error @param {SmartProcessResult} [value] */
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(abortGrace);
      if (error) reject(error);
      else if (value) resolve(value);
      else reject(new Error('smartctl-Ergebnis fehlt'));
    };
    /** @type {import('node:child_process').ChildProcess | undefined} */
    let child;
    // Do not release the per-device operation slot until the killed process
    // closes. A bounded fallback handles a process that never emits 'close'.
    /** @param {Error & {processCloseUnconfirmed?: boolean}} error */
    const abort = (error) => {
      if (finished || abortError) return;
      abortError = error;
      clearTimeout(timer);
      abortGrace = setTimeout(() => {
        // SIGKILL is a request, not proof that the process exited. Tell the
        // device queue to quarantine this path rather than risking overlap.
        error.processCloseUnconfirmed = true;
        finish(error);
      }, 300);
      try {
        child?.kill('SIGKILL');
      } catch {}
    };
    try {
      child = spawnProcess(executable, args, {
        shell: false,
        windowsHide: true,
        env: { ...process.env, LC_ALL: 'C' },
      });
    } catch (error) {
      return finish(
        smartProcessError(`smartctl konnte nicht gestartet werden: ${errorMessage(error)}`, {
          code: errorCode(error) === 'EACCES' ? 'EACCES_EXEC' : errorCode(error),
          stderr: errorMessage(error),
        }),
      );
    }
    timer = setTimeout(
      () =>
        abort(smartProcessError('Zeitüberschreitung beim smartctl-Aufruf', { code: 'ETIMEDOUT' })),
      timeout,
    );
    // An asynchronous child error does not guarantee the OS process has
    // already exited. Retain the device queue slot until 'close' confirms it.
    child.on('error', (error) => {
      if (abortError || finished) return;
      abort(
        smartProcessError(`smartctl konnte nicht gestartet werden: ${errorMessage(error)}`, {
          code: errorCode(error) === 'EACCES' ? 'EACCES_EXEC' : errorCode(error),
          stderr: errorMessage(error),
        }),
      );
    });
    /** @type {Array<[import('node:stream').Readable | null, 'out' | 'err']>} */
    const streams = [
      [child.stdout, 'out'],
      [child.stderr, 'err'],
    ];
    for (const [stream, kind] of streams) {
      if (!stream) {
        return abort(new Error('smartctl-Ausgabestream nicht verfügbar'));
      }
      stream.setEncoding('utf8');
      // Pipe failures are emitted independently of the child 'error' event.
      // Without a listener they can terminate Electron's main process.
      stream.on('error', (error) =>
        abort(
          smartProcessError(`smartctl-Ausgabestream fehlgeschlagen: ${errorMessage(error)}`, {
            code: errorCode(error),
            stderr: errorMessage(error),
          }),
        ),
      );
      stream.on('data', (chunk) => {
        if (finished || abortError) return;
        const data = String(chunk);
        total += Buffer.byteLength(data, 'utf8');
        if (total > maxBytes) {
          return abort(new Error('smartctl-Ausgabe überschreitet 4 MiB'));
        }
        if (kind === 'out') out += data;
        else err += data;
      });
    }
    child.on('close', (code) => {
      if (finished) return;
      if (abortError) return finish(abortError);
      let json;
      try {
        json = JSON.parse(out);
      } catch {
        return finish(
          smartProcessError(
            `Keine gültige JSON-Ausgabe von smartctl (Code ${code}). ${err.slice(0, 300) || out.slice(0, 300)}`,
            { stderr: err, stdout: out.slice(0, 1024) },
          ),
        );
      }
      try {
        json = validateSmartctlJson(json);
      } catch (error) {
        return finish(smartProcessError(errorMessage(error), { stderr: err.slice(0, 1024) }));
      }
      finish(null, { json, exitCode: code ?? 255, stderr: err, executable });
    });
  });
}
module.exports = { runSmartProcess, MAX_OUTPUT_BYTES };
