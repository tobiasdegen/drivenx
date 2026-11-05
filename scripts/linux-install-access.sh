#!/bin/sh
# Explicit administrator operation. The source must be from a trusted DriveNX build.
set -eu
if [ "$(id -u)" -ne 0 ]; then
  echo 'Run with sudo to install the root-owned DriveNX Linux access helper.' >&2
  exit 1
fi
source_dir=${1:-"$(CDPATH= cd -- "$(dirname -- "$0")/../linux/privileged" && pwd)"}
install -D -o root -g root -m 0755 "$source_dir/drivenx-smartctl-helper" /usr/libexec/drivenx-smartctl-helper
install -D -o root -g root -m 0644 "$source_dir/io.drivenx.smartctl.policy" /usr/share/polkit-1/actions/io.drivenx.smartctl.policy
