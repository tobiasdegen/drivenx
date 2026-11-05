/** @typedef {'ok' | 'observe' | 'warning' | 'critical' | 'defective'} DiagnosticLevel */
/** @typedef {'media' | 'connection' | 'thermal'} DiagnosticDomain */
/** @typedef {'complete' | 'partial' | 'unassessable'} DiagnosticAssessment */
/** @typedef {{
 * ruleId: string,
 * domain: DiagnosticDomain,
 * severity: DiagnosticLevel,
 * source: string,
 * actualValue?: number | string,
 * mappingConfidence: 'verified' | 'generic' | 'unknown'
 * }} DiagnosticEvidence
 */
/** @typedef {{
 * algorithmVersion: string,
 * assessment: DiagnosticAssessment,
 * protocol: 'ata' | 'nvme' | 'scsi' | 'unknown',
 * coverage: {available: string[], missing: string[]},
 * domains: Record<DiagnosticDomain, DiagnosticLevel | null>,
 * overallAlert: DiagnosticLevel | null,
 * evidence: DiagnosticEvidence[],
 * recommendedActionCodes: string[]
 * }} DiagnosticResult
 */
/** @typedef {{
 * code: string,
 * level: 'info' | 'warnung' | 'kritisch',
 * values?: Record<string, number | string>,
 * message?: string
 * }} VisibleFinding
 */

/**
 * One diagnosis contract. Unknown and incomplete data never silently become healthy.
 * @param {{diagnosis?: DiagnosticResult} | null | undefined} health
 * @returns {DiagnosticLevel | 'unassessable'}
 */
export function visibleDiagnosisStatus(health) {
  const diagnosis = health?.diagnosis;
  if (!diagnosis) return 'unassessable';
  if (
    diagnosis.domains?.media == null &&
    !['critical', 'defective'].includes(diagnosis.overallAlert)
  )
    return 'unassessable';
  return diagnosis.overallAlert ?? 'unassessable';
}

/**
 * @param {{findings?: VisibleFinding[], diagnosis?: DiagnosticResult} | null | undefined} health
 * @returns {VisibleFinding[]}
 */
export function visibleDiagnosisFindings(health) {
  if (!health?.diagnosis) return [{ code: 'noData', level: 'info', values: {} }];
  const original = Array.isArray(health.findings) ? health.findings : [];
  const evidence = health.diagnosis.evidence || [];
  const mapped = evidence.map((item) => {
    const idMatch = /ata_smart_attributes\.(\d+)$/.exec(item.source);
    const source = original.find(
      (row) =>
        row.code === item.ruleId && (!idMatch || Number(row.values?.id) === Number(idMatch[1])),
    );
    const level =
      item.severity === 'critical' || item.severity === 'defective'
        ? 'kritisch'
        : item.severity === 'warning'
          ? 'warnung'
          : 'info';
    const values =
      source?.values ?? (item.actualValue === undefined ? {} : { count: item.actualValue });
    return { code: item.ruleId, level, values };
  });
  // Context such as interrupted tests remains informational, never a media failure.
  const informational = original.filter(
    (f) =>
      f.level === 'info' &&
      f.code !== 'noIssues' &&
      // Connection-domain evidence already represents the same historical
      // SMART-199 count. Do not show it again as a separate legacy note.
      !(f.code === 'ataCrcHistory' && evidence.some((e) => e.ruleId === 'ata_crc_history')) &&
      !evidence.some((e) => e.ruleId === f.code),
  );
  if (!mapped.length && !informational.length && health.diagnosis.domains.media === null)
    return [{ code: 'noData', level: 'info', values: {} }];
  if (!mapped.length && !informational.length)
    return [{ code: 'noIssues', level: 'info', values: {} }];
  return [...mapped, ...informational];
}
