# PR 3 CodeQL diagnostic

Exact check-run metadata and annotations captured from GitHub.

## Original check summary

- name: CodeQL
- status: completed
- conclusion: failure
- details: https://github.com/malwaredevil/batchelorapp/runs/90549060948
- title: 15 new alerts including 15 high severity security vulnerabilities
- summary: The original check reported 15 high-severity missing-rate-limiting alerts in code changed by PR #348.

## Original annotations

- `artifacts/api-server/src/lib/category-router-factory.ts:230` — Missing rate limiting.
- `artifacts/api-server/src/routes/config.ts:23` — Missing rate limiting.
- `artifacts/api-server/src/routes/hub.ts:613` — Missing rate limiting.
- `artifacts/api-server/src/routes/hub.ts:646` — Missing rate limiting.
- `artifacts/api-server/src/routes/messenger/index.ts:12` — Missing rate limiting.
- `artifacts/api-server/src/routes/notifications.ts:18` — Missing rate limiting.
- `artifacts/api-server/src/routes/ornaments/hallmark-events.ts:23` — Missing rate limiting.
- `artifacts/api-server/src/routes/pottery/watchlist.ts:26` — Missing rate limiting.
- `artifacts/api-server/src/routes/quilting/analyses.ts:35` — Missing rate limiting.
- `artifacts/api-server/src/routes/quilting/fabric-identity.ts:28` — Missing rate limiting.
- `artifacts/api-server/src/routes/quilting/lab.ts:30` — Missing rate limiting.
- `artifacts/api-server/src/routes/travels/changes.ts:16` — Missing rate limiting.
- `artifacts/api-server/src/routes/travels/document-evidence.ts:17` — Missing rate limiting.
- `artifacts/api-server/src/routes/travels/monitoring-preferences.ts:8` — Missing rate limiting.
- `artifacts/api-server/src/routes/travels/reservations.ts:23` — Missing rate limiting.

## Remediation

- Added a PostgreSQL-backed, fail-closed API safety-net limiter.
- Mounted it after startup readiness and before the API router.
- Preserved stricter endpoint-specific limiters and skipped health probes.
- Added a source invariant test for middleware ordering and store policy.

## Focused validation

The self-removing remediation workflow completed successfully before publishing commit `fd020e984ca2956615428158304aea4d532c82f5`:

- formatting: passed
- workspace typecheck: passed
- API-server test suite: passed

The repository's normal CI, Guardrails, PR Validation, and CodeQL checks remain authoritative for the final user-authored head commit.
