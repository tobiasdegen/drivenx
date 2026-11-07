#!/usr/bin/env bash
# Assemble verified Windows, macOS and Linux packages into ONE unpublished draft.
# Run only after the three platform checks have succeeded in GitHub Actions.
set -euo pipefail

: "${GH_TOKEN:?GitHub token is required.}"
: "${GH_REPO:?GitHub repository is required.}"
: "${RELEASE_TAG:?Release tag is required.}"
reuse_macos=${REUSE_EXISTING_MACOS:-false}
if [[ ! "$RELEASE_TAG" =~ ^v([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$ ]]; then
  echo 'DriveNX: invalid release tag.' >&2
  exit 1
fi
version=${BASH_REMATCH[1]}
if [[ "$reuse_macos" != true && "$reuse_macos" != false ]]; then
  echo 'DriveNX: invalid reuse_existing_macos input.' >&2
  exit 1
fi

assets=(
  "DriveNX-Setup-$version-x64.exe"
  "DriveNX-Portable-$version-x64.exe"
  "DriveNX-$version-arm64.dmg"
  "DriveNX-$version-arm64-mac.zip"
  "DriveNX-$version-linux-x86_64.AppImage"
  "DriveNX-$version-linux-amd64.deb"
)
mac_assets=("${assets[2]}" "${assets[3]}")
mkdir -p release

if [[ "$reuse_macos" == true ]]; then
  if [[ "$(gh release view "$RELEASE_TAG" --json isDraft --jq '.isDraft')" != true ]]; then
    echo 'DriveNX: the existing macOS release must remain a draft.' >&2
    exit 1
  fi
  # Do not trust a name alone: download both original files and verify them
  # against the checksum created during the successful notarized macOS build.
  gh release download "$RELEASE_TAG" \
    --pattern "${mac_assets[0]}" \
    --pattern "${mac_assets[1]}" \
    --pattern 'SHA256SUMS-macos.txt' --dir release
  (cd release && sha256sum --check --strict SHA256SUMS-macos.txt)
fi

for name in "${assets[@]}"; do
  if [[ ! -s "release/$name" ]]; then
    echo "DriveNX: missing or empty release package: $name" >&2
    exit 1
  fi
done

# One checksum list for all six native installer files. Existing macOS draft
# assets remain unchanged; only the Windows/Linux files and this list are added.
(
  cd release
  sha256sum -- "${assets[@]}" > SHA256SUMS.txt
  sha256sum --check --strict SHA256SUMS.txt
)

if [[ "$reuse_macos" == true ]]; then
  gh release upload "$RELEASE_TAG" \
    "release/${assets[0]}" "release/${assets[1]}" \
    "release/${assets[4]}" "release/${assets[5]}" \
    release/SHA256SUMS.txt
else
  # Never overwrite already published or previously uploaded release assets.
  if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
    echo 'DriveNX: release already exists. Refusing to replace any asset.' >&2
    exit 1
  fi
  files=()
  for name in "${assets[@]}"; do
    files+=("release/$name")
  done
  gh release create "$RELEASE_TAG" "${files[@]}" release/SHA256SUMS.txt \
    --draft --verify-tag --title "DriveNX $RELEASE_TAG" --generate-notes
fi

if [[ "$(gh release view "$RELEASE_TAG" --json isDraft --jq '.isDraft')" != true ]]; then
  echo 'DriveNX: release is not a draft; refusing to treat it as ready.' >&2
  exit 1
fi
actual_assets=$(gh release view "$RELEASE_TAG" --json assets --jq '.assets[].name')
for name in "${assets[@]}" SHA256SUMS.txt; do
  if ! grep -Fxq "$name" <<< "$actual_assets"; then
    echo "DriveNX: missing GitHub release asset: $name" >&2
    exit 1
  fi
done
printf 'DriveNX: all six installers and checksums are present in the unpublished %s draft.\n' "$RELEASE_TAG"
