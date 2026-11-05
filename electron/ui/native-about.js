// @ts-check
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { getCatalogSection } = require('./translator.js');
const { escapeHtml } = require('./license-viewer.js');

/** @param {{app: {getVersion:() => string; setAboutPanelOptions:(options:object) => void; showAboutPanel:() => void}, locale:string, platform:string, root:string, resourcesPath:string, packaged:boolean}} args */
function showNativeAbout({ app, locale, platform, root, resourcesPath, packaged }) {
  const options = {
    applicationName: 'DriveNX',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Tobias Degen',
    credits: getCatalogSection(locale, 'about').credits,
    ...(platform === 'darwin'
      ? {}
      : {
          iconPath: packaged
            ? path.join(resourcesPath, 'icon.png')
            : path.join(root, 'build', 'icon.png'),
        }),
    ...(platform === 'linux' ? { authors: ['Tobias Degen'] } : {}),
  };
  app.setAboutPanelOptions(options);
  app.showAboutPanel();
}
/** Centered macOS About window; static HTML without external resources or scripting. */
/** @param {{ locale: string; version: string; iconPath: string }} args */
function createAboutHtml({ locale, version, iconPath }) {
  const image = fs.readFileSync(iconPath).toString('base64');
  const credits = getCatalogSection(locale, 'about').credits.split(/\r?\n/).filter(Boolean);
  const openSource = credits[0] || '';
  const legalNotice = credits.slice(1).join(' ');
  return `<!doctype html><html lang="${locale === 'en-US' ? 'en' : 'de'}"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"/>
<title>DriveNX</title><style>
*{box-sizing:border-box}html{color-scheme:dark light;background:#141922;color:#eff3fa;font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
body{margin:0;min-height:100vh;display:flex;justify-content:center;align-items:center;padding:30px 24px}
.about{text-align:center;width:100%;max-width:340px;margin:auto}img{display:block;width:88px;height:88px;object-fit:contain;margin:0 auto 14px}
h1{font-size:25px;letter-spacing:-.7px;line-height:1.2;margin:0 0 7px;font-weight:750}.version{font-size:13px;color:#acb8ce;margin:0 0 27px}
.separator{height:1px;max-width:260px;margin:0 auto 22px;background:#303b4c}
p{margin:0}.license{font-weight:600;margin-bottom:8px}.notice{color:#acb8ce;font-size:12px;line-height:1.55;max-width:305px;margin:0 auto 23px}
.copyright{font-size:12px;color:#9dabc0}
@media(prefers-color-scheme:light){html{background:#f9fafc;color:#1b2839}.version,.notice,.copyright{color:#586a82}.separator{background:#d6dfe9}}
</style></head><body><main class="about">
<img src="data:image/png;base64,${image}" alt=""/><h1>DriveNX</h1>
<p class="version">Version ${escapeHtml(version)}</p>
<div class="separator"></div><p class="license">${escapeHtml(openSource)}</p>
<p class="notice">${escapeHtml(legalNotice)}</p>
<p class="copyright">© 2026 Tobias Degen</p>
</main></body></html>`;
}
module.exports = { showNativeAbout, createAboutHtml };
