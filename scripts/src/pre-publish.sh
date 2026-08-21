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
# Step 0: architecture-doc freshness reminder (agent-internal, non-fatal)
# .agents/architecture/ARCHITECTURE.md is the agent's roadmap of routing,
# artifacts, shared libs, and env interactions. It must be updated in the same
# commit as any structural change. Warn if code changed more recently.
# ---------------------------------------------------------------------------
ARCH_DOC=".agents/architecture/ARCHITECTURE.md"
if [ -f "$ARCH_DOC" ]; then
  # Doc is gitignored (.agents/) — use file mtime vs last structural commit.
  DOC_TS=$(stat -c %Y "$ARCH_DOC" 2>/dev/null || echo 0)
  CODE_TS=$(git log -1 --format=%ct -- artifacts lib scripts .replit 2>/dev/null || echo 0)
  DOC_TS=${DOC_TS:-0}
  CODE_TS=${CODE_TS:-0}
  if [ "$CODE_TS" -gt "$DOC_TS" ]; then
    echo -e "${BOLD}⚠ NOTE${RESET}: $ARCH_DOC is older than the latest structural code change."
    echo "  If routing/artifacts/shared-lib/scripts structure changed, update it before publishing."
  fi
else
  echo -e "${RED}⚠${RESET} $ARCH_DOC missing — recreate it (agent architecture roadmap)."
fi

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

# Secrets / credential scan — replaces the old narrow replitmd guard.
# Checks ALL public files (everything github-sync would push) for credential-like
# content: API keys, tokens, project IDs, and env-var literal values.
# Complements pii-scan (which covers email + phone PII).
run_bg secretsscan pnpm --filter @workspace/scripts run check-public-file-secrets

# Upload-limit guard
run_bg uploadlimit pnpm --filter @workspace/scripts run check-upload-limits

# pg Pool/Client singleton guard
run_bg pgsingleton pnpm --filter @workspace/scripts run check-pg-singleton

# Composition-and-configuration architecture guard. CI also runs this, but the
# local pre-publish gate must catch Replit-only drift before it is synced.
run_bg composition pnpm --filter @workspace/scripts run check-domain-composition

# Diff-based guardrail bans (drizzle-kit push, restricted files, ad-hoc OpenAI
# instantiation, passOnStoreError: true, destructive schema SQL, exclusion-set
# shrink). Same script CI's Guardrails workflow calls — see
# scripts/src/check-guardrails.ts — so a violation is caught here first
# instead of only surfacing after a PR is opened.
run_bg guardrails pnpm --filter @workspace/scripts run check-guardrails -- --base origin/main

# Secrets-registry drift guard: checks that every env var in env.ts has a
# matching entry in the sync-github-secrets.ts SECRETS registry.
run_bg secretsregistry pnpm --filter @workspace/scripts run check-secrets-registry

# Hardcoded-config guard: flags new limits/timeouts/budgets/caps/thresholds
# baked into source as literals instead of being owner-adjustable. Same
# script CI's Guardrails workflow calls (diff-scoped against origin/main).
run_bg hardcodedconfig pnpm --filter @workspace/scripts run check-hardcoded-config -- --base origin/main

# Duplicate-code guard: heuristically flags a new/changed function whose
# structure near-exactly matches one that already exists elsewhere in the
# repo (the generic-programming half of composition-and-configuration). Same
# script CI's Guardrails workflow calls (diff-scoped against origin/main).
run_bg duplicatecode pnpm --filter @workspace/scripts run check-duplicate-code -- --base origin/main

# Backup-coverage guard: every pgTable() in lib/db/src/schema/*.ts must appear
# in a copyTable() call in both backup-to-replit.ts and restore-from-replit.ts,
# or be explicitly listed in INTENTIONAL_SKIPS inside check-backup-coverage.ts.
# Catches the recurring class of bug where a new feature table is added to the
# Drizzle schema but the hand-maintained backup/restore scripts are not updated.
run_bg backupcoverage pnpm --filter @workspace/scripts run check-backup-coverage

# GitHub CI status (network-bound — runs in parallel with the local guards)
run_bg cistatus pnpm --filter @workspace/scripts run check-ci-status

# GitHub drift check — detects .github/workflows/ files that GitHub main has
# at a different SHA than local.  Catches Dependabot auto-merges that landed
# on GitHub without a Replit task/Apply-Merge step; running github-sync before
# pulling these back would silently revert the bump.
run_bg githubdrift pnpm --filter @workspace/scripts run check-github-drift

wait

# ---------------------------------------------------------------------------
# Collect results
# ---------------------------------------------------------------------------
echo ""
declare -A LABELS=(
  [appconfig]="App-config drift"
  [forbidden]="Forbidden filenames"
  [secretsscan]="Secrets / credential scan"
  [uploadlimit]="Upload-limit guard"
  [pgsingleton]="pg singleton guard"
  [composition]="Composition and configuration"
  [guardrails]="Guardrail bans (drizzle-kit push, restricted files, etc.)"
  [secretsregistry]="Secrets registry drift"
  [hardcodedconfig]="Hardcoded configuration values (should be owner-adjustable)"
  [duplicatecode]="Likely duplicate code (heuristic structural match)"
  [backupcoverage]="Backup coverage (schema tables vs backup/restore scripts)"
  [cistatus]="GitHub CI status"
  [githubdrift]="GitHub workflow drift (Dependabot auto-merge guard)"
)

FAILED=()
for key in appconfig forbidden secretsscan uploadlimit pgsingleton composition guardrails secretsregistry hardcodedconfig duplicatecode backupcoverage cistatus githubdrift; do
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
echo "  ┌─ 🔴 RED BUTTON — emergency bypass (read once, keep in mind) ────────────────┐"
echo "  │ There is no standing way to skip the PR+CI gate or push straight to main.   │"
echo "  │ If a genuine emergency ever needs that (e.g. a workflow file itself is      │"
echo "  │ broken and blocking every PR from landing), do NOT act unilaterally:        │"
echo "  │ stop and ask the owner directly for one-time explicit permission before     │"
echo "  │ touching branch protection or pushing outside the normal PR flow.           │"
echo "  │ See .agents/memory/emergency-bypass-protocol.md for the full policy.        │"
echo "  └────────────────────────────────────────────────────────────────────────────┘"
echo ""
echo "  ┌─ MANUAL STEPS (in order) ──────────────────────────────────────────────────┐"
echo "  │ Stage 1a  — Visual verification (NON-SKIPPABLE):                           │"
echo "  │   Screenshot every page touched this session + the hub homepage.           │"
echo "  │   Method 1 (canonical — works without registered artifacts):               │"
echo "  │     pnpm --filter @workspace/scripts run check-agent-screenshot-access     │"
echo "  │     TOKEN=\$(pnpm --filter @workspace/scripts run print-agent-screenshot-token --silent | tail -1) │"
echo "  │     DOMAIN=\$REPLIT_DEV_DOMAIN                                              │"
echo "  │     Screenshot({ type:'externalUrl',                                       │"
echo "  │       url:\`https://\${DOMAIN}/<path>?screenshotToken=\${TOKEN}\` })           │"
echo "  │   Paths: / /modules/pottery /modules/quilting /modules/travels             │"
echo "  │          /modules/ornaments /modules/office /elaine/ /owner-panel          │"
echo "  │   Broken image visible? It is a real bug. Fix before continuing.           │"
echo "  │                                                                             │"
echo "  │ Stage 1b  — Sentry issue triage (REQUIRED — must happen before sync):      │"
echo "  │              Use mcpSentry_searchIssues to list all unresolved issues.      │"
echo "  │              Every issue must receive an explicit disposition:              │"
echo "  │                resolved / resolvedInNextRelease / ignored (with reason)     │"
echo "  │              Record remaining open IDs:                                     │"
echo "  │                sentry-baseline write <count> <comma-ids>                   │"
echo "  │ Stage 1c  — Security scan (REQUIRED — must happen before sync):            │"
echo "  │              Run runDependencyAudit(), runSastScan(), runHoundDogScan()    │"
echo "  │              (see .local/skills/security-scan/SKILL.md).                   │"
echo "  │              Every finding needs an explicit disposition: fix it for real, │"
echo "  │              or if it's a known accepted pattern, add/update the matching  │"
echo "  │              entry in .local/scanner-context.txt so it stops re-surfacing. │"
echo "  │ Stage 2   — DB safety: additive-only migrations, no DROP/RENAME.           │"
echo "  │ Stage 3a  — backup: pnpm --filter @workspace/scripts run backup-to-replit  │"
echo "  │ Stage 3b  — open PR review + branch hygiene (REQUIRED every time):          │"
echo "  │   List:  GET /repos/malwaredevil/batchelorapp/pulls?state=open&per_page=100│"
echo "  │   • Dependabot, CI green → merge (squash) immediately.                     │"
echo "  │   • sync/… PR superseded by a later merge → CLOSE + delete its branch.    │"
echo "  │     (Compare: GET /repos/.../compare/main...{head-sha} → status=behind)    │"
echo "  │   • Human/bot PR already fixed → CLOSE with explanation.                   │"
echo "  │   Confirm only 'main' branch remains after handling all PRs:               │"
echo "  │     GET /repos/malwaredevil/batchelorapp/branches?per_page=100             │"
echo "  │   Delete any stale branch:                                                  │"
echo "  │     DELETE /repos/malwaredevil/batchelorapp/git/refs/heads/{name}          │"
echo "  │ Stage 3b.5 — pull GitHub-only changes back to local (REQUIRED before sync):│"
echo "  │   Dependabot auto-merges land on GitHub without a Replit task merge.       │"
echo "  │   Always pull before github-sync to avoid silently reverting them:         │"
echo "  │     pnpm --filter @workspace/scripts run pull-from-github                  │"
echo "  │   Review any files written, include them in your sync commit message.      │"
echo "  │   (If no drift: '✓ No drift detected' — safe to proceed immediately.)     │"
echo "  │ Stage 3c  — GitHub sync (all files go through a PR — no exceptions):       │"
echo "  │              github-sync \"msg\"                  opens the PR as a DRAFT    │"
echo "  │              github-sync \"msg\" --confirm-deletions  include local deletions │"
echo "  │              Draft PRs only run the fast/cheap checks — the heavy suite    │"
echo "  │              (E2E, codegen-drift, elaine-capability-parity) is gated to    │"
echo "  │              skip until the PR is Ready for review.                        │"
echo "  │ Stage 3c2 — Bot review loop (REQUIRED — treat every Copilot comment as a    │"
echo "  │              validation that must pass before merging):                    │"
echo "  │                                                                             │"
echo "  │   Step A — apply inline suggestion blocks:                                 │"
echo "  │              pnpm --filter @workspace/scripts run apply-pr-suggestions      │"
echo "  │              Commits safe Copilot/CodeQL-Autofix diff-block suggestions.   │"
echo "  │                                                                             │"
echo "  │   Step B — wait for Copilot's full review to finish (it is async):        │"
echo "  │              Poll GET /repos/.../pulls/:pr/reviews until a review from     │"
echo "  │              'copilot-pull-request-reviewer[bot]' has state=COMMENTED or   │"
echo "  │              APPROVED (not just 'PENDING'). Allow up to ~3 minutes.        │"
echo "  │                                                                             │"
echo "  │   Step C — address every inline comment (NO exceptions):                  │"
echo "  │              GET /repos/.../pulls/:pr/comments (filter bot authors)        │"
echo "  │              For each comment, choose ONE of:                              │"
echo "  │                [FIX]    Implement the suggestion, push a follow-up commit. │"
echo "  │                [SKIP]   Explain concisely why it does not apply here.      │"
echo "  │              Then POST a reply to the comment via:                         │"
echo "  │                POST /repos/.../pulls/comments/:id/replies                  │"
echo "  │              with the decision + rationale (1-3 sentences).                │"
echo "  │              A pushed follow-up resets CI — loop back to Stage 3d.         │"
echo "  │                                                                             │"
echo "  │   Step D — after all comments are replied to, confirm none were missed:   │"
echo "  │              Re-fetch comments, verify every bot comment id has a reply.   │"
echo "  │                                                                             │"
echo "  │   Step E — resolve every bot review thread via GitHub GraphQL (REQUIRED   │"
echo "  │              before merging — GitHub branch protection blocks merge until  │"
echo "  │              all conversations are resolved):                              │"
echo "  │              1. GET thread IDs:                                            │"
echo "  │                 POST /graphql query reviewThreads on the PR                │"
echo "  │              2. Resolve each unresolved thread:                            │"
echo "  │                 POST /graphql mutation resolveReviewThread(threadId)       │"
echo "  │              3. Confirm PR merge is no longer blocked before proceeding.   │"
echo "  │ Stage 3d  — wait for Draft-stage CI: check-ci-status                       │"
echo "  │              Green here = fast checks passed, NOT merge-ready yet.         │"
echo "  │ Stage 3d.5 — promote once Draft checks are green:                          │"
echo "  │              pnpm --filter @workspace/scripts run promote-pr-ready          │"
echo "  │              Re-verifies CI itself before promoting (won't skip ahead on   │"
echo "  │              a stale/failing check). This triggers the heavy suite.        │"
echo "  │              Then re-run check-ci-status and wait for that to go green too.│"
echo "  │ Stage 3d2 — merge PR, delete its head branch.                              │"
echo "  │ Stage 3e  — security scan (GitHub):                                        │"
echo "  │              Dependabot:    GET /repos/.../dependabot/alerts?state=open     │"
echo "  │              Code scanning: GET /repos/.../code-scanning/alerts?state=open  │"
echo "  │              Secret scan:   GET /repos/.../secret-scanning/alerts?state=open│"
echo "  │              Fix or dismiss every open finding before publishing.           │"
echo "  │ Stage 3f  — sync GitHub secrets (REQUIRED — keeps Actions runtime in sync):│"
echo "  │              pnpm --filter @workspace/scripts run sync-github-secrets       │"
echo "  │              All required secrets must show ✓. Fix missing ones first.     │"
echo "  │ Publish   — suggest_deploy, then sentry-baseline mark-published.           │"
echo "  │ Stage 4   — post-publish Sentry delta (~5 min after deploy):               │"
echo "  │              compare new issues against baseline IDs, fix regressions,     │"
echo "  │              then sentry-baseline clear.                                   │"
echo "  └────────────────────────────────────────────────────────────────────────────┘"
