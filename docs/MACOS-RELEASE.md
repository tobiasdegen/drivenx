# Official macOS signing and GitHub release

This procedure distributes **DriveNX for Apple Silicon (ARM64), macOS 15+** outside the Mac App Store. It is separate from `.github/workflows/ci.yml`, which deliberately produces ad-hoc signed test packages. The official workflow is manual and creates only an **unpublished GitHub Release draft**. Publishing that draft is a separate human decision.

## Prerequisites

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) and create a **Developer ID Application** certificate (not Apple Development, Mac Distribution or Developer ID Installer). Apple account holders can create it in [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list). On your Mac, make the signing request with Keychain Access, then import the `.cer` file. Keep the private key.
2. Confirm that macOS Keychain contains a usable certificate and private key:

   ```sh
   security find-identity -v -p codesigning
   ```

   Look for **Developer ID Application: ... (TEAMID)**. A public `.cer` by itself is insufficient without the private key that generated the CSR.
3. Export the certificate **and private key** from Keychain Access as a password-protected `.p12`. Do not add it to Git.
4. In [Apple Account](https://account.apple.com/) open **Sign-In and Security → App-Specific Passwords** and generate a password named `DriveNX Notarization`. Use your own Apple ID and an app-specific password; **never use your normal Apple Account password**. An App Store Connect API key or its prior approval is not necessary for this workflow.
5. Configure these five GitHub Actions *repository secrets* under **Settings → Secrets and variables → Actions**:

   | Secret                        | Value                                                      |
   | ----------------------------- | ---------------------------------------------------------- |
   | `MAC_CSC_LINK`                | Base64 encoding of the exported `.p12` (one line)          |
   | `MAC_CSC_KEY_PASSWORD`        | `.p12` export password                                     |
   | `APPLE_ID`                    | Apple Account email address used for notarization          |
   | `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password generated in the Apple Account       |
   | `APPLE_TEAM_ID`               | Team ID of the Developer ID Application certificate        |

   On macOS, copy the certificate safely into the clipboard with `base64 < ~/Downloads/DriveNX-Developer-ID.p12 | tr -d '\n' | pbcopy` and paste into `MAC_CSC_LINK`. Obtain the Team ID from `security find-identity -v -p codesigning` (for the intended Developer ID certificate). **Never paste `.p12` contents, passwords, or tokens into a commit, issue, or chat.** After setting the certificate secret, clear the clipboard with `pbcopy < /dev/null`. Store the original `.p12` and password securely, and revoke an exposed app-specific password through your Apple Account.

## Build and publish (manual)

1. Finish checking the code on all three platforms. The existing `.github/workflows/ci.yml` remains manual and does not get signing credentials.
2. Update `package.json` version (and `package-lock.json` if needed), commit and push to GitHub. For the current version, the following uses `v0.1.0`:

   ```sh
   git tag -a v0.1.0 -m "DriveNX v0.1.0"
   git push origin v0.1.0
   ```

   Only create this tag if it does not already exist, the working tree is clean and the version really is `0.1.0`. Do not move or replace an already published release tag.
3. In GitHub **Actions → DriveNX macOS Release → Run workflow**, enter the existing tag (`v0.1.0`). The workflow checks out that tag, checks its version, imports the signing identity via `CSC_LINK`, signs and notarizes both ARM64 macOS artifacts, verifies the sealed bundle, verifies Gatekeeper acceptance, and generates SHA-256 checksums.
4. A successful run creates a **draft release** containing the DMG, ZIP and `SHA256SUMS-macos.txt`. Check the release assets, notes and licensing before choosing **Publish release**. The workflow never publishes automatically.
5. Test installation from the downloaded DMG on a separate, clean Mac with Gatekeeper enabled. Check start, SMART diagnostics and required authorization. There is no Mac App Store submission in this flow.

## Manual local signing

For a developer with a **Developer ID Application** identity in Keychain and notarization credentials in the environment, run:

```sh
cd ~/dev/drivenx
npm ci
npm run release:mac:signed
```

The script requires usable notarization credentials. For local signing, use `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`; the script also supports a keychain profile or App Store Connect API key for local alternatives. Prefer a keychain profile rather than storing credentials in shell history. GitHub Actions uses the Apple ID credential set described above. The script never publishes files to GitHub.

## Technical and security details

- `scripts/build-mac-release.sh` enables **Hardened Runtime** and uses `build/entitlements.mac.release.plist` (only the JIT entitlement). It requires notarization; unsigned or merely ad-hoc-signed packages are rejected.
- The bundled `smartctl` executable (`Contents/Resources/smartmontools/darwin/smartctl`) is listed as an additional signing target. Both the app and that tool must carry a valid Developer ID signature from the same Team ID.
- The packaged app is checked with `codesign --verify --deep --strict`, `xcrun stapler validate`, `spctl --assess` and the existing macOS package smoke test. Signing and notarization are performed by electron-builder **26.18.0**; no extra notarization plugin is needed.
- `build/entitlements.mac.adhoc.plist` and `scripts/build-mac-ci.sh` remain only for development/test builds.
- The `io.drivenx.app` bundle identifier and macOS 15 minimum are unchanged. The current macOS release is **ARM64 only**.
- Running this in GitHub Actions costs macOS runner minutes and requires an active Apple Developer Program membership. The workflow contains **no certificates or private keys**.

## Official documentation

- [Apple — Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Apple — Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [electron-builder v26 — Notarization](https://www.electron.build/v26/docs/notarization/)
