'use strict';
const de = require('../../locales/de-DE.json');
const en = require('../../locales/en-US.json');
function translateTest(value, locale = 'de-DE', field = 'status') {
  const raw = typeof value === 'string' ? value : value?.string;
  if (!raw) return '–';
  const text = raw.toLowerCase();
  let key;
  if (field === 'type') {
    if (/extended|long/.test(text)) key = 'extended';
    else if (/short/.test(text)) key = 'short';
    else if (/conveyance/.test(text)) key = 'conveyance';
    else if (/selective/.test(text)) key = 'selective';
    return key ? (locale === 'en-US' ? en : de).smartTest.types[key] : raw;
  }
  if (/read failure|read test element/.test(text)) key = 'readFailure';
  else if (/completed without error|completed successfully/.test(text)) key = 'completed';
  else if (/aborted/.test(text)) key = 'aborted';
  else if (/interrupted/.test(text)) key = 'interrupted';
  else if (/in progress/.test(text)) key = 'inProgress';
  return key ? (locale === 'en-US' ? en : de).smartTest.statuses[key] : raw;
}
module.exports = { translateTest };
