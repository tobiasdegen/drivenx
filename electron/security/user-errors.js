'use strict';
const { getCatalogSection } = require('../ui/translator.js');

/** Stable error codes cross IPC; lower layers don't know the UI language. */
const GERMAN = getCatalogSection('de-DE', 'backendErrors');

function backendError(key) {
  if (!Object.hasOwn(GERMAN, key)) throw new TypeError(`Unknown backend error: ${key}`);
  const error = new Error(GERMAN[key]);
  error.userMessageKey = key;
  return error;
}

function userErrorMessage(error, locale = 'de-DE') {
  if (error?.userMessageKey && Object.hasOwn(GERMAN, error.userMessageKey)) {
    return getCatalogSection(locale, 'backendErrors')[error.userMessageKey];
  }
  if (error?.macIntegrityKey) {
    const messages = getCatalogSection(locale, 'macIntegrity');
    const template = messages[error.macIntegrityKey];
    if (typeof template === 'string')
      return template.replace(/\{(\w+)\}/g, (_match, name) =>
        String(error.macIntegrityValues?.[name] ?? '–'),
      );
  }
  if (error?.smartFailureKey) {
    const messages = getCatalogSection(locale, 'smartFailures');
    if (Object.hasOwn(messages, error.smartFailureKey)) return messages[error.smartFailureKey];
  }
  return error instanceof Error ? error.message : String(error);
}

module.exports = { backendError, userErrorMessage };
