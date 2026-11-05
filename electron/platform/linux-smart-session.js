// @ts-check
'use strict';
const { spawn } = require('node:child_process');
const {
  findTrustedExecutable,
  PKEXEC_PATHS,
  trustedSystemExecutable,
} = require('./linux-smartctl.js');
const { smartProcessError } = require('../devices/smart-errors.js');
const { validateSmartctlJson } = require('../devices/smart-json.js');
const HELPER = '/usr/libexec/drivenx-smartctl-helper';
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * One short-lived privileged subprocess per application session, not per query.
 * The helper is root-installed, has a strict command allowlist, and only reads
 * requests from a private anonymous pipe. It exits when Electron closes it.
 */
/** @typedef {import('node:child_process').ChildProcessWithoutNullStreams} LinuxWorker */
/**
 * @typedef {{
 *  id: number,
 *  timer: ReturnType<typeof setTimeout>,
 *  resolve: (value: {json: Record<string, unknown>, exitCode: number, stderr: string, executable: string}) => void,
 *  reject: (reason: unknown) => void,
 *  binary: string
 * }} LinuxPendingRequest
 */
/**
 * @param {{spawnProcess?:typeof spawn, trusted?:typeof trustedSystemExecutable, findPkexec?:()=>Promise<string|null>}} [options]
 */
function createLinuxSmartSession({
  spawnProcess = spawn,
  trusted = trustedSystemExecutable,
  findPkexec = () => findTrustedExecutable(PKEXEC_PATHS),
} = {}) {
  /** @type {LinuxWorker | null} */
  let worker = null;
  /** @type {LinuxPendingRequest | null} */
  let pending = null;
  let buffer = '';
  let sequence = 0;
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  let unavailable = false;
  let authorized = false;

  function stop(error = new Error('Linux SMART helper exited')) {
    const old = worker;
    worker = null;
    buffer = '';
    authorized = false;
    if (pending) {
      const request = pending;
      pending = null;
      clearTimeout(request.timer);
      request.reject(error);
    }
    if (old) {
      try {
        old.stdin.end();
      } catch {
        /* already closed */
      }
      try {
        old.kill();
      } catch {
        /* already closed */
      }
    }
  }

  async function available() {
    return trusted(HELPER);
  }

  async function ensureWorker() {
    if (unavailable)
      throw smartProcessError('Linux SMART authorization was denied', { code: 'EPERM' });
    if (worker) return worker;
    if (!(await trusted(HELPER))) throw new Error('Linux SMART helper is not installed');
    const pkexec = await findPkexec();
    if (!pkexec) throw smartProcessError('pkexec is not installed', { code: 'ENOENT' });
    const child = spawnProcess(pkexec, ['--disable-internal-agent', HELPER], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    worker = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text) => {
      if (worker !== child) return;
      buffer += text;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_RESPONSE_BYTES) {
        stop(new Error('Linux SMART helper output too large'));
        return;
      }
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd < 0) return;
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
      if (!pending) {
        stop(new Error('Unexpected Linux SMART helper response'));
        return;
      }
      const request = pending;
      pending = null;
      clearTimeout(request.timer);
      authorized = true;
      try {
        const reply = JSON.parse(line);
        if (reply.id !== request.id || typeof reply !== 'object')
          throw new Error('Invalid helper response');
        if (typeof reply.error === 'string') throw smartProcessError(reply.error);
        if (
          typeof reply.stdout !== 'string' ||
          typeof reply.stderr !== 'string' ||
          !Number.isInteger(reply.exitCode)
        )
          throw new Error('Invalid helper response');
        const json = validateSmartctlJson(JSON.parse(reply.stdout));
        request.resolve({
          json,
          exitCode: reply.exitCode,
          stderr: reply.stderr,
          executable: request.binary,
        });
      } catch (error) {
        request.reject(error);
      }
      if (buffer.length) stop(new Error('Unexpected extra Linux SMART helper response'));
    });
    child.stderr.on('data', () => {
      /* No privileged stderr is logged. */
    });
    child.stdin.on('error', () => stop(new Error('Linux SMART helper input closed')));
    child.stdout.on('error', () => stop(new Error('Linux SMART helper output failed')));
    child.on('error', () => stop(new Error('Linux SMART helper could not be started')));
    child.on('exit', (code) => {
      if (code === 126 || code === 127) unavailable = true;
      if (worker === child)
        stop(smartProcessError('Linux SMART authorization failed', { code: 'EPERM' }));
    });
    return child;
  }

  /** @param {string} binary @param {string[]} args @param {number} timeoutMs */
  function run(binary, args, timeoutMs) {
    const execute = async () => {
      const child = await ensureWorker();
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        // The first request may wait for an interactive Polkit password dialog.
        // Subsequent requests use only the SMART command timeout.
        const waitMs = authorized ? timeoutMs + 2500 : timeoutMs + 90000;
        const timer = setTimeout(() => {
          stop(smartProcessError('Linux SMART helper timed out', { code: 'ETIMEDOUT' }));
        }, waitMs);
        pending = { id, timer, resolve, reject, binary };
        try {
          child.stdin.write(
            JSON.stringify({
              id,
              args,
              timeout: Math.max(1, Math.min(70, Math.ceil(timeoutMs / 1000))),
            }) + '\n',
          );
        } catch (error) {
          stop(error instanceof Error ? error : new Error('Linux SMART helper write failed'));
        }
      });
    };
    const operation = queue.then(execute, execute);
    queue = operation.catch(() => undefined);
    return operation;
  }
  return Object.freeze({ available, run, stop });
}

const linuxSmartSession = createLinuxSmartSession();
module.exports = { HELPER, createLinuxSmartSession, linuxSmartSession };
