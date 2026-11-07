#!/bin/sh
set -eu
case "${1:-}" in
  remove|purge|'')
    rm -f /usr/libexec/drivenx-smartctl-helper /usr/share/polkit-1/actions/io.drivenx.smartctl.policy
    if [ -f /etc/apparmor.d/drivenx ]; then
      if command -v apparmor_parser >/dev/null 2>&1; then
        apparmor_parser --remove /etc/apparmor.d/drivenx >/dev/null 2>&1 || true
      fi
      rm -f /etc/apparmor.d/drivenx
    fi
    ;;
esac
