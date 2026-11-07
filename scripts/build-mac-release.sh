#!/usr/bin/env bash
# Developer ID build for distribution outside the Mac App Store.
# Intentionally separate from the ad-hoc test builds in build-mac-ci.sh.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo 'DriveNX: Official macOS releases require a macOS build host.' >&2
  exit 1
fi

if [[ -n "${CSC_LINK:-}" && -z "${CSC_KEY_PASSWORD:-}" ]]; then
  echo 'DriveNX: CSC_LINK requires CSC_KEY_PASSWORD.' >&2
  exit 1
fi

# Using a local keychain identity is supported; a CI runner uses CSC_LINK.
if [[ -z "${CSC_LINK:-}" ]] && ! /usr/bin/security find-identity -v -p codesigning | grep -q 'Developer ID Application:'; then
  echo 'DriveNX: No Developer ID Application signing identity available.' >&2
  exit 1
fi

if [[ -z "${APPLE_API_KEY:-}" || -z "${APPLE_API_KEY_ID:-}" || -z "${APPLE_API_ISSUER:-}" ]]; then
  if [[ -z "${APPLE_ID:-}" || -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" || -z "${APPLE_TEAM_ID:-}" ]]; then
    if [[ -z "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
      echo 'DriveNX: Missing notarization credentials (API key, Apple ID, or keychain profile).' >&2
      exit 1
    fi
  fi
fi

# Do not allow a leftover ad-hoc identity selection from a CI invocation.
export CSC_IDENTITY_AUTO_DISCOVERY=true

npm run release:check
node scripts/check-mac-smartctl.js

./node_modules/.bin/electron-builder --mac dmg zip --arm64 --publish never \
  -c.mac.forceCodeSigning=true \
  -c.mac.notarize=true \
  -c.mac.hardenedRuntime=true \
  -c.mac.entitlements=build/entitlements.mac.release.plist \
  -c.mac.entitlementsInherit=build/entitlements.mac.release.plist

app='release/mac-arm64/DriveNX.app'
smartctl="$app/Contents/Resources/smartmontools/darwin/smartctl"
if [[ ! -f "$smartctl" ]]; then
  echo "DriveNX: Bundled smartctl not found in $app." >&2
  exit 1
fi

# Reject ad-hoc and Apple Development signatures, even if codesign verifies.
/usr/bin/codesign --verify --deep --strict --verbose=2 "$app"
app_info=$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1)
if [[ "$app_info" != *'Authority=Developer ID Application:'* ]]; then
  echo 'DriveNX: The application does not have a Developer ID Application signature.' >&2
  exit 1
fi
if [[ "$app_info" != *'Identifier=io.drivenx.app'* ]]; then
  echo 'DriveNX: Unexpected app identifier.' >&2
  exit 1
fi
if ! grep -Eq '^TeamIdentifier=[A-Z0-9]{10}$' <<< "$app_info"; then
  echo 'DriveNX: No valid Apple signing Team ID found.' >&2
  exit 1
fi
if ! grep -Eq '^CodeDirectory .*flags=.*\(runtime\)' <<< "$app_info"; then
  echo 'DriveNX: Hardened Runtime is not enabled.' >&2
  exit 1
fi

/usr/bin/codesign --verify --strict --verbose=2 "$smartctl"
smartctl_info=$(/usr/bin/codesign -dv --verbose=4 "$smartctl" 2>&1)
if [[ "$smartctl_info" != *'Authority=Developer ID Application:'* ]]; then
  echo 'DriveNX: Bundled smartctl is not signed with Developer ID.' >&2
  exit 1
fi
app_team=$(sed -n 's/^TeamIdentifier=//p' <<< "$app_info" | head -1)
tool_team=$(sed -n 's/^TeamIdentifier=//p' <<< "$smartctl_info" | head -1)
if [[ "$app_team" != "$tool_team" ]]; then
  echo 'DriveNX: The app and smartctl have different signing teams.' >&2
  exit 1
fi

/usr/bin/xcrun stapler validate "$app"
/usr/sbin/spctl --assess --type execute --verbose=4 "$app"
npm run smoke:mac

# Do not publish anything here. GitHub workflow uploads only after these checks.
shopt -s nullglob
dmgs=(release/*.dmg)
zips=(release/*.zip)
if [[ "${#dmgs[@]}" -ne 1 || "${#zips[@]}" -ne 1 ]]; then
  echo 'DriveNX: Expected exactly one signed DMG and one ZIP.' >&2
  exit 1
fi
printf 'DriveNX: Developer ID signing, notarization, stapling and Gatekeeper check passed.\n'
