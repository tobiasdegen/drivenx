/** Recommendations come only from the authoritative structured diagnosis. */
/** @typedef {'permissionDenied' | 'noData' | 'urgent' | 'critical' | 'warning' | 'crc' | 'interrupted' | 'nvme' | 'limited' | 'ok'} RecommendationKey */
/**
 * @param {import('../src/types').Health} health
 * @returns {{primary: RecommendationKey, reportCodes: string[]}}
 */
export function recommendationPlan(health) {
  const diagnosis = health?.diagnosis;
  if (!diagnosis) return { primary: 'noData', reportCodes: ['noData'] };

  const media = diagnosis.domains?.media;
  const connection = diagnosis.domains?.connection;
  const thermal = diagnosis.domains?.thermal;
  const quality = diagnosis.assessment;
  const denied = (health.readout?.issues || []).some((x) => x.code === 'permissionDenied');
  let primary;
  if (media === 'defective' || media === 'critical') primary = 'urgent';
  else if (thermal === 'critical') primary = 'critical';
  else if (media === 'warning' || thermal === 'warning') primary = 'warning';
  else if (denied && media === null) primary = 'permissionDenied';
  else if (media === null && quality !== 'complete') primary = 'noData';
  else if (connection === 'observe' || connection === 'warning') primary = 'crc';
  else if (media === 'observe' || thermal === 'observe') primary = 'observe';
  else if (quality !== 'complete' || media === null) primary = 'limited';
  else primary = 'ok';
  const reportCodes = [];
  if (['urgent', 'critical'].includes(primary)) reportCodes.push('critical');
  else if (primary === 'warning') reportCodes.push('warning');
  else if (primary === 'observe') reportCodes.push('observe');
  else if (primary === 'crc') reportCodes.push('ataCrcHistory');
  else if (primary === 'noData' || primary === 'permissionDenied') reportCodes.push('noData');
  else if (primary === 'ok') reportCodes.push('ok');
  if ((health.findings || []).some((f) => f.code === 'testsInterrupted'))
    reportCodes.push('selfTestInterrupted');
  if (quality !== 'complete') reportCodes.push('limited');
  return { primary, reportCodes };
}
