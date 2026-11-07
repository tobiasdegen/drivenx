#!/bin/sh
# Installed by the DEB package manager, running as root.
set -eu
source_dir=''
for candidate in /opt/drivenx/resources/linux-privileged /opt/DriveNX/resources/linux-privileged; do
  if [ -f "$candidate/drivenx-smartctl-helper" ] && [ -f "$candidate/io.drivenx.smartctl.policy" ]; then
    source_dir="$candidate"
    break
  fi
done
if [ -z "$source_dir" ]; then
  echo 'DriveNX SMART helper files not found in the installed application' >&2
  exit 1
fi
# Do not execute any resource script as root; invoke the fixed install commands.
install -D -o root -g root -m 0755 "$source_dir/drivenx-smartctl-helper" /usr/libexec/drivenx-smartctl-helper
install -D -o root -g root -m 0644 "$source_dir/io.drivenx.smartctl.policy" /usr/share/polkit-1/actions/io.drivenx.smartctl.policy

# Electron needs user namespaces for its sandbox on Ubuntu 24+.
# electron-builder packages deb.appArmorProfile as resources/apparmor-profile.
# Custom afterInstall hooks must also install/load this profile themselves.
profile_source=''
for candidate in /opt/drivenx/resources/apparmor-profile /opt/DriveNX/resources/apparmor-profile; do
  if [ -f "$candidate" ]; then
    profile_source="$candidate"
    break
  fi
done
if [ -n "$profile_source" ] && command -v apparmor_parser >/dev/null 2>&1 \
  && command -v apparmor_status >/dev/null 2>&1 \
  && apparmor_status --enabled >/dev/null 2>&1; then
  # Skip unsupported AppArmor versions, e.g. Ubuntu 22.04.
  if apparmor_parser --skip-kernel-load --debug "$profile_source" >/dev/null 2>&1; then
    install -D -o root -g root -m 0644 "$profile_source" /etc/apparmor.d/drivenx
    # In image-building chroots the profile must be loaded only on first boot.
    if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
      apparmor_parser --replace /etc/apparmor.d/drivenx || \
        echo 'DriveNX: AppArmor profile installed but could not be loaded' >&2
    fi
  else
    echo 'DriveNX: AppArmor version does not support the bundled profile; skipping' >&2
  fi
fi
