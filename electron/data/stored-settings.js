'use strict';

const { validatedLogo } = require('../ipc/ipc-validation.js');

function localeForLanguage(language) {
  return typeof language === 'string' && /^de(?:-|$)/i.test(language.trim()) ? 'de-DE' : 'en-US';
}

function defaultSettings(systemLanguage) {
  return {
    backgroundDetails: false,
    autoSaveHistory: false,
    autoBackupHistory: false,
    locale: localeForLanguage(systemLanguage),
    theme: 'dark',
    attributeMode: 'friendly',
    companyName: '',
    companyAddress: '',
    companyContact: '',
    companyLogo: '',
  };
}

function safeLogo(value) {
  try {
    return validatedLogo(value);
  } catch {
    // An invalid optional logo must not prevent opening preferences.
    return '';
  }
}

function text(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

/** Validate persistent settings and ignore unknown or unsafe fields. */
function normalizeStoredSettings(value, systemLanguage) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return defaultSettings(systemLanguage);
  return {
    backgroundDetails: value.backgroundDetails === true,
    autoSaveHistory: value.autoSaveHistory === true,
    autoBackupHistory: value.autoBackupHistory === true,
    locale:
      value.locale === 'de-DE' || value.locale === 'en-US'
        ? value.locale
        : localeForLanguage(systemLanguage),
    theme: ['light', 'dark', 'system'].includes(value.theme) ? value.theme : 'dark',
    attributeMode: value.attributeMode === 'technical' ? 'technical' : 'friendly',
    companyName: text(value.companyName, 150),
    companyAddress: text(value.companyAddress, 700),
    companyContact: text(value.companyContact, 250),
    companyLogo: safeLogo(value.companyLogo),
  };
}

module.exports = { defaultSettings, normalizeStoredSettings, localeForLanguage };
