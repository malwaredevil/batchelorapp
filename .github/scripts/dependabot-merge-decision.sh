#!/usr/bin/env bash
# Dependabot auto-merge decision script.
# Prints one line to stdout describing the merge decision, then exits.
#
# Output prefixes:
#   merge-security-<GHSA>   — high/critical advisory → auto-merge
#   merge-actions           — GitHub Actions minor/patch bump → auto-merge
#   merge-npm-patch         — single-package npm patch → auto-merge
#   skip-no-ghsa            — GHSA_IDS empty → no security merge
#   skip-ghsa-low-medium    — advisory found but severity < high → skip
#   skip-ghsa-malformed     — all GHSA IDs were invalid format → skip
#   skip-major-actions      — GitHub Actions major bump → manual review
#   skip-grouped-<N>        — N > 1 packages in one PR → manual review
#   skip-update-type-<type> — non-qualifying update type → manual review
#
# Required env vars:
#   ECOSYSTEM            e.g. "github_actions", "npm"
#   UPDATE_TYPE          e.g. "version-update:semver-patch"
#   DEPENDENCY_NAMES     comma-separated, e.g. "actions/checkout" or "zod, react"
#   GHSA_IDS             comma-separated advisory IDs, may be empty
#
# Optional env var for testing only (bypasses live gh api call):
#   SEVERITY_OVERRIDE    e.g. "high" — returned for every GHSA ID looked up

set -euo pipefail

ECOSYSTEM="${ECOSYSTEM:-}"
UPDATE_TYPE="${UPDATE_TYPE:-}"
DEPENDENCY_NAMES="${DEPENDENCY_NAMES:-}"
GHSA_IDS="${GHSA_IDS:-}"

# ---------------------------------------------------------------------------
# 1. High/critical security advisory path
# ---------------------------------------------------------------------------
if [ -n "$GHSA_IDS" ]; then
  FOUND_VALID=false
  for GHSA in $(echo "$GHSA_IDS" | tr ',' '\n' | xargs); do
    # Validate format: GHSA-xxxx-xxxx-xxxx (alphanumeric segments only)
    if [[ ! "$GHSA" =~ ^GHSA-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}$ ]]; then
      echo "note: skipping malformed GHSA ID: $GHSA" >&2
      continue
    fi
    FOUND_VALID=true

    if [ -n "${SEVERITY_OVERRIDE:-}" ]; then
      SEVERITY="$SEVERITY_OVERRIDE"
    else
      SEVERITY=$(gh api "/advisories/$GHSA" --jq '.severity' 2>/dev/null || echo "unknown")
    fi
    echo "note: advisory $GHSA severity: $SEVERITY" >&2

    if [ "$SEVERITY" = "high" ] || [ "$SEVERITY" = "critical" ]; then
      echo "merge-security-$GHSA"
      exit 0
    fi
  done

  if [ "$FOUND_VALID" = "false" ]; then
    echo "skip-ghsa-malformed"
  else
    echo "skip-ghsa-low-medium"
  fi
  exit 0
fi

echo "skip-no-ghsa" >&2

# ---------------------------------------------------------------------------
# 2. Low-risk bump path
# ---------------------------------------------------------------------------
PACKAGE_COUNT=$(echo "$DEPENDENCY_NAMES" | tr ',' '\n' | grep -c .)

# GitHub Actions bumps: auto-merge minor and patch, never major.
if [ "$ECOSYSTEM" = "github_actions" ]; then
  if [ "$UPDATE_TYPE" = "version-update:semver-major" ]; then
    echo "skip-major-actions"
    exit 0
  fi
  echo "merge-actions"
  exit 0
fi

# All other ecosystems: auto-merge only single-package patch bumps.
if [ "$UPDATE_TYPE" = "version-update:semver-patch" ] && [ "$PACKAGE_COUNT" -eq 1 ]; then
  echo "merge-npm-patch"
  exit 0
fi

if [ "$PACKAGE_COUNT" -gt 1 ]; then
  echo "skip-grouped-$PACKAGE_COUNT"
  exit 0
fi

echo "skip-update-type-$UPDATE_TYPE"
