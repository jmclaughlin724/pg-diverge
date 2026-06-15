#!/usr/bin/env bash
set -euo pipefail
node "${CLAUDE_PROJECT_DIR:-$PWD}/scripts/skills/skill-router.mjs" clear
