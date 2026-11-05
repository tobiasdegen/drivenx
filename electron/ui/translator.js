'use strict';
const de = require('../../locales/de-DE.json');
const en = require('../../locales/en-US.json');
function getCatalogSection(locale, section) {
  const catalog = locale === 'en-US' ? en : de;
  const values = catalog[section];
  if (!values || typeof values !== 'object')
    throw new Error(`Unbekannte Übersetzungskategorie: ${section}`);
  return values;
}
module.exports = { getCatalogSection };
