'use strict';
// Coalesce duplicate reads and prevent completed work from an older scan
// from repopulating the current report cache.
function createDetailCache() {
  const reports = new Map();
  const inFlight = new Map();
  let generation = 0;
  function reset() {
    generation++;
    reports.clear();
    inFlight.clear();
  }
  function invalidate(key) {
    reports.delete(key);
    // The previously started load may still finish, but its result must not be cached.
    inFlight.delete(key);
  }
  function get(key) {
    return reports.get(key);
  }
  function load(key, read) {
    const existing = inFlight.get(key);
    if (existing) return existing;
    // Starting a fresh read revokes the previous snapshot immediately.
    // A failed refresh must never leave an older report exportable or
    // eligible for a history write as if it were still current.
    reports.delete(key);
    const started = generation;
    const job = Promise.resolve()
      .then(read)
      .then((report) => {
        if (generation === started && inFlight.get(key) === job) reports.set(key, report);
        return report;
      })
      .finally(() => {
        if (inFlight.get(key) === job) inFlight.delete(key);
      });
    inFlight.set(key, job);
    return job;
  }
  return { reset, invalidate, get, load };
}
module.exports = { createDetailCache };
