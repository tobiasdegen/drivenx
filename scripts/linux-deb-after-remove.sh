#!/bin/sh
set -eu
case "${1:-}" in
  remove|purge|'')
    rm -f /usr/libexec/drivenx-smartctl-helper /usr/share/polkit-1/actions/io.drivenx.smartctl.policy
    ;;
esac
