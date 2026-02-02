#!/bin/sh
# Verify critical documentation website infrastructure files exist.
# Run as part of pre-commit hooks to prevent silent breakage.

set -e

ERRORS=0

check_file() {
  if [ ! -f "$1" ]; then
    echo "ERROR: Missing critical file: $1"
    echo "  → $2"
    ERRORS=$((ERRORS + 1))
  fi
}

check_file "website/app/api/search/route.ts" \
  "Search API route is required for docs search to work. See CLAUDE.md 'Search Infrastructure'."

check_file "website/lib/source.ts" \
  "Fumadocs source loader is required for docs content and search indexing."

check_file "website/source.config.ts" \
  "Fumadocs MDX content configuration is required for docs to build."

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "FAILED: $ERRORS critical docs file(s) missing. Docs search will be broken."
  exit 1
fi
