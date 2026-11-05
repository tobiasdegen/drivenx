# Architecture

DriveNX is a single Electron desktop application with a React renderer. The same application code supports Windows, macOS and Linux; hardware-dependent behavior is isolated in platform modules.

## Execution boundaries

```text
React renderer (src/)
    ↓ typed preload API (electron/preload.js; src/ipc-contract.ts)
Electron main (electron/main.js)
    ├─ ipc/ + security/  — authorize, validate, bound requests
    ├─ devices/         — discover devices and run smartctl
    ├─ diagnostics/     — assess evidence and data coverage
    ├─ platform/        — OS inventory and device integration
    ├─ data/            — settings, history and query logs
    ├─ reports/         — report and export operations
    └─ ui/              — native windows, menus and dialogs
             ↓ Linux only, when privileged access is required
         system-installed restricted SMART helper (linux/privileged/)
```

The renderer cannot execute shell commands, read arbitrary files or directly access hardware. Electron uses context isolation, a sandboxed renderer, and a limited preload API. Main-process IPC handlers authorize the requesting window/frame, validate input and check that the device/access mode was made available by the current scan.

## Key modules

| Responsibility           | Code                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Application lifecycle    | `electron/main.js`                                                                                               |
| Preload and public API   | `electron/preload.js`, `src/ipc-contract.ts`                                                                     |
| Authorized device scans  | `electron/devices/scan-controller.js`, `electron/devices/smart.js`                                               |
| Device operations        | `electron/devices/smart-access.js`, `electron/devices/device-operations.js`, `electron/devices/smart-process.js` |
| Diagnostic assessment    | `electron/diagnostics/health.js`, `health-coverage.js`, `health-assessment.js`                                   |
| Shared interpretation    | `shared/diagnosis-model.mjs`, `shared/overview-metrics.mjs`                                                      |
| Reports and history      | `electron/reports/`, `electron/data/`                                                                            |
| Renderer state and views | `src/App.tsx`, `src/hooks/useDriveSession.ts`, `src/components/`                                                 |
| Translations             | `locales/en-US.json`, `locales/de-DE.json`, `src/i18n.mts`, `electron/ui/translator.js`                          |

## Diagnostic data flow

1. `smartctl` lists candidate device paths and possible access modes.
2. The scan controller validates the result and authorizes the current scan generation only after validating the complete device list.
3. Device operations serialize accesses to a given path and enforce process timeouts and output limits.
4. A report snapshot contains raw readings and the centralized `health.diagnosis` assessment with its evidence and coverage.
5. The renderer, history and exports use that assessment; they do not independently determine drive health.

The diagnostic rule identifier is `1.0.0`. It identifies the current decision contract, **not** the application release version. History backups use `drivenx.history.v1` as their file schema identifier.

## Consistency and failure handling

- Every scan renews the authorized device set. Results from older scans or changed access modes are discarded.
- A device identity must be sufficiently reliable before a self-test or persistent history action is permitted.
- Unavailable SMART fields stay unknown, not zero. Protocol (ATA/NVMe/SCSI) and physical connection (SATA/USB/PCIe) are kept separate.
- Queueing, operation limits and bounded subprocess execution protect against overlapping or stuck hardware commands. A device path can be quarantined after an unconfirmed process exit.
- Report and history writes use temporary files and revalidate the current snapshot before committing. A completed OS filesystem operation cannot always be rolled back.
- Linux starts a narrowly authorized helper only when required. The Electron GUI must not run as root and sandboxing must not be disabled as a shortcut.

For discovery and USB bridge handling, see [DEVICE-DETECTION.md](DEVICE-DETECTION.md). For assessment rules, see [DIAGNOSTICS.md](DIAGNOSTICS.md). For native verification, see [TESTING.md](TESTING.md).

## TypeScript and JavaScript

The renderer uses TypeScript (`.ts`/`.tsx`) and Vite. Electron Main, Preload, scripts and Node tests are plain CommonJS `.js` modules, executed without a backend compilation step. Modules shared as ESM retain `.mjs`. Prefer JSDoc types alongside implementation; keep adjacent `.d.mts` declarations only for interfaces that cannot be expressed clearly without duplicated complexity. All Electron JavaScript modules marked `@ts-check` are included automatically in `tsconfig.backend.json`; unmarked modules remain plain JavaScript. Keep validation at runtime even when the IPC interface is statically typed. Avoid creating new process boundaries, compatibility code or abstractions solely to change file layout.
