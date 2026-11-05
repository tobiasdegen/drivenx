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
