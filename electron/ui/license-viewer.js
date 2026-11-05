// @ts-check
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { getCatalogSection } = require('./translator.js');

// This URL is only a command identifier. Navigations are blocked in main.js;
// the sole recognized action opens an existing local, sandboxed license file.
const CHROMIUM_NOTICE_URL = 'https://drivenx.invalid/runtime-license-notices';

/** Keep labels synchronized with package-lock.json via licenses:check. */
/** @type {readonly (readonly [string, string])[]} */
const COMPONENTS = Object.freeze([
  ['Electron 45.2.1 – MIT', 'licenses/Electron-MIT.txt'],
  ['React 19.3.1 – MIT', 'licenses/React-MIT.txt'],
  ['React DOM 19.3.1 – MIT', 'licenses/React-DOM-MIT.txt'],
  ['Scheduler 0.28.0 – MIT', 'licenses/Scheduler-MIT.txt'],
  ['Lucide React 1.66.0 – ISC / Feather MIT', 'licenses/Lucide-ISC-and-Feather-MIT.txt'],
  ['smartmontools – GNU GPL', 'smartmontools/COPYING-smartmontools.txt'],
  ['USB ID Repository 2026.06.26 – BSD-3-Clause', 'usb-ids/LICENSE-BSD-3-Clause.txt'],
]);

/** @param {string} value */
function escapeHtml(value) {
  /** @type {Record<string, string>} */
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

/** @param {{packaged: boolean; root: string; resourcesPath?: string}} context */
function licenseFiles(context) {
  const root = context.packaged ? context.resourcesPath : context.root;
  if (!root) throw new Error('Missing resources directory');
  return {
    own: path.join(root, 'LICENSE.md'),
    disclaimer: path.join(root, 'DISCLAIMER.md'),
    disclaimerEnglish: path.join(root, 'DISCLAIMER.en.md'),
    notice: path.join(root, 'LICENSE-THIRD-PARTY.md'),
    components: COMPONENTS.map(([title, rel]) => ({
      title,
      file: path.join(
        root,
        context.packaged ? rel : rel.startsWith('licenses/') ? rel : `vendor/${rel}`,
      ),
    })),
  };
}

/** Render the small local Markdown subset used in the bundled legal notices.
 * Every text fragment is HTML-escaped before markup is added; never execute Markdown HTML.
 * @param {string} text
 */
function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** @param {string} line */
function parseMarkdownCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((value) => value.trim());
}

/** @param {string} line */
function isTableDelimiter(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

/** Local Markdown renderer for headings, paragraphs, lists and tables. No external dependencies. @param {string} markdown */
function renderLegalMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      const headings = parseMarkdownCells(line);
      const head = headings
        .map((cell) => `<th scope="col">${renderInlineMarkdown(cell)}</th>`)
        .join('');
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = parseMarkdownCells(lines[i]);
        if (cells.length === headings.length) {
          rows.push(
            `<tr>${cells.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`,
          );
        }
        i++;
      }
      html.push(
        `<div class="license-table-scroll"><table class="license-table"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`,
      );
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(`<li>${renderInlineMarkdown(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !(lines[i].trim().startsWith('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1]))
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    html.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
  }
  return html.join('\n');
}

/** Compact component overview; original license texts remain in independent details blocks.
 * Detailed provenance and build notes stay in the packaged LICENSE-THIRD-PARTY.md.
 * @param {string} source @param {string} locale
 */
function renderComponentInventory(source, locale) {
  const lines = source.split(/\r?\n/);
  const rows = lines.filter((line) => /^\s*\|/.test(line));
  /** @param {string} line */
  const cells = (line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((x) => x.trim());
  const tableRows = rows
    .map(cells)
    .filter((cols) => cols.length === 4 && !cols.every((x) => /^[-: ]+$/.test(x)));
  const tr = getCatalogSection(locale, 'legalViewer');
  const headings = [tr.columnComponent, tr.columnVersion, tr.columnLicense];
  return `<div class="license-table-scroll"><table class="license-table"><thead><tr>${headings.map((x) => `<th scope="col">${escapeHtml(x)}</th>`).join('')}</tr></thead><tbody>${tableRows
    .slice(1)
    .map(
      (row) =>
        `<tr>${row
          .slice(0, 3)
          .map((item) => `<td>${renderInlineMarkdown(item)}</td>`)
          .join('')}</tr>`,
    )
    .join('')}</tbody></table></div>`;
}

/** @param {{locale:string; context:{packaged:boolean; root:string; resourcesPath?:string}}} args */
function createLicenseHtml({ locale, context }) {
  const de = locale !== 'en-US';
  const files = licenseFiles(context);
  const own = fs.readFileSync(files.own, 'utf8');
  const disclaimer = fs.readFileSync(de ? files.disclaimer : files.disclaimerEnglish, 'utf8');
  const notices = fs.readFileSync(files.notice, 'utf8');
  const componentNotices = files.components
    .map(
      (item) =>
        `<details class="component"><summary>${escapeHtml(item.title)}</summary><pre>${escapeHtml(fs.readFileSync(item.file, 'utf8'))}</pre></details>`,
    )
    .join('\n');
  const tr = getCatalogSection(locale, 'legalViewer');
  const title = tr.heading;
  const lead = tr.lead;
  const ownTitle = tr.ownTitle;
  const disclaimerTitle = tr.disclaimerTitle;
  const thirdPartyTitle = tr.thirdPartyTitle;
  const originalTitle = tr.originalTitle;
  const chromiumTitle = tr.chromiumTitle;
  return `<!doctype html><html lang="${locale}"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"/>
<title>${escapeHtml(title)} · DriveNX</title>
<style>
*,*:before,*:after{box-sizing:border-box}
html{color-scheme:dark light;background:#0c1625;color:#edf3fa;font:14px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
body{margin:0}header{padding:22px 32px;border-bottom:1px solid #31415a;background:#122037}
header b{font-size:20px}header p{color:#aebfd5;margin:5px 0 0}
main{max-width:970px;margin:24px auto 70px;padding:0 25px}h1{font-size:19px;margin:8px 0 14px}h2{font-size:16px;margin:24px 0 8px}h3{font-size:14px}p{margin:10px 0;color:#cbd8e8}
strong{color:inherit}code,pre{font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}
code{overflow-wrap:anywhere;background:rgba(127,160,203,.10);border-radius:4px;padding:1px 4px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:16px 20px;color:#cad6e5}pre code{background:transparent;padding:0}
section.notice{border:1px solid #364962;border-radius:10px;margin:13px 0;background:#101c30;overflow:hidden}
section.notice>details>summary{cursor:pointer;font-size:16px;font-weight:650;padding:18px 21px;list-style:revert}
section.notice>details[open]>summary{border-bottom:1px solid #364962}
.notice-body{padding:16px 24px 25px}.notice-body h1{font-size:17px}
.component{border:1px solid #384860;border-radius:8px;margin:9px 0;overflow:hidden}
.component summary{cursor:pointer;padding:11px 15px;font-weight:600}
.component[open] summary{border-bottom:1px solid #384860}
a{color:#80b9ff}a:focus-visible,summary:focus-visible{outline:2px solid #80b9ff;outline-offset:2px}
.license-table-scroll{overflow:auto;max-width:100%;border:1px solid #364962;border-radius:8px}
.license-table{border-collapse:collapse;width:100%;min-width:460px;font-size:12px}
.license-table th,.license-table td{padding:9px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #364962}
.license-table th{background:#1a2a43}.license-table td:first-child{font-weight:600}.license-table tbody tr:last-child td{border-bottom:0}
@media(prefers-color-scheme:light){html{background:#f6f8fb;color:#172333}header,section.notice{background:#fff;border-color:#ccd7e5}header p,p,pre{color:#42516a}section.notice>details[open]>summary,.component,.component[open] summary,.license-table-scroll,.license-table td{border-color:#ccd7e5}.license-table th{background:#eaf0f7}a{color:#095ca6}}
</style></head><body>
<header><b>DriveNX · ${escapeHtml(title)}</b><p>${escapeHtml(lead)}</p></header>
<main>
<section class="notice"><details open><summary>${escapeHtml(ownTitle)}</summary><div class="notice-body">${renderLegalMarkdown(own)}</div></details></section>
<section class="notice"><details><summary>${escapeHtml(disclaimerTitle)}</summary><div class="notice-body">${renderLegalMarkdown(disclaimer)}</div></details></section>
<section class="notice"><details><summary>${escapeHtml(thirdPartyTitle)}</summary><div class="notice-body">
<p>${escapeHtml(tr.thirdPartyNote)}</p>
${renderComponentInventory(notices, locale)}
<h2>${escapeHtml(originalTitle)}</h2>${componentNotices}
<p><a href="${CHROMIUM_NOTICE_URL}">${escapeHtml(chromiumTitle)}</a></p>
<p>${escapeHtml(tr.sourceNote)}</p>
</div></details></section>
</main></body></html>`;
}

/** Locate original runtime notices (not a downloaded website). */
/** @param {{ execPath: string, resourcesPath: string, platform: string }} options */
function chromiumLicenseCandidates({ execPath, resourcesPath, platform }) {
  // Resolve native paths for the requested target, including cross-platform tests.
  const targetPath = platform === 'win32' ? path.win32 : platform === 'darwin' ? path.posix : path;
  const runtime = targetPath.dirname(execPath);
  if (platform === 'darwin')
    return [
      targetPath.join(
        runtime,
        '..',
        'Frameworks',
        'Electron Framework.framework',
        'Resources',
        'LICENSES.chromium.html',
      ),
      targetPath.join(
        runtime,
        '..',
        'Frameworks',
        'Electron Framework.framework',
        'Versions',
        'A',
        'Resources',
        'LICENSES.chromium.html',
      ),
      targetPath.join(resourcesPath, 'LICENSES.chromium.html'),
    ];
  return [
    targetPath.join(runtime, 'LICENSES.chromium.html'),
    targetPath.join(resourcesPath, 'LICENSES.chromium.html'),
  ];
}

module.exports = {
  CHROMIUM_NOTICE_URL,
  COMPONENTS,
  escapeHtml,
  createLicenseHtml,
  licenseFiles,
  chromiumLicenseCandidates,
  renderComponentInventory,
  renderLegalMarkdown,
};
