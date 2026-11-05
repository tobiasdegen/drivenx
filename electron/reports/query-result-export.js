'use strict';

/** Build a self-contained, valid JSON export from a single bounded query result.
 * Complete JSON stays as the original object. Non-JSON or truncated
 * results use a clearly marked envelope; never mislabel clipped JSON as valid.
 */
function individualQueryExport(log, id) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const entry = log.entries().find((item) => item.id === id);
  const output = log.result(id);
  if (!entry || !output) return null;
  let data;
  if (!output.truncated) {
    try {
      data = JSON.parse(output.text);
    } catch {
      /* Treat invalid JSON as text. */
    }
  }
  if (data === undefined) {
    data = {
      source: 'DriveNX',
      query: {
        startedAt: entry.startedAt,
        command: entry.command,
        device: entry.device,
        exitCode: entry.exitCode,
        status: entry.status,
      },
      outputFormat: output.format,
      truncated: output.truncated,
      output: output.text,
    };
  }
  const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(entry.startedAt)
    ? entry.startedAt.slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
    : 'query';
  const device = (entry.device || 'system').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 45);
  const mode = String(entry.mode || 'other')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 35);
  return {
    filename: `DriveNX-${date}-${device}-${mode}-${id}.json`,
    body: JSON.stringify(data, null, 2) + '\n',
  };
}
module.exports = { individualQueryExport };
