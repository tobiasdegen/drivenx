#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then exit 1; fi
rm -f /usr/libexec/drivenx-smartctl-helper /usr/share/polkit-1/actions/io.drivenx.smartctl.policy
