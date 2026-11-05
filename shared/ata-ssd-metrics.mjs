/** Model-scoped ATA SSD estimates. Never infer from an unknown vendor attribute. */
const safe = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const samsung860 = (raw) =>
  raw?.rotation_rate === 0 && /^SAMSUNG SSD 860 EVO(?:\s|$)/i.test(String(raw?.model_name || ''));
const attribute = (raw, id, name) =>
  raw?.ata_smart_attributes?.table?.find((a) => a?.id === id && name.test(String(a?.name || '')));
const rawCount = (item) => {
  const string = item?.raw?.string;
  if (typeof string !== 'string' || !/^\d+$/.test(string.trim())) return null;
  const count = Number(string.trim());
  if (!Number.isSafeInteger(count)) return null;
  const numeric = item?.raw?.value;
  return numeric === undefined || numeric === count ? count : null;
};
/**
 * @typedef {{
 *   usedPercent: number | null,
 *   source: 'smartctl-endurance' | 'samsung-860-normalized-177' | null,
 *   inconsistent: boolean,
 *   normalizedUsedPercent: number | null,
 *   reportedUsedPercent: number | null,
 *   writtenBytes: string | null,
 * }} Samsung860Metrics
 */
/**
 * @param {import('../src/smartctl-types.ts').SmartctlReport | null | undefined} raw
 * @returns {Samsung860Metrics | null}
 */
export function samsung860Metrics(raw) {
  if (!samsung860(raw)) return null;
  const wear = attribute(raw, 177, /^Wear_Leveling_Count$/i);
  const normalized = safe(wear?.value);
  const inferredUsed = normalized !== null && normalized <= 100 ? 100 - normalized : null;
  const deviceUsed = safe(raw?.endurance_used?.current_percent);
  const writeLbas = rawCount(attribute(raw, 241, /^Total_LBAs_Written$/i));
  const sectorBytes = safe(raw?.logical_block_size) || 512;
  return {
    usedPercent: deviceUsed !== null ? deviceUsed : inferredUsed,
    source:
      deviceUsed !== null
        ? 'smartctl-endurance'
        : inferredUsed !== null
          ? 'samsung-860-normalized-177'
          : null,
    inconsistent: inferredUsed !== null && deviceUsed !== null && inferredUsed !== deviceUsed,
    normalizedUsedPercent: inferredUsed,
    reportedUsedPercent: deviceUsed,
    writtenBytes: writeLbas === null ? null : String(BigInt(writeLbas) * BigInt(sectorBytes)),
  };
}
