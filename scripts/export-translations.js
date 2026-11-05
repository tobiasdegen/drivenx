'use strict';
// Exports an English reference catalog that translators can open in Excel.
const fs = require('node:fs');
const path = require('node:path');
const en = require('../locales/en-US.json');
function flatten(value, prefix = '') {
  return Object.entries(value).flatMap(([key, entry]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return entry && typeof entry === 'object' && !Array.isArray(entry)
      ? flatten(entry, name)
      : [{ key: name, english: String(entry) }];
  });
}
function csv(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}
const descriptions = {
  backendErrors:
    'Backend-Fehlermeldungen; Bedeutung und Sicherheitsregeln erhalten / backend error messages',
  dialogs: 'System- und Dateidialoge / system and file dialogs',
  ui: 'Text in der Benutzeroberfläche / UI',
  findings: 'Diagnosebefund; fachliche Aussage und Schweregrad nicht verändern / finding',
  recommendations: 'Empfehlung für Endkunden / recommendation',
  smartTest: 'SMART-Testtyp oder Ergebnis; technische Bedeutung erhalten / SMART tests',
  report: 'PDF-Diagnosebericht / report',
  deviceDetails: 'Hardware- und Geräteinformationen / device details',
  preferences: 'Einstellungen / preferences',
  smartView: 'SMART-Werte und Verlauf / SMART view',
  attributeGlossary:
    'SMART-Attribut: label = Anzeigename, description = Bedeutung, interpretation = Bewertungshinweis. Kein gerätespezifisches Wissen erfinden / SMART glossary',
};
function exportTranslations(output = path.join(__dirname, '..', 'translations-template.csv')) {
  const rows = flatten(en);
  const table = [
    ['Key', 'English source', 'Context / translator guidance', 'Placeholders', 'Translation'],
    ...rows.map(({ key, english }) => [
      key,
      english,
      descriptions[key.split('.')[0]] || 'DriveNX',
      [...new Set(english.match(/\{[a-zA-Z][a-zA-Z0-9]*\}/g) || [])].join(' '),
      '',
    ]),
  ];
  fs.writeFileSync(
    output,
    '\ufeff' + table.map((row) => row.map(csv).join(',')).join('\r\n') + '\r\n',
    'utf8',
  );
  return { count: rows.length, output };
}
if (require.main === module) {
  const { count, output } = exportTranslations(process.argv[2]);
  console.log(`Exported ${count} English source strings to ${output}`);
}
module.exports = { flatten, exportTranslations };
