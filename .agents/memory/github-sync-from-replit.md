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

## CI lint gate is intentionally absent
- Root `package.json` has no `lint` script and the repo isn't Prettier-formatted,
  so a required Lint check would be permanently red and block Dependabot
  auto-merge. CI runs Typecheck + Build API server only until a formatting pass is
  done through a normal push flow.
