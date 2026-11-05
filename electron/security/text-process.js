// @ts-check
'use strict';
const { spawn } = require('node:child_process');
const { errorMessage } = require('./process-error-details.js');
/**
 * Execute only a caller-selected executable with explicit arguments (never a shell).
 * @param {string} executable
 * @param {string[]} args
 * @param {{ timeout?: number; maxOutput?: number; maxError?: number;
 *   spawnProcess?: (executable: string, args: string[], options: import('node:child_process').SpawnOptions) => import('node:child_process').ChildProcess }} [options]
 * @returns {Promise<string>}
 */
function runTextProcess(
  executable,
  args,
  { timeout = 15000, maxOutput = 1024 * 1024, maxError = 64 * 1024, spawnProcess = spawn } = {},
) {
  return new Promise((resolve, reject) => {
    if (typeof executable !== 'string' || !executable)
      return reject(new Error('Programm nicht angegeben'));
    let out = '',
      err = '',
      outBytes = 0,
      errBytes = 0,
      done = false,
      /** @type {Error | null} */
      abortError = null,
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      abortGrace,
      /** @type {import('node:child_process').ChildProcess | undefined} */
      child,
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      timer;
    /** @param {Error|null} error @param {string} [result] */
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(abortGrace);
      error ? reject(error) : resolve(result ?? '');
    };
    /** @param {string} message */
    const abort = (message) => {
      if (done || abortError) return;
      abortError = new Error(message);
      clearTimeout(timer);
      // A bounded grace period: do not start a second disk operation before
      // the previous process has normally exited after being killed.
      abortGrace = setTimeout(() => finish(abortError), 300);
      try {
        child?.kill('SIGKILL');
      } catch {}
    };
    try {
      child = spawnProcess(executable, args, { shell: false, windowsHide: true });
    } catch (e) {
      return finish(new Error(`${executable}: Start fehlgeschlagen: ${errorMessage(e)}`));
    }
    timer = setTimeout(() => abort(`${executable}: Zeitüberschreitung`), timeout);
    // The error event alone does not confirm that the child has exited.
    child.on('error', (error) => {
      if (!abortError && !done) abort(`${executable}: ${errorMessage(error)}`);
    });
    if (!child.stdout || !child.stderr)
      return abort(`${executable}: Ausgabestream nicht verfügbar`);
    /** @type {Array<[import('node:stream').Readable | null, 'stdout' | 'stderr']>} */
    const streams = [
      [child.stdout, 'stdout'],
      [child.stderr, 'stderr'],
    ];
    for (const [stream, kind] of streams) {
      if (!stream) return abort(`${executable}: Ausgabestream nicht verfügbar`);
      stream.setEncoding('utf8');
      stream.on('error', (error) =>
        abort(`${executable}: Ausgabestream fehlgeschlagen: ${error.message}`),
      );
      stream.on('data', (chunk) => {
        if (done || abortError) return;
        const value = String(chunk),
          bytes = Buffer.byteLength(value, 'utf8');
        if (kind === 'stdout') {
          outBytes += bytes;
          if (outBytes > maxOutput) return abort(`${executable}: Standardausgabe zu groß`);
          out += value;
        } else {
          errBytes += bytes;
          if (errBytes > maxError) return abort(`${executable}: Fehlerausgabe zu groß`);
          err += value;
        }
      });
    }
    child.on('close', (code) =>
      abortError
        ? finish(abortError)
        : code === 0
          ? finish(null, out)
          : finish(new Error(err.trim().slice(0, 1024) || `${executable}: Exit ${code}`)),
    );
  });
}
module.exports = { runTextProcess };
