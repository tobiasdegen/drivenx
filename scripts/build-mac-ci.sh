#!/usr/bin/env bash
# CI-only macOS ARM64 test package. Local distribution builds retain their
# existing identity selection; Developer ID signing will be handled separately.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo 'DriveNX: Ad-hoc-Testpakete koennen nur auf macOS gebaut werden.' >&2
  exit 1
fi

# CI test packages must never take a Developer ID certificate from the keychain.
export CSC_IDENTITY_AUTO_DISCOVERY=false

npm run release:check
node scripts/check-mac-smartctl.js

# electron-builder v26 uses mac.identity (v27 uses mac.sign.identity).
# Do the signing before DMG/ZIP creation so downloaded packages contain the
# sealed app, rather than signing a copy only after packaging.
./node_modules/.bin/electron-builder --mac dmg zip --arm64 --publish never \
  -c.mac.identity=- \
  -c.mac.hardenedRuntime=true \
  -c.mac.entitlements=build/entitlements.mac.adhoc.plist \
  -c.mac.entitlementsInherit=build/entitlements.mac.adhoc.plist

app='release/mac-arm64/DriveNX.app'
if [[ ! -d "$app" ]]; then
  echo "DriveNX: Signiertes macOS-App-Bundle fehlt: $app" >&2
  exit 1
fi

# Structural signature check: unlike Gatekeeper, this accepts valid ad-hoc
# signatures. It does not claim to verify an Apple Developer ID or notarization.
/usr/bin/codesign --verify --deep --strict --verbose=2 "$app"
info=$(/usr/bin/codesign -dv --verbose=2 "$app" 2>&1)
if ! grep -q '^Signature=adhoc$' <<< "$info"; then
  echo 'DriveNX: CI-Test-Bundle besitzt keine Ad-hoc-Signatur.' >&2
  exit 1
fi
if ! grep -q '^Identifier=io.drivenx.app$' <<< "$info"; then
  echo 'DriveNX: App-Bundle hat eine unerwartete Signaturkennung.' >&2
  exit 1
fi
printf 'DriveNX: Vollstaendige Ad-hoc-Signatur bestaetigt.\n'

# Validates the packaged app and the bundled smartctl integrity path.
npm run smoke:mac
