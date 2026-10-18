# Local privacy-dataflow scanning

The release pipeline uses the official HoundDog **3.11.0 Linux AMD64 standalone
scanner**, independently of Replit's `runHoundDogScan` integration. The local CLI
was verified to run without a vendor account, cloud API key, Docker, or optional
AI review. This is the vendor's proprietary free local scanner, not open-source
software. See [pricing](https://hounddog.ai/pricing/) and
[installation](https://docs.hounddog.ai/scanner/).

## Commands

```sh
pnpm --filter @workspace/scripts run privacy:install
pnpm --filter @workspace/scripts run privacy:test
pnpm --filter @workspace/scripts run privacy:scan
# Explicit investigation mode, not a replacement for the release gate:
pnpm --filter @workspace/scripts run privacy:scan -- --report-only
```

Installation is automatic on the first scan. The official archive SHA-256 is
pinned in `hounddog-tool.ts`; the extracted executable is verified both on install
and every reuse. It lives under ignored `.local/tools/hounddog/`. No npm dependency
or application runtime dependency is added.

## Isolation and scope

Each run creates a source-only snapshot of tracked and nonignored untracked
TypeScript, TSX, JavaScript, JSX, MJS, CJS and SQL files, reusing the existing
public-file policy. That policy excludes tests, internal directories and known
generated outputs. Publishable Apify actor source is explicitly included despite
the older PII scanner's whole-actor exclusion. Environment files, symlinks, storage uploads and databases
are not scanned. HoundDog may independently skip generated source files.

The child receives a fresh isolated home/config and a minimal environment, not
the app's credentials or HoundDog/AI cloud configuration. AI review is explicitly
disabled. No source/results upload is configured. Do not add an API key or optional
AI integration without separately approving the resulting source-data sharing.

A known-leak TypeScript canary must detect a password and email sent to stdout
before any repository result is accepted. Application and actor directories are
mapped to scanner-visible names because the vendor ignores `artifacts/` by default.
Every application/actor root also receives its own temporary positive probe
(TSX where applicable), and real application occurrences must be observed.
Only exact temporary probe findings are removed from release findings; real
finding locations are mapped back to repository paths. Staged file counts alone
are never proof that files were analyzed. Source fingerprints detect edits during
the scan. Every JSON report is schema-checked against the pinned scanner contract.

## Exit status and release policy

The native scanner exits **0 even when it detects critical leaks**. Our wrapper
therefore examines the report:

- **0:** completed scan, no critical/medium dataflows. Low/info flows stay visible.
- **1:** critical/medium findings require review; pre-publishing/CI blocks.
- **2:** scanner/install/canary/schema failure. Coverage unavailable, never clean.
- `--report-only` keeps scan failures blocking but allows completed scans containing
  findings for investigation. It is not used by pre-publishing or CI.

Do not automatically baseline or suppress initial findings. Inspect code and fix
actual exposures. Legitimate data handling is not automatically a vulnerability;
any future exception must be narrow, justified, and explicitly reviewed.

The pre-publishing gate, the Privacy dataflow scan CI job (including Draft PRs),
and the dedicated local `privacy` validation use the same wrapper. Normal secret,
PII, dependency, static-code and CodeQL checks remain separate.

## Reports and limits

`generated-artifacts/security/hounddog/latest.json` contains the full raw report.
`summary.json` records severity counts, source fingerprint, scope size and finding
locations without snippets. Both are local-only, private-mode files, excluded from
Git and deployment. CI prints only counts and blocking locations; it does **not**
upload reports as public artifacts. Failed scans invalidate old success summaries.

A successful static scan is not proof of privacy compliance or complete coverage.
This restores a working local path; it does not repair Replit's built-in scanner
or guarantee identical findings between scanner versions. It scans source, not
production database contents or Git history.

## Upgrades

Review the official release, update the pinned version and archive/binary hashes,
and retest schema handling, canary detection, fixture exclusions and real source
scanning. Do not switch automatically to a floating latest release or ignore a
checksum mismatch. The native binary's bundled dependencies are not covered by
`pnpm audit`.
