import type {
  DiagnosticResult,
  DiagnosticEvidence,
  DiagnosticLevel,
} from '../shared/diagnosis-model.mjs';

export interface AttributedSmartRow {
  id: number | string;
  name: string;
  raw: string;
  current?: number | string;
  worst?: number | string;
  threshold?: number | string;
}
export type StatusRow<T extends AttributedSmartRow> = T & {
  originalIndex: number;
  evidence: DiagnosticEvidence[];
  severity: DiagnosticLevel | null;
};
export function attributeEvidence(
  attribute: AttributedSmartRow,
  diagnosis: DiagnosticResult | null | undefined,
): DiagnosticEvidence[];
export function attributeSeverity(
  attribute: AttributedSmartRow,
  diagnosis: DiagnosticResult | null | undefined,
): DiagnosticLevel | null;
export function attributeRowsWithStatus<T extends AttributedSmartRow>(
  attributes: T[],
  diagnosis: DiagnosticResult | null | undefined,
): StatusRow<T>[];
export function sortAttributeRows<T extends AttributedSmartRow>(
  rows: StatusRow<T>[],
): StatusRow<T>[];
export function unlinkedEvidence<T extends AttributedSmartRow>(
  rows: StatusRow<T>[],
  diagnosis: DiagnosticResult | null | undefined,
): DiagnosticEvidence[];
