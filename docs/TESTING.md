# Testing DriveNX

This guide covers meaningful source-level tests and native acceptance tests for each supported target. It is a **procedure**, not a log of historical devices, dates or release decisions.

## Automated tests

```sh
npm ci
npm test
npm run translations:check
npm run release:check
```

`npm test` runs both the Node regression suite in `tests/electron/` and the Vitest React tests in `tests/ui/` (`npm run test:ui:watch` runs the latter in watch mode). The full `release:check` additionally checks the TypeScript contracts and backend, translations through the regular suite, dependencies/licenses, USB-ID index, formatting, ESLint and the renderer build. Build commands run package smoke tests after packaging.

`fixtures/` contains anonymized SMART/device examples for repeatable parser, identity and diagnosis tests. They test software behavior, **not** the accuracy of hardware failure predictions. Do not include unredacted serial numbers, WWNs, private paths or customer data in new fixtures.

Prefer tests that protect current behavior: unauthorized IPC requests, invalid device paths, ambiguous USB protocol selection, process timeouts, incomplete health data, dangerous commands, export races and correct diagnostic severity. Avoid snapshots of incidental CSS/layout or tests that only assert an earlier directory structure.

## Native installation checks

Run the **packaged** application on a clean system for every supported target, not just `npm run dev`. Record the platform/architecture, artifact checksum, observed behavior and anonymized logs privately or in a suitable issue. Do not commit personal/customer diagnostic records.

| Windows x64                                                   | macOS ARM64                                                         | Linux x64                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Install and uninstall NSIS package; start portable EXE        | Install from DMG/ZIP; validate signing, notarization and Gatekeeper | Install/uninstall DEB; launch AppImage without root                   |
| Check elevation, writable portable data, Defender/SmartScreen | Run embedded smartctl and verify declared minimum OS                | Verify system smartctl, pkexec and graphical Polkit agent             |
| Validate SATA/NVMe/USB device reads                           | Validate internal and USB drives                                    | Validate `/dev/sd*`, NVMe and USB adapters                            |
| Validate saved reports and history after restart              | Validate reports, history and app navigation                        | Validate authorized helper setup, single-session requests and cleanup |

## Hardware behavior checklist

- Device identity and access mode must agree with the **currently selected physical drive** after rescans, disconnects, reconnects and changes of adapter.
- Include HDD, SATA SSD, NVMe and USB bridge cases. For ambiguous USB `snt*` access, test SATA/NVMe selections and cancellation without implicit probing. Use different vendors for coverage; **no** vendor-ID exception should be needed.
- Supported SMART data must render consistently in the drive list, detail view, attribute evidence, history and exported PDF/HTML/JSON reports.
- Incomplete/unsupported data must not be reported as healthy. Include confirmed warning/critical cases, missing NVMe logs, invalid counter values and timeouts.
- SMART self-tests must only run on a reliably identified device. Test cancellation, authorization denial, device removal, queueing and process termination.
- Test settings, localization, native About/legal notices, app restart, history backup/import and export to writable/unwritable locations.
- Validate that platform packages contain the required licenses/data and **not** other platforms' smartctl binaries; the original `usb.ids` is not packaged.
- Under Linux, exercise missing packages, the single-session Polkit helper, rejected requests, no graphical agent and denied authentication.

Do not use irreplaceable production media for destructive or potentially stressful experiments. A wrong-device access, unsafe privilege escalation, data loss or a confirmed falsely reassuring health diagnosis must block a public release.

## Release verification

Before publishing binaries, verify each final artifact, its SHA-256 checksum, third-party license/source payloads and distribution signing requirements. Where necessary, test on older supported OS versions and more than one desktop environment. Do not treat a successful source-level CI run as a substitute for native system testing.

## CI package checks

The manually triggered GitHub Actions workflow runs native package creation and smoke checks for Windows x64, macOS 15+ ARM64 and Linux x64. All six resulting packages are separate direct-download artifacts (five-day retention); CI artifacts are not public signed releases. For Linux DEB packages, the smoke test verifies that the built DEB contains the AppArmor profile and that its maintainer scripts load and remove it. Test installing and running the DEB without `--no-sandbox` on Ubuntu 24.04+; test AppImage behavior separately.
