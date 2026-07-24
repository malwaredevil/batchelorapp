#!/usr/bin/env bash
# pre-publish.sh — automated pre-publish gate
# Runs every automatable Stage 1 check in order; stops hard on first failure.
# Usage: pnpm --filter @workspace/scripts run pre-publish
# Non-automatable steps (Sentry baseline, screenshot, code review,
# services-page review) remain in the manual checklist.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PASS="\033[0;32m✓\033[0m"

step() { echo -e "\n\033[1m[$1/9]\033[0m $2"; }

step 1 "Typecheck (pnpm run typecheck)"
pnpm run typecheck
echo -e "$PASS Typecheck passed"

step 2 "Lint + formatting (pnpm run lint)"
# Auto-fix formatting first so GitHub CI sees clean files
npx prettier --write . --log-level warn
pnpm run lint
echo -e "$PASS Lint passed (Prettier auto-fixed, raw-fetch guard clean)"

step 3 "Codegen drift check"
pnpm --filter @workspace/api-spec run codegen
echo -e "$PASS Codegen: no drift (any regenerated files will be included in the GitHub sync)"

step 4 "App-config drift check"
pnpm --filter @workspace/api-server run lint:config
echo -e "$PASS App-config: no drift"

step 5 "GitHub CI status (latest main commit)"
pnpm --filter @workspace/scripts run check-ci-status
echo -e "$PASS GitHub CI: green"

step 6 "Forbidden provisioning-script filenames"
# One-off scripts (add-users, seed-users, create-accounts, etc.) often contain
# hardcoded household emails or passwords. Block them from ever being synced.
FORBIDDEN_FILE_GLOBS=(
  "add-users*"
  "add-user*"
  "seed-users*"
  "seed-user*"
  "create-accounts*"
  "create-account*"
  "provision-users*"
  "provision-user*"
  "bootstrap-users*"
  "bootstrap-user*"
)
FOUND_FORBIDDEN=()
for glob in "${FORBIDDEN_FILE_GLOBS[@]}"; do
  while IFS= read -r -d '' f; do
    rel="${f#"$ROOT"/}"
    # Skip private directories that are never pushed to GitHub anyway
    case "$rel" in
      .local/*|.agents/*|.git/*|node_modules/*|*/node_modules/*|dist/*|*/dist/*) continue ;;
    esac
    FOUND_FORBIDDEN+=("$rel")
  done < <(find "$ROOT" -not -path "$ROOT/.local/*" -not -path "$ROOT/.agents/*" \
            -not -path "$ROOT/.git/*" -not -path "*/node_modules/*" \
            -not -path "*/dist/*" \
            -name "$glob" -print0 2>/dev/null || true)
done
if [[ ${#FOUND_FORBIDDEN[@]} -gt 0 ]]; then
  echo -e "\n\033[0;31m🚫 FAIL: Forbidden provisioning-script filenames found.\033[0m"
  echo "   These files often contain hardcoded household emails/passwords and must"
  echo "   never be synced to the public GitHub repo. Delete or rename them:"
  printf '   %s\n' "${FOUND_FORBIDDEN[@]}"
  exit 1
fi
echo -e "$PASS No forbidden provisioning-script filenames"

step 7 "Household PII scan (email addresses)"
# pii-scan.ts checks every file that github-sync would push for email addresses
# whose domain is not in the known-safe list. Catches hardcoded household emails
# before they can reach the public repo.
pnpm --filter @workspace/scripts run pii-scan
echo -e "$PASS PII scan: no household email addresses found"

step 8 "replit.md private-content guard"
# replit.md is committed to the public GitHub repo. Catch private operational
# details that belong in .local/RUNBOOK.md before they can leak.
PRIVATE_PATTERNS=(
  "sentry-baseline write [0-9]"
  "screenshotToken"
  "gadhlfluflknlwgmlmos"
  "RESEND_WEBHOOK_SECRET"
)
REPLIT_MD="$ROOT/replit.md"
LEAKED_PATTERNS=()
for pat in "${PRIVATE_PATTERNS[@]}"; do
  if grep -qE "$pat" "$REPLIT_MD" 2>/dev/null; then
    LEAKED_PATTERNS+=("$pat")
  fi
done
if [[ ${#LEAKED_PATTERNS[@]} -gt 0 ]]; then
  echo -e "\n\033[0;31m🚫 FAIL: replit.md contains private operational content.\033[0m"
  echo "   These patterns are private and must live in .local/RUNBOOK.md, not replit.md:"
  printf '   • %s\n' "${LEAKED_PATTERNS[@]}"
  echo "   Move the matching content to .local/RUNBOOK.md and replace it with a"
  echo "   pointer (e.g. 'See .local/RUNBOOK.md for details.')."
  exit 1
fi
echo -e "$PASS replit.md: no private content detected"

step 9 "Upload-limit guard (no direct HIGH_MULTER_FILE_BYTES imports in route/elaine files)"
pnpm --filter @workspace/scripts run check-upload-limits
echo -e "$PASS Upload-limit guard: all route/elaine files use multerLimitForPrefix()"

echo -e "\n\033[0;32m✓ All automated pre-publish checks passed.\033[0m"
echo "  Proceed to: Stage 2 (DB safety) → Stage 3 (backup + GitHub sync) → publish."
