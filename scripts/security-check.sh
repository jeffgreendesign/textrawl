#!/bin/bash
#
# Security Check Script
# Runs as a pre-commit hook to detect potential path traversal vulnerabilities
#
# This script checks for patterns that could indicate path traversal issues:
# 1. User input (req.params, req.body, req.query, options.output) flowing into file operations
# 2. Missing validation before fs operations
#

set -e

echo "Running security checks..."

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

ISSUES_FOUND=0

# Check for unvalidated path operations in TypeScript files
echo "Checking for unvalidated path operations..."

# Pattern 1: resolve(options.output) without validateOutputPath
if git diff --cached --name-only | grep -E '\.ts$' | xargs grep -l 'resolve(options.output)' 2>/dev/null | while read -r file; do
    if ! grep -q 'validateOutputPath' "$file"; then
        echo -e "${RED}ERROR:${NC} $file uses resolve(options.output) without validateOutputPath"
        ISSUES_FOUND=1
    fi
done; then
    :
fi

# Pattern 2: req.body/params/query flowing into path.join or fs operations
DANGEROUS_PATTERNS=(
    'path\.join.*req\.body'
    'path\.join.*req\.params'
    'path\.join.*req\.query'
    'resolve.*req\.body'
    'resolve.*req\.params'
    'resolve.*req\.query'
    'readFileSync.*req\.'
    'writeFileSync.*req\.'
    'existsSync.*req\.'
    'mkdirSync.*req\.'
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
    # Check only staged files
    matches=$(git diff --cached --name-only | grep -E '\.ts$' | xargs grep -n "$pattern" 2>/dev/null || true)
    if [ -n "$matches" ]; then
        echo -e "${YELLOW}WARNING:${NC} Potential path traversal pattern found:"
        echo "$matches"
        echo "Please ensure proper validation is in place."
        ISSUES_FOUND=1
    fi
done

# Pattern 3: Check that new files importing fs also import security utilities
NEW_FS_FILES=$(git diff --cached --name-only | grep -E '\.ts$' | xargs grep -l "from 'node:fs'" 2>/dev/null || true)
for file in $NEW_FS_FILES; do
    # Skip the security module itself and test files
    if [[ "$file" == *"security.ts"* ]] || [[ "$file" == *".test.ts"* ]] || [[ "$file" == *".spec.ts"* ]]; then
        continue
    fi

    # Check if file handles user input (CLI args or HTTP requests)
    if grep -q "commander\|express\|req\.\|options\." "$file"; then
        # Check if it uses validation
        if ! grep -qE "validateOutputPath|validateInputPath|sanitizeFilename|sanitizeFolderPath" "$file"; then
            echo -e "${YELLOW}WARNING:${NC} $file uses fs operations with potential user input but doesn't import security utilities"
            echo "Consider importing from '../lib/security.js' or '../../lib/security.js'"
        fi
    fi
done

# Check for null byte patterns that could bypass validation
NULL_BYTE_PATTERNS=$(git diff --cached --name-only | grep -E '\.ts$' | xargs grep -n '\\x00\|\\0\|%00' 2>/dev/null || true)
if [ -n "$NULL_BYTE_PATTERNS" ]; then
    echo -e "${YELLOW}WARNING:${NC} Potential null byte usage found (could be for testing):"
    echo "$NULL_BYTE_PATTERNS"
fi

if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "${GREEN}Security checks passed!${NC}"
    exit 0
else
    echo ""
    echo -e "${YELLOW}Security checks completed with warnings.${NC}"
    echo "Please review the warnings above and ensure proper validation is in place."
    # Exit with 0 to not block commits, but warn developers
    # Change to 'exit 1' if you want to block commits with warnings
    exit 0
fi
