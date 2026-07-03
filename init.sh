#!/usr/bin/env bash
set -euo pipefail

ok=1
check() {
  if command -v "$1" >/dev/null 2>&1; then
    printf '\033[92m✓\033[0m %s\n' "$1"
  else
    printf '\033[91m✗\033[0m missing %s\n' "$1"
    ok=0
  fi
}

check python3
check bash

if [ "$ok" -eq 1 ]; then
  echo "Environment looks ready."
else
  echo "Install the missing tools above, then rerun init.sh."
  exit 1
fi
