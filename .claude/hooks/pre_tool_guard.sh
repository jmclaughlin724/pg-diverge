#!/usr/bin/env bash
set -euo pipefail
payload="$(cat)"
if printf '%s' "$payload" | grep -E 'rm -rf /|git reset --hard|git checkout -- ' >/dev/null 2>&1; then
  printf '%s\n' "dangerous shell command blocked by pre_tool_guard" >&2
  exit 2
fi
exit 0
