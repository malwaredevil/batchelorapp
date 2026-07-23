# GitHub Secret Scanning & PII Protection

This document describes the layered PII and credential protection in place for
`malwaredevil/batchelorapp` (a public repository).

## Active protections (as of July 2026)

| Layer                             | Status                          | What it catches                                                                                                                                                                        |
| --------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub native secret scanning** | ✅ Enabled                      | ~200 known provider credential patterns (API keys, tokens, OAuth secrets, etc.) — scans the full commit history and all branches                                                       |
| **GitHub push protection**        | ✅ Enabled                      | Blocks pushes containing detected secrets at the GitHub layer, before they land on `main`; shows a bypass UI for confirmed false-positives                                             |
| **CI `pii-scan` job**             | ✅ Runs on every PR + push      | Scans all non-excluded source files for email addresses not in the `SAFE_DOMAINS` allowlist; catches household email addresses that wouldn't match a known-provider credential pattern |
| **CI provisioning-script guard**  | ✅ Runs on every PR + push      | Blocks files named `add-user.*`, `seed-users.*`, `create-accounts.*`, etc. — these commonly contain hardcoded household emails/passwords                                               |
| **Pre-publish gate**              | ✅ Required before every deploy | Runs `pii-scan` and all CI checks locally before any GitHub sync, providing a local backstop independent of GitHub                                                                     |

## Why custom secret-scanning patterns are not configured

GitHub's custom secret-scanning patterns (for project-specific regexes, such as
matching a specific email domain) require **GitHub Advanced Security (GHAS)**,
which is only available on GitHub Enterprise or via a paid GitHub plan. This repo
is on the free tier, so the custom-patterns REST API endpoint returns
`Feature not available in this repository`.

The CI `pii-scan` job (`scripts/src/pii-scan.ts`) fills this gap: it flags any
email address whose domain is not in `SAFE_DOMAINS`, which covers household email
domains precisely — without storing the actual domain in a regex committed to the
public repo.

## Path exclusions

`.github/secret_scanning.yml` lists paths excluded from GitHub's native scanner
(lockfiles, build output, test fixtures). This reduces false-positive noise so
that real findings are not buried.

## If GHAS becomes available

If this repo is ever moved to GitHub Enterprise or a plan that includes GHAS,
custom patterns can be added via:

```
POST /repos/malwaredevil/batchelorapp/secret-scanning/custom-patterns
```

A useful pattern at that point would be a regex matching the household's personal
email domain(s) — using a partial or hashed form, **never the raw full address**.
The `SAFE_DOMAINS` set in `scripts/src/pii-scan.ts` is the authoritative list of
what is _allowed_; any domain not in that list is a candidate for a custom pattern.
