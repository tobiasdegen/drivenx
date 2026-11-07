# Building and packaging DriveNX

Use Node.js 24 (see `engines` in `package.json`) and the lockfile (`npm ci`). CI also uses Node.js 24. Each target package is best built on a host of the same OS and target architecture. Package creation alone does not establish runtime hardware compatibility.

## Source checks

```sh
npm ci
npm run release:check
```

`release:check` includes tests, contract/backend checks, resource and licensing checks, formatting, linting and the frontend build. `npm run format` **modifies files**; do not use it as a verification command. The CI workflow under `.github/workflows/ci.yml` also builds and smoke-tests unsigned/native target packages on Windows x64, macOS ARM64 and Linux x64. The six resulting GitHub Actions artifacts are individually downloadable files (no extra ZIP wrapping), each retained for five days. They are **test builds**, not public signed releases.

## Package commands

| Host                | Command               | Output                      |
| ------------------- | --------------------- | --------------------------- |
| Windows x64         | `npm run release:win` | NSIS setup and portable EXE |
| Apple Silicon macOS | `npm run dist:mac`    | ARM64 DMG and ZIP           |
| Linux x64           | `npm run dist:linux`  | x64 AppImage and DEB        |

The release configuration fails on missing production dependencies and excludes duplicate React, React DOM, Lucide and Scheduler modules (the browser code is already bundled by Vite). The output directory is `release/`; smoke tests inspect the packaged application and required resources. Native launch and real device tests are documented in [TESTING.md](TESTING.md).

### Windows

Windows packages include `vendor/smartmontools/win32/smartctl.exe`, the DriveDB and required license/source resources; they do **not** include macOS `smartctl`. The installer requests elevation, while portable data is stored in a writable `DriveNXData` directory beside the portable executable. Test installation, uninstallation, first start and data persistence on a clean Windows x64 machine. Public distribution additionally needs appropriate signing decisions and executable reputation testing.

### macOS

macOS ARM64 packages include `vendor/smartmontools/darwin/smartctl`, the DriveDB and required license/source resources; they do **not** include Windows `smartctl.exe`. The bundled ARM64 tool is built with a **macOS 15.0 minimum deployment target** (Mach-O `LC_BUILD_VERSION`, `minos 15.0`; build SDK 27.2). The binary SHA-256 and compiler flags are recorded in `vendor/smartmontools/darwin/README.txt`. Do not lower `minimumSystemVersion` without rebuilding and validating both the bundled binary and Electron runtime. Actual device access on macOS 15 must be tested on a real macOS 15 machine.

After packaging/signing, `smoke:mac` verifies the sealed app and executes bundled `smartctl --version`. For public distribution outside the Mac App Store, use the separate **Developer ID Application** signing/notarization workflow described in [MACOS-RELEASE.md](MACOS-RELEASE.md). It creates an unpublished GitHub Release draft only after signature, Gatekeeper and package checks pass. A local Apple Development signature is not a public distribution signature.

### Linux

Linux packages use the **system-installed** `smartctl`, without bundled Windows/macOS executables or the upstream source archive. Windows/macOS bundles retain the smartmontools 7.5 corresponding-source archive. The DEB declares dependencies on `smartmontools`, `pkexec` and `python3`; the AppImage cannot install system packages. On Debian/Ubuntu, for example:

```sh
sudo apt install smartmontools pkexec python3
```

A graphical Polkit authentication agent must also be available for privileged operations. DriveNX checks for missing system dependencies at startup and offers installation instructions, but never silently installs packages. A Linux app must **not** be launched as root or with `--no-sandbox`.

The preferred privileged access path is the restricted `linux/privileged/drivenx-smartctl-helper`, installed as root-owned system code at `/usr/libexec/drivenx-smartctl-helper` alongside its Polkit policy. The DEB installs and removes these files using package hooks. On Ubuntu 24.04+ it also installs `build/drivenx.apparmor` as `/etc/apparmor.d/drivenx` and loads the profile for Chromium user namespaces, keeping Electron's sandbox enabled. Older systems without a compatible AppArmor profile parser are skipped. The AppImage cannot install a system AppArmor profile by itself; on systems that restrict unprivileged user namespaces, a suitable local profile must be configured by an administrator. When developing from trusted sources or using an AppImage, a user may deliberately install/remove the helper:

```sh
npm run linux:setup-access
npm run linux:remove-access
```

The helper accepts a limited command set and can remain available within an application session after one Polkit authentication. If absent, direct `pkexec` requests can require repeated authorization. Test actual Polkit behavior under GNOME and KDE and verify the helper is removed correctly on package uninstallation.

## Distributable resources and licensing

- React/UI code and the required Electron/CommonJS files are packaged in `app.asar`.
- The derived USB-ID index and BSD license are shipped; the original `usb.ids` remains in the source repository.
- Windows and macOS bundle their own smartmontools 7.5 binaries and the upstream source archive. Linux uses distribution-managed smartmontools.
- Preserve `LICENSE.md`, [third-party notices](../LICENSE-THIRD-PARTY.md), the full original license texts and `LICENSES.chromium.html` in published packages.

The binary provenance information is recorded in `vendor/smartmontools/win32/README.txt`, `vendor/smartmontools/darwin/README.txt` and the third-party notices. Provenance and a matching upstream archive are important, but they do not alone establish that every GPL-required corresponding build component has been supplied.

Signing credentials must not be committed to the repository. Publishing official artifacts should require tests, approved licensing and native-platform verification rather than only a passing CI status.

## CI verification and platform requirements

The workflow `.github/workflows/ci.yml` is triggered **manually** (`workflow_dispatch`), not on every push or pull request. Its three native matrix jobs each execute `release:check`, build their OS packages and run package smoke tests. macOS CI explicitly disables local certificate discovery; it is not a distribution signing or notarization workflow. Every package needs manual runtime tests on real storage devices and a supported target OS before publication.

`actions/upload-artifact@v7` uploads **one file per step** using `archive: false`: two Windows EXE files, a macOS DMG and ZIP, and a Linux AppImage and DEB. Each file can be downloaded directly from the workflow run without an additional ZIP container; artifacts expire after five days.

**Critical:** the repo must contain the macOS 15 ARM64 `vendor/smartmontools/darwin/smartctl` that matches the pinned SHA-256 in `electron/platform/bundled-smartctl.js` (and must preserve executable permissions in Git). A macOS build built locally from the source archive is not automatically present in a GitHub checkout. CI intentionally fails until the vetted binary is committed.
