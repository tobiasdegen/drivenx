'use strict';
const fs = require('node:fs');
const path = require('node:path');
const MAX_SIZE = 512 * 1024;
// Startup log contains only operational metadata, never renderer exception bodies,
// arbitrary URLs or local executable paths (which may contain personal data).
function startupLog(folder, tag, message = '') {
  const allowed = new Set([
    'pre-ready',
    'instance-lock-unavailable',
    'startup-failed',
    'launch',
    'page-loaded',
    'react-check',
    'load-failed',
    'preload-error',
    'renderer-gone',
    'renderer-console',
    'react-check-error',
    'binary-invalid',
    'scan-timing',
    'windows-metadata-timing',
    'main-init-timing',
    'settings-timing',
    'bootstrap-timing',
    'window-visible-timing',
    'splash-visible',
    'splash-failed',
  ]);
  if (!allowed.has(tag)) return;
  try {
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, 'startup.log');
    const stat = fs.existsSync(file) ? fs.statSync(file) : null;
    if (stat && stat.size >= MAX_SIZE) {
      const rotated = path.join(folder, 'startup.previous.log');
      fs.rmSync(rotated, { force: true });
      fs.renameSync(file, rotated);
    }
    // Never persist free-form exception messages / file URLs / device identifiers.
    const safe = [
      'scan-timing',
      'windows-metadata-timing',
      'main-init-timing',
      'settings-timing',
      'bootstrap-timing',
      'window-visible-timing',
    ].includes(tag)
      ? `${Number.isSafeInteger(Number(message)) && Number(message) >= 0 ? Number(message) : 0}ms`
      : [
            'pre-ready',
            'launch',
            'page-loaded',
            'load-failed',
            'renderer-gone',
            'react-check',
          ].includes(tag)
        ? String(message)
            .replace(/[^a-zA-Z0-9 .,/=_-]/g, '')
            .slice(0, 160)
        : {
            'instance-lock-unavailable': 'another-instance-or-lock-error',
            'startup-failed': 'main-process-startup-failed',
            'renderer-console': 'renderer-error',
            'preload-error': 'preload',
            'react-check-error': 'renderer-check-failed',
            'binary-invalid': 'binary-rejected',
            'splash-visible': 'startup-hint',
            'splash-failed': 'startup-hint-failed',
          }[tag] || 'event';
    fs.appendFileSync(file, `${new Date().toISOString()} [${tag}] ${safe}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    /* logging must not prevent application launch */
  }
}
module.exports = { startupLog, MAX_SIZE };
