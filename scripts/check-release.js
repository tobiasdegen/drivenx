'use strict';
const path = require('node:path');
const { inspectRelease } = require('./release-check.js');
const root = path.resolve(__dirname, '..');
try {
  const result = inspectRelease({ root });
  console.log(`DriveNX ${result.targets.join(' / ')} Release-Vorprüfung`);
  for (const warning of result.warnings) console.warn('HINWEIS: ' + warning);
  for (const problem of result.problems) console.error('FEHLER: ' + problem);
  if (result.problems.length) process.exitCode = 1;
  else
    console.log(
      'Statische Vorprüfung bestanden. Echte Builds und Plattformtests sind weiterhin erforderlich.',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
