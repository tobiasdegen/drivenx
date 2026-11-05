# DriveNX

DriveNX is an open-source desktop application for **HDD, SSD and NVMe diagnostics** on Windows, macOS and Linux. It reads device data through [smartmontools](https://www.smartmontools.org/), explains available SMART evidence, supports compatible self-tests, maintains optional local measurement history and exports diagnostic reports.

DriveNX's original application code is licensed under [MIT](LICENSE.md). Bundled third-party software and data retain their [own licenses](LICENSE-THIRD-PARTY.md).

[Deutsch](README.de.md) · [Contributing](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md) · [Diagnostic limitations](DISCLAIMER.en.md)

> A normal SMART result **does not guarantee** that a drive is healthy or will not fail. Preserve important data before attempting hardware tests or recovery work.

## Features

- Discover drives and inspect SMART information from ATA/SATA, NVMe and supported SCSI devices, including some USB bridges.
- Explain health findings, data coverage, connection information and available device measurements without inventing missing values.
- Run device-supported SMART self-tests; review logs and optional local measurement history.
- Export PDF, HTML and JSON reports; use the interface in English or German.

## Development

**Node.js 24 and npm** are recommended for consistency with CI.

```sh
npm ci
npm run dev
```

To validate the source before a pull request:

```sh
npm run release:check
```

The check runs automated tests, type checks, ESLint, translation-related checks, resource verification, formatting and the frontend build. See [CONTRIBUTING.md](CONTRIBUTING.md) for development rules and [TESTING.md](docs/TESTING.md) for platform testing.

## Repository guide

| Location                                              | Purpose                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `electron/main.js` and `electron/preload.js`          | Main-process entry and the restricted renderer bridge             |
| `electron/devices/`                                   | Discovery, smartctl access and self-tests                         |
| `electron/diagnostics/`                               | Health assessment, evidence and diagnostic snapshots              |
| `electron/platform/`                                  | Windows/macOS/Linux integration                                   |
| `electron/ipc/` and `electron/security/`              | IPC authorization, validation and protected subprocess operations |
| `electron/data/`, `electron/reports/`, `electron/ui/` | Persistence, exports, native windows/menus                        |
| `src/`                                                | React renderer, hooks and UI-specific logic                       |
| `shared/`                                             | Logic shared by the renderer and Electron                         |
| `linux/privileged/`                                   | Restricted Linux SMART helper and Polkit policy                   |
| `tests/electron/` and `fixtures/`                     | Automated tests and sanitized device data                         |
| `locales/`                                            | English and German translation catalogs                           |
| `scripts/`, `build/`, `public/`, `vendor/`            | Tooling, icons and third-party resources                          |

For the architectural boundaries and module responsibilities, read [ARCHITECTURE.md](docs/ARCHITECTURE.md). Device discovery and risk classification are documented separately in [DEVICE-DETECTION.md](docs/DEVICE-DETECTION.md) and [DIAGNOSTICS.md](docs/DIAGNOSTICS.md).

## Building

| Target                               | Build command         | Preferred build host |
| ------------------------------------ | --------------------- | -------------------- |
| Windows x64 – installer and portable | `npm run release:win` | Windows x64          |
| macOS ARM64 – DMG and ZIP            | `npm run dist:mac`    | Apple Silicon macOS  |
| Linux x64 – AppImage and DEB         | `npm run dist:linux`  | Linux x64            |

See [BUILDING.md](docs/BUILDING.md) for system dependencies, Linux authorization, signing and package checks. The bundled macOS ARM64 `smartctl` targets macOS 15 or later (`minos 15.0`). Compatibility with macOS 15 must still be verified on real hardware; a successful package build does not establish runtime compatibility.

## Localization

English is the reference catalog (`locales/en-US.json`); German is `locales/de-DE.json`. To help translate DriveNX, follow [TRANSLATORS.md](docs/TRANSLATORS.md). Internal language identifiers are `en-US` and `de-DE` (BCP 47).

## Privacy, licenses and security

Processing is local. Reports and history may contain serial numbers and other device identifiers; review them before sharing. There is no guarantee that hardware-provided information is anonymous.

The [third-party notices](LICENSE-THIRD-PARTY.md) describe the independently licensed smartmontools binaries, source archive, Electron runtime and USB-ID data. Do not remove copyright and license material when repackaging DriveNX.

For security disclosures, prefer GitHub's private vulnerability reporting when enabled; do not post sensitive device records in public issues.
