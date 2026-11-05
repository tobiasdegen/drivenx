/** Presentation-only link from a verified diagnosis source to its SMART table row.
 * No health thresholds are calculated here: the diagnosis is authoritative.
 */
const order = { ok: 0, observe: 1, warning: 2, critical: 3, defective: 4 };

export function attributeEvidence(attribute, diagnosis) {
  const evidence = Array.isArray(diagnosis?.evidence) ? diagnosis.evidence : [];
  const source =
    typeof attribute.id === 'number'
      ? `ata_smart_attributes.${attribute.id}`
      : diagnosis?.protocol === 'nvme'
        ? `nvme_smart_health_information_log.${attribute.name}`
        : null;
  return evidence.filter((item) => {
    if (!item || !Object.hasOwn(order, item.severity)) return false;
    if (source && item.source === source) return true;
    // These older generic finding sources have one unambiguous NVMe field.
    if (diagnosis?.protocol === 'nvme' && attribute.name === 'media_errors')
      return item.ruleId === 'nvMedia';
    // The SCSI finding is aggregated; relate it only to positive contributing
    // uncorrected counters, never to a zero or missing counter.
    if (
      diagnosis?.protocol === 'scsi' &&
      item.ruleId === 'scsiUncorrected' &&
      /^(read|write|verify) \/ total_uncorrected_errors$/.test(attribute.name)
    ) {
      const value = String(attribute.raw);
      return /^\d+$/.test(value) && BigInt(value) > 0n;
    }
    return false;
  });
}

export function attributeSeverity(attribute, diagnosis) {
  const matches = attributeEvidence(attribute, diagnosis);
  return matches.reduce(
    (max, item) => (max === null || order[item.severity] > order[max] ? item.severity : max),
    null,
  );
}

export function attributeRowsWithStatus(attributes, diagnosis) {
  return attributes.map((attribute, index) => ({
    ...attribute,
    originalIndex: index,
    evidence: attributeEvidence(attribute, diagnosis),
    severity: attributeSeverity(attribute, diagnosis),
  }));
}

export function sortAttributeRows(rows) {
  return [...rows].sort((a, b) => {
    const priority = (order[b.severity] ?? -1) - (order[a.severity] ?? -1);
    return priority || a.originalIndex - b.originalIndex;
  });
}

export function unlinkedEvidence(rows, diagnosis) {
  const matched = new Set(rows.flatMap((row) => row.evidence));
  return (diagnosis?.evidence ?? []).filter((item) => !matched.has(item));
}
