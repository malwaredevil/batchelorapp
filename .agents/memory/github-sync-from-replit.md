---
name: Syncing this repo to GitHub from the Replit main agent
description: How to push changes / set branch protection / manage issues on GitHub when git CLI network ops are sandbox-blocked, plus the CodeQL-on-private-repo limit.
---

# Syncing to GitHub from the Replit main agent

## git CLI is blocked; use the REST API with a PAT

- In the main agent sandbox, `git fetch`, `git push`, and `git commit` are all
  **blocked** ("Destructive git operations are not allowed"). You cannot push
  commits to GitHub via git at all from here.
- The `code_execution` JS notebook does **NOT** receive secret env vars
  (`process.env.GITHUB_PAT` is undefined there). The **bash tool DOES** have
  secrets in its env. So drive the GitHub REST API with `curl` from bash, reading
  `$GITHUB_PAT` from the env — never echo the token.
- To land files on GitHub, use the **Contents API**
  (`PUT /repos/{o}/{r}/contents/{path}` with base64 `content`, plus the existing
  blob `sha` when updating). This bypasses the embedded remote credential.

**Why:** the git remote `github` embeds a `gho_…` OAuth token that lacks the
`workflow` scope, so pushing anything under `.github/workflows/` is rejected.
The user supplies a full-scope PAT in the `GITHUB_PAT` secret for exactly this.

**Caveat — divergence:** Contents-API commits advance GitHub's `main` with commits
the local Replit history doesn't have (and vice-versa for local auto-commits).
Content is usually identical so a later Replit-side sync merges cleanly, but expect
a merge commit; never force-push to "fix" it.

## Multi-file commits: use the Git Data API, not one Contents-API call per file

- For a feature touching many files, build one atomic commit with the **Git Data
  API**: `GET /git/ref/heads/main` → `GET /git/commits/{sha}` for the base tree →
  `POST /git/blobs` per changed file (base64 content) → `POST /git/trees` with
  `base_tree` + the blob entries → `POST /git/commits` with the new tree +
  parent → `PATCH /git/refs/heads/main`. One commit, one message, no per-file
  commit spam.
- Get the changed-file list from `git --no-optional-locks status --porcelain`
  and slice `line[3:]` for the path — slicing `line[2:]` truncates the first
  path's leading character when the status column has no space padding.
- Drive this from `bash` with a `python3 -` heredoc (urllib + subprocess), not
  the `code_execution` notebook — it doesn't see `$GITHUB_PAT`.

## Branch protection must not break the Replit→main flow

- The user pushes **directly to `main`** from the Replit Git pane (Replit = source
  of truth). Set branch protection with **`enforce_admins=false`** so admins bypass
  required checks on direct pushes; otherwise the user can no longer push to main.
- Still safe to enable: `allow_force_pushes=false`, `allow_deletions=false`,
  required status checks for PRs. Required-check **contexts must equal the CI job
  `name:` values** — here `["Typecheck","Build API server"]`.

## CodeQL needs a public repo or GHAS

- `PUT /code-scanning/default-setup` returns **404** on a private repo without
  GitHub Advanced Security. CodeQL can't be enabled until the repo is made public
  (free) or GHAS is purchased. A committed `codeql.yml` would just fail to upload
  results on a private repo, so don't add one as a workaround.

## CI now has a Lint gate, and it's red on ~219 pre-existing files

- A `Lint` job (`pnpm run lint` → `prettier --check .`) was added to CI at some
  point after the "lint gate absent" note above was written — don't trust that
  note, verify current `.github/workflows/*.yml` and `package.json` scripts.
- As of 2026-07-04 the Lint job fails on ~219 pre-existing files repo-wide
  (unrelated to any single feature session) — verified by checking CI runs
  before a session's own commits landed. Don't attempt to silently fix this by
  reformatting the whole repo inside an unrelated feature task; it's a big,
  separate diff. Only format the files you actually touched
  (`npx prettier --write <your files>`) and flag the repo-wide debt to the user
  (tracked as a GitHub issue) instead of doing a mass reformat unprompted.
