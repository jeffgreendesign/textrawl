#!/bin/bash
set -euo pipefail

# =============================================================================
# tool-sync-check.sh — Verify that all registered MCP tools appear in docs
#
# Extracts tool names from src/tools/*.ts and checks they exist in:
#   - AGENTS.md
#   - llms.txt
#   - llms-full.txt
#   - .well-known/mcp.json
#
# Exit 0 if all tools are documented, exit 1 if any are missing.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Extract registered tool names from source code
# registerTool( is on one line, the tool name string is on the next
TOOL_NAMES=$(grep -A1 "registerTool\b\|server\.tool\b" "$ROOT_DIR/src/tools/"*.ts \
	| grep -oE "'[a-z0-9_]+'" \
	| tr -d "'" \
	| sort -u)

if [ -z "$TOOL_NAMES" ]; then
	echo "ERROR: No tool names found in src/tools/*.ts"
	exit 1
fi

DOC_FILES=(
	"CLAUDE.md"
	"README.md"
	"AGENTS.md"
	"llms.txt"
	"llms-full.txt"
	".well-known/mcp.json"
)

MISSING=0

for tool in $TOOL_NAMES; do
	for doc in "${DOC_FILES[@]}"; do
		doc_path="$ROOT_DIR/$doc"
		if [ ! -f "$doc_path" ]; then
			echo "WARN: $doc does not exist — skipping"
			continue
		fi
		if ! grep -q "$tool" "$doc_path"; then
			echo "MISSING: '$tool' not found in $doc"
			MISSING=$((MISSING + 1))
		fi
	done
done

TOOL_COUNT=$(echo "$TOOL_NAMES" | wc -l)

if [ "$MISSING" -eq 0 ]; then
	echo "OK: All $TOOL_COUNT tools found in all documentation files"
	exit 0
else
	echo ""
	echo "FAIL: $MISSING missing tool reference(s) across documentation files"
	echo "See CLAUDE.md 'Documentation Sync Rules' for the full list of files to update."
	exit 1
fi
