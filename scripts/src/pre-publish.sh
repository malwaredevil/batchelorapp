#!/usr/bin/env bash
# pre-publish.sh — automated pre-publish gate
# Usage: pnpm --filter @workspace/scripts run pre-publish
#
# Deliberately excludes checks that GitHub CI already covers (typecheck, lint,
# codegen drift, PII scan) — step (e) verifies CI is green before publishing,
# so re-running them here is pure redundancy and causes timeout. This script
# covers only local guards that CI does NOT run, plus prettier auto-fix.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

GREEN="\033[0;32m"
RED="\033[0;31m"
BOLD="\033[1m"
RESET="\033[0m"

LOGDIR="$(mktemp -d)"
trap 'rm -rf "$LOGDIR"' EXIT

# ---------------------------------------------------------------------------
# Step 1: prettier --write (auto-fix formatting before GitHub sync)
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[1/3]${RESET} Formatting (prettier --write) …"
if ! npx prettier --write . --log-level warn > "$LOGDIR/prettier.log" 2>&1; then
  echo -e "${RED}🚫 FAIL${RESET}: prettier --write failed"
  cat "$LOGDIR/prettier.log"
  exit 1
fi
echo -e "${GREEN}✓${RESET} Prettier: files formatted"

# ---------------------------------------------------------------------------
# Step 2: parallel local-only guards (not covered by CI)
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[2/3]${RESET} Local guards (parallel) …\n"

run_bg() {
  local key="$1"; shift
  ("$@" > "$LOGDIR/$key.log" 2>&1; echo $? > "$LOGDIR/$key.exit") &
}

# App-config drift (vitest suite — ~5 s)
run_bg appconfig pnpm --filter @workspace/api-server run lint:config

# Forbidden provisioning-script filenames
# Uses rg --files (respects .gitignore, fast) instead of find to avoid
# traversing node_modules 9 times which takes ~2 minutes.
(
  FOUND=$(rg --files \
    --glob "add-user*" \
    --glob "seed-user*" \
    --glob "create-account*" \
    --glob "provision-user*" \
    --glob "bootstrap-user*" \
    --glob "add-users*" \
    --glob "seed-users*" \
    --glob "create-accounts*" \
    --glob "provision-users*" \
    --glob "bootstrap-users*" \
    2>/dev/null | grep -v -E '^(\.local|\.agents|\.git)/' || true)
  if [[ -n "$FOUND" ]]; then
    echo "Forbidden provisioning-script filenames (may contain hardcoded emails/passwords):"
    echo "$FOUND" | sed 's/^/  /'
    exit 1
  fi
) > "$LOGDIR/forbidden.log" 2>&1; echo $? > "$LOGDIR/forbidden.exit" &

# replit.md private-content guard
(
  PRIVATE_PATTERNS=(
    "sentry-baseline write [0-9]"
    "screenshotToken"
    "gadhlfluflknlwgmlmos"
    "RESEND_WEBHOOK_SECRET"
  )
  REPLIT_MD="$ROOT/replit.md"
  LEAKED=()
  for pat in "${PRIVATE_PATTERNS[@]}"; do
    if grep -qE "$pat" "$REPLIT_MD" 2>/dev/null; then
      LEAKED+=("$pat")
    fi
  done
  if [[ ${#LEAKED[@]} -gt 0 ]]; then
    echo "replit.md contains private content — move to .local/ops-runbook.md:"
    printf '  • %s\n' "${LEAKED[@]}"
    exit 1
  fi
) > "$LOGDIR/replitmd.log" 2>&1; echo $? > "$LOGDIR/replitmd.exit" &

# Upload-limit guard
run_bg uploadlimit pnpm --filter @workspace/scripts run check-upload-limits

# pg Pool/Client singleton guard
run_bg pgsingleton pnpm --filter @workspace/scripts run check-pg-singleton

# Composition-and-configuration architecture guard. CI also runs this, but the
# local pre-publish gate must catch Replit-only drift before it is synced.
run_bg composition pnpm --filter @workspace/scripts run check-domain-composition

# GitHub CI status (network-bound — runs in parallel with the local guards)
run_bg cistatus pnpm --filter @workspace/scripts run check-ci-status

wait

# ---------------------------------------------------------------------------
# Collect results
# ---------------------------------------------------------------------------
echo ""
declare -A LABELS=(
  [appconfig]="App-config drift"
  [forbidden]="Forbidden filenames"
  [replitmd]="replit.md guard"
  [uploadlimit]="Upload-limit guard"
  [pgsingleton]="pg singleton guard"
  [composition]="Composition and configuration"
  [cistatus]="GitHub CI status"
)

FAILED=()
for key in appconfig forbidden replitmd uploadlimit pgsingleton composition cistatus; do
  code=$(cat "$LOGDIR/$key.exit" 2>/dev/null || echo 1)
  if [[ "$code" -eq 0 ]]; then
    echo -e "${GREEN}✓${RESET} ${LABELS[$key]}"
  else
    echo -e "${RED}✗${RESET} ${LABELS[$key]}"
    FAILED+=("$key")
  fi
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo -e "\n${RED}🚫 ${#FAILED[@]} check(s) failed:${RESET}"
  for key in "${FAILED[@]}"; do
    echo -e "\n--- ${LABELS[$key]} ---"
    cat "$LOGDIR/$key.log" 2>/dev/null || true
  done
  exit 1
fi

echo -e "\n${GREEN}✓ All pre-publish checks passed.${RESET}"
echo "  CI covers: typecheck, lint, codegen drift, PII scan."
echo ""
echo "  Proceed to:"
echo "    Stage 2  — DB safety (no drizzle-kit push --force, additive migrations only)."
echo "    Stage 3a — backup: pnpm --filter @workspace/scripts run backup-to-replit"
echo "    Stage 3b — open PRs: close resolved issues, merge green Dependabot PRs."
echo "    Stage 3b3— secrets: pnpm --filter @workspace/scripts run sync-github-secrets"
echo "    Stage 3c — GitHub sync (routing enforced automatically by the script):"
echo "                 .github/workflows/ only  →  github-sync \"msg\" --direct-to-main"
echo "                 all other files          →  github-sync \"msg\"  (opens a PR)"
echo "                 mixed batch              →  github-sync \"msg\"  (auto-splits)"
echo "    Stage 3d — wait for CI: pnpm --filter @workspace/scripts run check-ci-status"
echo "    Publish  — suggest_deploy, then sentry-baseline mark-published."
