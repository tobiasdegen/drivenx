'use strict';
const { sortFindings } = require('../diagnostics/finding-order.js');
const {
  visibleDiagnosisStatus,
  visibleDiagnosisFindings,
} = require('../../shared/diagnosis-model.mjs');
const { recommendationPlan } = require('../../shared/recommendation-rules.mjs');
const { formatNvmeDataUnits, formatAtaBytes } = require('../../shared/diagnostic-metrics.mjs');
const { overviewMetrics } = require('../../shared/overview-metrics.mjs');
const { translateTest } = require('../diagnostics/smart-test-translation.js');
const { ataErrorLog, ataTestLog } = require('../diagnostics/ata-logs.js');
const { testRows, testFailed } = require('../diagnostics/health.js');
const { ataDefectEvidence } = require('../diagnostics/ata-raw.js');
const escape = (s) =>
  String(s ?? '–').replace(
    /[&<>"']/g,
    (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x],
  );
const deLocale = require('../../locales/de-DE.json');
const enLocale = require('../../locales/en-US.json');
const messages = { 'de-DE': deLocale.report, 'en-US': enLocale.report };
const notes = { 'de-DE': deLocale.findings, 'en-US': enLocale.findings };
function findingText(f, locale = 'de-DE') {
  let result = (notes[locale] || notes['de-DE'])[f.code] || f.code || f.message || '';
  for (const [k, v] of Object.entries(f.values || {}))
    result = result.replaceAll(
      `{${k}}`,
      Number.isFinite(v) ? Number(v).toLocaleString(locale) : String(v),
    );
  return result.replace(
    /\{[a-zA-Z][a-zA-Z0-9]*\}/g,
    (messages[locale] || messages['de-DE']).unknownPlaceholder,
  );
}
function recommendation(health, locale = 'de-DE') {
  const t = (locale === 'en-US' ? enLocale : deLocale).recommendations;
  return recommendationPlan(health)
    .reportCodes.map((code) => t[code])
    .filter(Boolean);
}
function generateHTML(detail, locale = 'de-DE', prefs = {}) {
  const t = messages[locale] || messages['de-DE'],
    de = locale === 'de-DE';
  const r = detail.raw || {},
    metrics = detail.metrics ?? overviewMetrics(r),
    health = detail.health || {},
    device = detail.device || {},
    os = device.osMetadata || {};
  // Backend is authoritative. Do not reclassify SMART health in a report.
  const displayedStatus = visibleDiagnosisStatus(health);
  const status = (de ? deLocale : enLocale).diagnosis[displayedStatus] || t.unbekannt;
  const date = detail.capturedAt ? new Date(detail.capturedAt) : new Date();
  const time = Number.isNaN(date.getTime()) ? t.missing : date.toLocaleString(locale);
  const fmt = (n) => n.toLocaleString(locale);
  const capacity = r.user_capacity?.bytes ?? device.capacityBytes;
  const fields = [];
  const hardware = [];
  const diagnostic = [];
  const add = (array, key, val) => {
    if (val === undefined || val === null || val === '') return;
    array.push(`<tr><th scope="row">${escape(key)}</th><td>${escape(val)}</td></tr>`);
  };
  add(fields, t.model, r.model_name || device.name);
  add(fields, t.serial, r.serial_number);
  add(fields, t.firmware, r.firmware_version);
  add(
    fields,
    t.capacity,
    typeof capacity === 'number' && capacity > 0
      ? `${fmt(Number((capacity / 1e9).toFixed(2)))} GB`
      : undefined,
  );
  add(hardware, t.connection, device.transport || device.connection?.transport || os.busType);
  add(hardware, t.textDiagnosticProtocol, r.device?.protocol);
  add(hardware, t.devicePath, device.name);
  add(hardware, t.logicalBlock, os.logicalBlockSize ? `${os.logicalBlockSize} Byte` : undefined);
  add(hardware, t.physicalBlock, os.physicalBlockSize ? `${os.physicalBlockSize} Byte` : undefined);
  add(
    hardware,
    t.location,
    device.internal == null ? undefined : device.internal ? t.internal : t.external,
  );
  add(hardware, t.removable, os.removable == null ? undefined : os.removable ? t.yes : t.no);
  add(hardware, t.ejectable, os.ejectable == null ? undefined : os.ejectable ? t.yes : t.no);
  add(
    diagnostic,
    t.smart,
    r.smart_status?.passed == null ? t.missing : r.smart_status.passed ? t.passed : t.failed,
  );
  add(
    diagnostic,
    t.hours,
    metrics.powerOnHours !== null ? `${fmt(metrics.powerOnHours)} h` : undefined,
  );
  const powerCycles = metrics.powerCycles;
  add(
    diagnostic,
    t.textPowerCycles,
    Number.isSafeInteger(powerCycles) && powerCycles >= 0 ? fmt(powerCycles) : undefined,
  );
  add(
    diagnostic,
    t.temperature,
    typeof r.temperature?.current === 'number' && r.temperature.current > 0
      ? `${r.temperature.current} °C`
      : undefined,
  );
  // An ATA error counter is not a generic error count for SCSI or NVMe devices.
  if (r.device?.protocol === 'ATA' || r.ata_smart_error_log) {
    add(diagnostic, t.errors, ataErrorLog(r)?.count);
  }
  for (const [id, k] of [
    [5, 'reallocated'],
    [197, 'pending'],
    [198, 'uncorrectable'],
  ]) {
    const attr = r.ata_smart_attributes?.table?.find((a) => a.id === id);
    if (attr) {
      const evidence = ataDefectEvidence(attr);
      // Never present the first component of a packed value as sector count.
      const isCount = evidence.kind === 'count';
      const label = isCount ? t[k] : `${t[k]} (${t.textVendorRawValue})`;
      add(
        diagnostic,
        label,
        isCount ? evidence.count : (attr.raw?.string ?? attr.raw?.value ?? '–'),
      );
    }
  }
  const table = (rows) => `<table>${rows.join('')}</table>`;
  const findings = sortFindings(visibleDiagnosisFindings(health)).filter(
    (f) => f.code !== 'noIssues',
  );
  const findingsHtml = findings.length
    ? findings
        .map(
          (f) =>
            `<li class="finding ${f.level === 'kritisch' ? 'critical' : f.level === 'warnung' ? 'warning' : 'note'}"><span class="marker"></span><span>${escape(findingText(f, locale))}</span></li>`,
        )
        .join('')
    : `<li class="finding ${displayedStatus === 'ok' ? 'good' : 'note'}"><span class="marker"></span><span>${escape(findingText({ code: displayedStatus === 'ok' ? 'noIssues' : 'noData' }, locale))}</span></li>`;
  const actions = recommendation(health, locale)
    .map((x) => `<li>${escape(x)}</li>`)
    .join('');
  const tests = testRows(r)
    .slice(0, 12)
    .map(
      (x) =>
        `<tr><td>${escape(translateTest(x.type, locale, 'type'))}</td><td>${escape(translateTest(x.status, locale))}</td><td>${escape(x.lifetime_hours ?? x.power_on_hours)}</td></tr>`,
    )
    .join('');
  const readout = health.readout?.status;
  const noSmart = r.smart_support?.available === false;
  const readoutLabel = noSmart
    ? t.textDeviceReportsNoSmartSupport
    : readout === 'eingeschraenkt'
      ? t.textPartiallyLimited
      : readout === 'fehlgeschlagen'
        ? t.textFailed
        : t.textAvailableDataEvaluated;
  const state = ['critical', 'defective'].includes(displayedStatus)
    ? 'critical'
    : ['warning', 'observe'].includes(displayedStatus)
      ? 'warning'
      : displayedStatus === 'ok'
        ? 'good'
        : 'unknown';
  {
    const d = (de ? deLocale : enLocale).diagnosis;
    const domains = health.diagnosis.domains;
    add(diagnostic, d.media, d[domains.media || 'unassessable']);
    if (domains.connection) add(diagnostic, d.connection, d[domains.connection]);
    if (domains.thermal) add(diagnostic, d.thermal, d[domains.thermal]);
    if (health.diagnosis.assessment !== 'complete') add(diagnostic, t.textSmartReadout, d.partial);
    add(diagnostic, d.source, health.diagnosis.algorithmVersion);
  }
  const nv = r.nvme_smart_health_information_log;
  const technical = [];
  if (r.smart_support?.available === false) {
    add(technical, t.textSmartSupport, t.textNoReportedByDevice);
  }
  if (nv) {
    add(technical, t.textNvmeMediaErrors, nv.media_errors);
    add(technical, t.textNvmeErrorLogEntries, nv.num_err_log_entries);
    add(technical, t.textUnsafeShutdowns, nv.unsafe_shutdowns);
    add(
      technical,
      t.textPercentageUsed,
      metrics.wearPercent === null ? undefined : `${metrics.wearPercent} %`,
    );
    add(
      technical,
      t.textAvailableSpare,
      nv.available_spare == null ? undefined : `${nv.available_spare} %`,
    );
    add(technical, t.textDataReadNvme, formatNvmeDataUnits(metrics.readUnits, locale, true));
    add(technical, t.textDataWrittenNvme, formatNvmeDataUnits(metrics.writtenUnits, locale, true));
    add(
      technical,
      t.textNvmeCriticalWarningBits,
      Number.isSafeInteger(nv.critical_warning) ? nv.critical_warning : undefined,
    );
  }
  // Match ATA SSD interpretation in overview and history. Only known models
  // may derive wear from vendor-specific normalized attributes.
  if (r.rotation_rate === 0 && (r.device?.protocol === 'ATA' || r.ata_smart_attributes)) {
    if (metrics.wearPercent !== null)
      add(
        technical,
        metrics.ataWearSource === 'samsung-860-normalized-177' ? t.ataSsdWearDerived : t.ataSsdWear,
        `${metrics.wearPercent} %`,
      );
    if (metrics.ataWrittenBytes !== null)
      add(technical, t.ataWritten, formatAtaBytes(metrics.ataWrittenBytes, locale));
  }
  // Keep manufacturer-specific ATA interpretation out of the health grade.
  // These are historical context only, not evidence of a current defect.
  if (r.device?.protocol === 'ATA' || r.ata_smart_attributes) {
    const loadCycles = r.ata_smart_attributes?.table?.find((a) => a.id === 193);
    const loadEvidence = ataDefectEvidence(loadCycles);
    if (loadEvidence.kind === 'count')
      add(technical, t.textLoadUnloadCyclesHistoric, fmt(loadEvidence.count));
    const sct = r.ata_sct_status?.temperature;
    if (Number.isFinite(sct?.lifetime_max))
      add(technical, t.textLifetimeMaximumTemperature, `${sct.lifetime_max} °C`);
    if (Number.isFinite(sct?.op_limit_max))
      add(technical, t.textReportedTemperatureOperatingLimit, `${sct.op_limit_max} °C`);
  }
  const brandName = String(prefs.companyName || '')
    .slice(0, 150)
    .trim();
  const brandAddress = String(prefs.companyAddress || '')
    .slice(0, 700)
    .trim();
  const brandContact = String(prefs.companyContact || '')
    .slice(0, 250)
    .trim();
  const logo =
    typeof prefs.companyLogo === 'string' &&
    prefs.companyLogo.length <= 1500000 &&
    /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(prefs.companyLogo)
      ? prefs.companyLogo
      : '';
  const brandHtml = `<div class="branding">${logo ? `<img class="company-logo" src="${logo}" alt="">` : ''}<div>${brandName ? `<div class="company-name">${escape(brandName)}</div>` : ''}${brandAddress ? `<div class="company-meta">${escape(brandAddress).replace(/\r?\n/g, '<br>')}</div>` : ''}${brandContact ? `<div class="company-meta">${escape(brandContact)}</div>` : ''}</div></div>`;
  // One balanced report: only actionable raw indicators, never the entire vendor table.
  const priorityIds = new Set([5, 187, 188, 196, 197, 198, 199]);
  const selectedAttrs = (r.ata_smart_attributes?.table || []).filter((a) => priorityIds.has(a.id));
  const attrRows = selectedAttrs
    .map(
      (a) =>
        `<tr><td class="num">${escape(a.id)}</td><td>${escape(a.name)}</td><td class="num">${escape(a.value ?? '–')}</td><td class="raw">${escape(a.raw?.string ?? a.raw?.value ?? '–')}</td></tr>`,
    )
    .join('');
  const attrSection = selectedAttrs.length
    ? `<section class="detail-section"><h2>${t.textRelevantSmartAttributes}</h2><p class="muted small">${t.textSelectedDiagnosticValuesRawValuesMay}</p><table class="detail-table attr-table"><colgroup><col style="width:8%"><col style="width:42%"><col style="width:12%"><col style="width:38%"></colgroup><thead><tr><th>ID</th><th>${t.textAttribute}</th><th>${t.textCurrent}</th><th>${t.textRawValue}</th></tr></thead><tbody>${attrRows}</tbody></table></section>`
    : '';
  const nvRows = (r.nvme_error_information_log?.table || [])
    .slice(0, 3)
    .map(
      (a) =>
        `<tr><td class="num">${escape(a.error_count)}</td><td>${escape(a.status_field?.string || '–')}</td></tr>`,
    )
    .join('');
  const ataRows = (ataErrorLog(r)?.table || [])
    .slice(0, 3)
    .map(
      (a) =>
        `<tr><td class="num">${escape(a.error_number)}</td><td class="num">${escape(a.lifetime_hours)}</td><td>${escape(a.error_description)}</td></tr>`,
    )
    .join('');
  const logRows = nvRows || ataRows;
  const logSection = logRows
    ? `<section class="detail-section"><h2>${t.textErrorLogRecentEntries}</h2><p class="muted small">${t.textExtractOfAvailableEntriesNotThe}</p><table class="detail-table"><thead><tr><th style="width:15%">#</th>${nvRows ? '' : `<th style="width:18%">${t.textHours}</th>`}<th>${t.textDescription}</th></tr></thead><tbody>${logRows}</tbody></table></section>`
    : '';
  const diagnosticsSection = attrSection + logSection;
  const css = `@page{size:A4;margin:16mm 17mm 18mm}*{box-sizing:border-box}html{print-color-adjust:exact;-webkit-print-color-adjust:exact}body{font:10.5px -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#223047;line-height:1.48;margin:0}.branding{display:flex;gap:18px;align-items:center;margin-bottom:26px;min-height:54px}.company-logo{max-height:60px;max-width:150px;object-fit:contain}.company-name{font-size:13px;font-weight:750}.company-meta{font-size:9px;color:#64748b;line-height:1.45}header{display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:17px;border-bottom:2px solid #243c60;margin-bottom:29px;gap:18px}.brand{font-weight:800;font-size:10px;letter-spacing:.05em;color:#446080;text-transform:uppercase}.title{font-size:22px;font-weight:750;margin:6px 0 4px;line-height:1.2}.muted{color:#64748b}.stamp{text-align:right;white-space:nowrap;padding-bottom:4px}.eyebrow{font-size:9px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#64748b}.hero{border:1px solid #dde5ee;border-left:5px solid #728197;padding:12px 15px;border-radius:4px;margin-bottom:19px;break-inside:avoid}.hero.good{border-left-color:#17836d;background:#f3faf7}.hero.warning{border-left-color:#bf842c;background:#fffaf0}.hero.critical{border-left-color:#b92f45;background:#fff5f5}.hero.unknown{background:#f6f8fb}.hero-title{font-size:19px;font-weight:750;margin:3px 0 2px}.readout{font-size:10px;color:#52647b}h2{font-size:12px;color:#203753;margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid #d8e1ed;break-after:avoid;page-break-after:avoid}section{margin:0 0 16px;break-inside:auto}.split{display:grid;grid-template-columns:1fr 1fr;gap:20px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{font-size:9.4px;text-align:left;vertical-align:top;padding:6px 7px;border-bottom:1px solid #e9edf3;overflow-wrap:break-word;word-break:normal}th{font-weight:600;color:#62718a;width:43%}td{color:#223047}.findings{list-style:none;padding:0;margin:0}.finding{display:flex;gap:9px;align-items:baseline;padding:7px 9px;border-bottom:1px solid #edf1f5}.marker{display:block;flex:0 0 7px;width:7px;height:7px;border-radius:50%;background:#64748b}.finding.good .marker{background:#17836d}.finding.warning .marker{background:#bf842c}.finding.critical .marker{background:#b92f45}.actions{padding-left:20px;margin:5px 0}.actions li{margin:6px 0}.test th{width:auto}.test{break-inside:avoid;page-break-inside:avoid}.fineprint{border-top:1px solid #dbe3ec;padding-top:9px;margin-top:20px;font-size:9px;color:#65758a}.technical{margin-top:20px}.detail-section{margin-top:13px}.detail-table th{background:#f2f6fa;width:auto;font-size:9px}.detail-table td{font-size:9px}.detail-table .num{white-space:nowrap;font-variant-numeric:tabular-nums}.detail-table .raw{font:8.2px ui-monospace,Menlo,Consolas,monospace;white-space:normal;overflow-wrap:anywhere}.small{font-size:9px;margin:0 0 8px}.attr-table td:nth-child(2){overflow-wrap:anywhere}@media print{tr,.finding,.hero{break-inside:avoid}section:has(>.test){break-inside:avoid;page-break-inside:avoid}thead{display:table-header-group}tfoot{display:table-footer-group}.detail-section{break-inside:auto}}`;

  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escape(t.title)}</title><style>${css}</style></head><body><header><div>${brandHtml}<div class="brand">DriveNX</div><h1 class="title">${escape(t.title)}</h1><div class="muted">${escape(t.textDiagnosticReport)}</div></div><div class="stamp"><div class="eyebrow">${escape(t.textCreated)}</div><div>${escape(time)}</div></div></header><div class="hero ${state}"><div class="eyebrow">${escape(t.assessment)}</div><div class="hero-title">${escape(status)}</div><div class="readout">${escape(t.textSmartReadout)}: ${escape(readoutLabel)}</div></div><section><h2>${escape(t.findings)}</h2><ul class="findings">${findingsHtml}</ul></section><section><h2>${escape(t.recommend)}</h2><ul class="actions">${actions}</ul></section><div class="split"><section><h2>${escape(t.details)}</h2>${table(fields)}</section><section><h2>${escape(t.hardware)}</h2>${hardware.length ? table(hardware) : `<p class="muted">${escape(t.missing)}</p>`}</section></div><section class="technical"><h2>${escape(t.textKeySmartIndicators)}</h2>${diagnostic.length || technical.length ? table([...diagnostic, ...technical]) : `<p class="muted">${escape(t.missing)}</p>`}</section>${tests ? `<section><h2>${escape(t.tests)}</h2><table class="test"><thead><tr><th>${escape(t.testType)}</th><th>${escape(t.result)}</th><th>${escape(t.hours)}</th></tr></thead><tbody>${tests}</tbody></table></section>` : ''}${diagnosticsSection}<footer class="fineprint">${escape(t.notice)} ${escape(t.textReportBasedOnSmartAndOperating)}</footer></body></html>`;
}
module.exports = { generateHTML, findingText };
