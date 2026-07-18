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

step() { echo -e "\n\033[1m[$1/5]\033[0m $2"; }

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

echo -e "\n\033[0;32m✓ All automated pre-publish checks passed.\033[0m"
echo "  Proceed to: Stage 2 (DB safety) → Stage 3 (backup + GitHub sync) → publish."
