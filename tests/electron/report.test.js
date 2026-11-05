const { visibleDiagnosisStatus } = require('../../shared/diagnosis-model.mjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../../electron/diagnostics/health.js');
const { generateHTML } = require('../../electron/reports/report.js');

const fixture = require('../../fixtures/fujitsu-sample.json');
for (const lang of ['de-DE', 'en-US'])
  test('report contains findings but no raw JSON in ' + lang, () => {
    const html = generateHTML(
      {
        raw: fixture,
        health: evaluate(fixture),
        device: { name: '/dev/disk4' },
        capturedAt: '2026-10-17T13:36:43Z',
      },
      lang,
    );
    assert.match(html, /9080|9.080/);
    assert.match(html, /SMART/);
    assert.doesNotMatch(html, /'ata_smart_attributes'/);
    assert.doesNotMatch(html, /8529805967379/);
  });

test('report uses operating system capacity and hardware metadata when SMART capacity is unavailable', () => {
  const html = generateHTML(
    {
      raw: { model_name: 'APPLE SSD AP0512Z', smart_status: { passed: true } },
      health: evaluate({}),
      device: {
        name: '/dev/disk0',
        capacityBytes: 500277792768,
        transport: 'Apple Fabric',
        internal: true,
        osMetadata: { source: 'diskutil', logicalBlockSize: 4096, removable: false },
      },
      capturedAt: '2026-10-17T19:36:04Z',
    },
    'de-DE',
  );
  assert.match(html, /500,28 GB/);
  assert.match(html, /Hardware und Anschluss/);
  assert.match(html, /Apple Fabric/);
  assert.match(html, /4096 Byte/);
  assert.doesNotMatch(html, /<span class="source">/);
});

test('report includes actionable recommendations and readout notice for critical incomplete diagnostics', () => {
  const html = generateHTML(
    {
      raw: {
        model_name: 'TEST DEVICE',
        smart_status: { passed: false },
        device: { protocol: 'ATA' },
        ata_smart_attributes: { table: [{ id: 9, raw: { string: '1' } }] },
      },
      health: evaluate({
        smart_status: { passed: false },
        device: { protocol: 'ATA' },
        ata_smart_attributes: { table: [{ id: 9, raw: { string: '1' } }] },
      }),
      device: { name: '/dev/disk3' },
      capturedAt: '2026-10-17T12:00:00Z',
    },
    'de-DE',
  );
  assert.match(html, /Wichtige Daten umgehend sichern/);
  assert.match(html, /SMART-Auslesung: Teilweise eingeschränkt/);
  assert.match(html, /SMART-Gesamtstatus meldet Fehler/);
  assert.match(html, /hero critical/);
});
test('report remains escaped for untrusted identifiers', () => {
  const html = generateHTML(
    {
      raw: { model_name: '<script>alert(1)</script>', serial_number: 'A&B' },
      health: evaluate({}),
      device: { name: '/dev/disk0' },
      capturedAt: '2026-10-17T12:00:00Z',
    },
    'de-DE',
  );
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /A&amp;B/);
});

test('report does not show source abbreviations or unresolved variables', () => {
  const health = evaluate({ model_name: 'TEST', smart_status: { passed: true } });
  const html = generateHTML(
    {
      raw: { model_name: 'TEST', smart_status: { passed: true } },
      health,
      device: {
        name: '/dev/disk0',
        transport: 'USB',
        osMetadata: { source: 'diskutil', logicalBlockSize: 512 },
      },
    },
    'de-DE',
  );
  // An unavailable media assessment must never be shown as healthy.
  assert.match(html, /hero unknown/);
  assert.doesNotMatch(html, /hero critical/);
  assert.doesNotMatch(html, /\{count\}/);
  assert.doesNotMatch(html, /<span class="source">/);
  assert.doesNotMatch(html, />diskutil<|>SMART<\/span>/);
});

test('one structured diagnosis report and balanced tables', () => {
  const input = {
    raw: {
      model_name: 'Drive',
      ata_smart_attributes: {
        table: [
          {
            id: 5,
            name: 'Reallocated_Sector_Ct',
            value: 100,
            thresh: 10,
            raw: { string: '19 (1986 14)' },
          },
          { id: 1, name: 'Raw_Read_Error_Rate', raw: { string: '999' } },
        ],
      },
      ata_smart_error_log: {
        summary: {
          table: [{ error_number: 2, lifetime_hours: 77, error_description: 'Read failure' }],
        },
      },
    },
    device: { name: '/dev/disk0' },
    health: evaluate({}),
  };
  const branding = { companyName: 'A & B <IT>', companyLogo: 'data:image/png;base64,iVBORw0KGgo=' };
  const customer = generateHTML(input, 'de-DE', branding);
  assert.match(customer, /Diagnosebericht/);
  assert.match(customer, /company-logo/);
  assert.match(customer, /A &amp; B &lt;IT&gt;/);
  assert.match(customer, /Relevante SMART-Attribute/);
  assert.match(customer, /Fehlerprotokoll – letzte Einträge/);
  assert.match(customer, /19 \(1986 14\)/);
  assert.doesNotMatch(customer, /Raw_Read_Error_Rate|999|Technischer Anhang/);
  assert.match(customer, /table-layout:fixed/);
  assert.match(customer, /\.branding\{[^}]*margin-bottom:(?:2[4-9]|[3-9][0-9])px/);
});

test('unknown SMART readout is not reported as healthy in PDF', () => {
  const raw = {
    model_name: 'USB Flash',
    device: { protocol: 'SCSI' },
    smart_support: { available: false },
  };
  const html = generateHTML(
    { raw, health: evaluate(raw, 4), device: { name: '/dev/sdb', transport: 'USB' } },
    'de-DE',
  );
  assert.match(html, /Keine ausreichenden Diagnosewerte für eine Zustandsbewertung vorhanden/);
  assert.doesNotMatch(html, /Bei den geprüften Indikatoren keine Auffälligkeiten/);
});

test('PDF distinguishes unsupported SMART from healthy status without invented values', () => {
  const raw = {
    model_name: 'USB SanDisk',
    device: { protocol: 'SCSI' },
    smart_support: { available: false },
    temperature: { current: 0 },
  };
  const html = generateHTML(
    { raw, health: evaluate(raw, 4), device: { name: '/dev/sdb', transport: 'USB' } },
    'de-DE',
  );
  assert.match(html, /hero unknown/);
  assert.match(html, /SMART-Unterstützung<\/th><td>Nein \(laut Gerät\)/);
  assert.doesNotMatch(html, /0 °C/);
  assert.doesNotMatch(html, /ATA-Fehlerprotokoll<\/th>/);
});

test('PDF includes NVMe unsafe shutdowns only when supplied', () => {
  const raw = {
    device: { protocol: 'NVMe' },
    nvme_smart_health_information_log: {
      unsafe_shutdowns: 26,
      media_errors: 0,
      num_err_log_entries: 0,
    },
  };
  const html = generateHTML({ raw, health: evaluate({}), device: { name: '/dev/sda' } }, 'de-DE');
  assert.match(html, /Unsichere Abschaltungen<\/th><td>26/);
  assert.doesNotMatch(html, /ATA-Fehlerprotokoll<\/th>/);
});

test('PDF labels unsupported SMART, protocol, and manufacturer encoded values accurately', () => {
  const unsupported = {
    device: { protocol: 'SCSI' },
    smart_support: { available: false },
    model_name: 'USB SanDisk',
  };
  const a = generateHTML(
    {
      raw: unsupported,
      health: evaluate(unsupported, 4),
      device: { name: '/dev/sdb', transport: 'USB' },
    },
    'de-DE',
  );
  assert.match(a, /Gerät meldet keine SMART-Unterstützung/);
  assert.match(a, /Diagnoseprotokoll<\/th><td>SCSI/);
  const raw = {
    device: { protocol: 'ATA' },
    ata_smart_attributes: {
      table: [
        {
          id: 5,
          name: 'Reallocated_Sector_Ct',
          value: 100,
          raw: { value: 8529805967379, string: '19 (1986 14)' },
        },
      ],
    },
  };
  const b = generateHTML({ raw, health: evaluate(raw), device: { name: '/dev/sdc' } }, 'de-DE');
  assert.match(b, /SMART 5 – Herstellerrohwert/);
  assert.match(b, /19 \(1986 14\)/);
  assert.doesNotMatch(b, /Wiederzugewiesene Sektoren \(angezeigter Wert\)/);
});

test('PDF never labels vendor-packed pending sectors as a plain numeric count', () => {
  const raw = {
    device: { protocol: 'ATA' },
    ata_smart_attributes: {
      table: [
        {
          id: 197,
          name: 'Current_Pending_Sector',
          raw: { string: '19 (1986 14)', value: 8529805967379 },
        },
        { id: 5, name: 'Reallocated_Sector_Ct', raw: { string: '3', value: 3 } },
        { id: 198, name: 'Offline_Uncorrectable', raw: { value: 15 } },
      ],
    },
  };
  for (const lang of ['de-DE', 'en-US']) {
    const html = generateHTML({ raw, health: evaluate(raw), device: { name: '/dev/sdc' } }, lang);
    assert.match(
      html,
      lang === 'de-DE' ? /Ausstehende Sektoren \(Herstellerrohwert\)/ : /vendor raw value/,
    );
    assert.match(html, /19 \(1986 14\)/);
    assert.doesNotMatch(html, /Sektoren<\/th><td>19<\/td>/);
    assert.match(html, lang === 'de-DE' ? /SMART 5 – Herstellerrohwert/ : /Reallocated sectors/);
  }
});

test('PDF includes important NVMe measurements without exporting opaque controller metadata', () => {
  const raw = {
    model_name: 'APPLE SSD TEST',
    device: { protocol: 'NVMe' },
    power_cycle_count: 496,
    smart_status: { passed: true },
    power_on_time: { hours: 750 },
    nvme_smart_health_information_log: {
      critical_warning: 0,
      temperature: 25,
      available_spare: 100,
      percentage_used: 1,
      data_units_read: 111128722,
      data_units_written: 45814574,
      media_errors: 0,
      num_err_log_entries: 0,
      unsafe_shutdowns: 19,
    },
    nvme_number_of_namespaces: 3,
  };
  const html = generateHTML(
    {
      raw,
      health: evaluate(raw, 4),
      device: {
        name: '/dev/disk0',
        capacityBytes: 500277792768,
      },
    },
    'de-DE',
  );
  assert.match(html, /Daten gelesen \(NVMe\)<\/th><td>56,90 TB/);
  assert.match(html, /Daten geschrieben \(NVMe\)<\/th><td>23,46 TB/);
  assert.match(html, /Einschaltvorgänge<\/th><td>496/);
  assert.match(html, /NVMe-Warnbits \(Bitmaske\)<\/th><td>0/);
  assert.match(html, /Teilweise eingeschränkt/);
  assert.doesNotMatch(html, /nvme_number_of_namespaces|raw JSON/i);
});

test('PDF reports historic ATA wear and temperature context without escalating status', () => {
  const raw = {
    model_name: 'Hitachi Test HDD',
    device: { protocol: 'ATA' },
    power_cycle_count: 1477,
    power_on_time: { hours: 9967 },
    temperature: { current: 24 },
    smart_status: { passed: true },
    ata_smart_attributes: {
      table: [
        { id: 5, name: 'Reallocated_Sector_Ct', raw: { value: 0, string: '0' } },
        { id: 193, name: 'Load_Cycle_Count', raw: { value: 312217, string: '312217' } },
        { id: 196, name: 'Reallocated_Event_Count', raw: { value: 1, string: '1' } },
        { id: 197, name: 'Current_Pending_Sector', raw: { value: 0, string: '0' } },
        { id: 198, name: 'Offline_Uncorrectable', raw: { value: 0, string: '0' } },
      ],
    },
    ata_smart_error_log: {
      summary: {
        count: 4,
        table: [{ error_number: 4, lifetime_hours: 6, error_description: 'IDNF historical' }],
      },
    },
    ata_sct_status: { temperature: { lifetime_max: 71, op_limit_max: 42 } },
  };
  const health = evaluate(raw, 68);
  assert.equal(visibleDiagnosisStatus(health), 'observe');
  const html = generateHTML({ raw, health, device: { name: '/dev/disk4' } }, 'de-DE');
  assert.match(html, /Einschaltvorgänge<\/th><td>1\.477/);
  assert.match(html, /Kopfparkzyklen \(historisch\)<\/th><td>312\.217/);
  assert.match(html, /Höchste Temperatur \(historisch\)<\/th><td>71 °C/);
  assert.match(html, /Gemeldete Temperatur-Betriebsgrenze<\/th><td>42 °C/);
  assert.match(html, /IDNF historical/);
  assert.match(html, /hero warning/);
  assert.doesNotMatch(html, /hero critical/);
});

test('PDF does not misinterpret packed ATA raw counters or unsafe NVMe unit counts', () => {
  const raw = {
    device: { protocol: 'ATA' },
    ata_smart_attributes: {
      table: [
        { id: 193, name: 'Load_Cycle_Count', raw: { value: 300000, string: '42 (unknown)' } },
      ],
    },
  };
  const ata = generateHTML({ raw, health: evaluate(raw), device: { name: '/dev/disk2' } }, 'de-DE');
  assert.doesNotMatch(ata, /Kopfparkzyklen \(historisch\)/);
  const nvme = generateHTML(
    {
      raw: {
        device: { protocol: 'NVMe' },
        nvme_smart_health_information_log: {
          data_units_read: Number.MAX_SAFE_INTEGER + 1,
          data_units_written: -1,
        },
      },
      health: evaluate({}),
      device: { name: '/dev/disk0' },
    },
    'de-DE',
  );
  assert.doesNotMatch(nvme, /Daten (?:gelesen|geschrieben) \(NVMe\)/);
});
