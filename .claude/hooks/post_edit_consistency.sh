#!/usr/bin/env bash
set -euo pipefail
node "${CLAUDE_PROJECT_DIR:-$PWD}/scripts/skills/skill-router.mjs" gate >/dev/null || true
