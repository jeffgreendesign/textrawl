#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install all workspace dependencies (root + website/ + desktop/)
# Uses pnpm install (not pnpm install --frozen-lockfile) to take advantage
# of container layer caching — subsequent runs are fast no-ops.
pnpm install
