# Diagnostic assessment

DriveNX uses a single health assessment supplied by `electron/diagnostics/health.js`, `health-coverage.js` and `health-assessment.js`. The renderer, reports and history do not compute competing health scores.

The current `health.diagnosis.algorithmVersion` is `1.0.0`. This is a rule-contract identifier, independent of the application version.

## Result structure

- `diagnosis.domains.media`: supported media health evidence.
- `diagnosis.domains.connection`: connection/CRC evidence, not proof of failing flash cells.
- `diagnosis.domains.thermal`: current temperature conditions and limits.
- `diagnosis.assessment`: `complete`, `partial`, or `unassessable` — **coverage**, not severity.
- `diagnosis.evidence`: rule, domain, severity, original data source, observed value and confidence.

Severity classes are `ok`, `observe`, `warning`, `critical` and `defective`. They describe actions and risks; they are **not** failure probabilities or estimates of remaining lifespan. Confirmed serious evidence is retained even if other fields are missing. Unreadable SMART data never implies a healthy drive.

## Protocol-specific coverage

| Protocol                        | Relevant minimum health evidence                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ATA/SATA                        | Interpretable SMART media indicators with trustworthy meanings/raw formats. SMART-PASS alone is insufficient. |
| NVMe                            | `critical_warning`, `media_errors`, `available_spare`, `available_spare_threshold`, `percentage_used`.        |
| SCSI/SAS                        | Valid uncorrected read, write and verify error counters.                                                      |
| USB with no readable health log | No supported media-health judgment (`unassessable`).                                                          |

Optional unsupported log pages do not automatically invalidate an otherwise complete health readout. A missing value is not the number zero.

## Assessment rules

| Evidence                                                                            | Interpretation                                      | Important limitation                                                          |
| ----------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| SMART overall failure, relevant self-test failure or valid prefail threshold breach | Defective operating condition                       | Does not necessarily mean physically irreparable.                             |
| Confirmed nonzero HDD pending/offline-uncorrectable sectors                         | Critical                                            | Requires trustworthy ATA identification and raw value.                        |
| Verified SSD media/program errors and uncorrectable errors                          | Critical when supported by the rule                 | Vendor fields cannot be added or reinterpreted generically without a mapping. |
| SATA CRC counter increase                                                           | Connection evidence                                 | Does not prove bad NAND cells or a currently faulty cable.                    |
| Valid current or historical ATA error logs                                          | Evidence within their proper time context           | Do not double-count summary and extended logs.                                |
| NVMe media errors / spare threshold / warning bits                                  | Domain-specific severity                            | NVMe error-log entries alone do not prove failing media.                      |
| NVMe endurance consumption                                                          | Observe/warning according to implemented thresholds | Endurance usage is not an overall health percentage.                          |
| Temperature and reported operating limits                                           | Thermal evidence                                    | Use trustworthy current values, not fabricated historic peaks.                |

The exact numeric thresholds, ATA attribute mappings and evidence identifiers are defined in the assessment modules and verified with `tests/electron/health-diagnosis.test.js` and the reference fixtures. Documentation must not become a second, separately maintained decision table.

## Renderer, exports and trends

The SMART attribute table highlights only evidence from the backend diagnosis. A missing row-specific finding does not mean the drive is healthy. Reports use the same snapshot and assessment as the main UI.

Trends use timestamp-valid measurements of the same reliably identified drive. Falling cumulative counters start a new comparison segment. Missing values remain unknown; trend observations do not retroactively modify a completed health assessment or predict failure dates. Local backup files use the `drivenx.history.v1` schema and must pass identity/type/size checks before import.

## Test data and limitations

The anonymized diagnostic examples are under `fixtures/diagnosis-reference/` and `fixtures/device-tests/`. They serve as reproducible regression cases, **not** measured accuracy statistics or evidence of live hardware qualification. New rules should use multiple device and protocol samples, including missing/invalid data, with a clear reason for each severity.
