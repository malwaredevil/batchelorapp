# MERGE_HANDOFF — Prompt for Pottery and Quilting Replit Agents

Paste this prompt verbatim into **each** of the two Replit apps (pottery and quilting).
Run it in each app's Replit Agent separately.

---

## PROMPT (paste into each app's Replit Agent)

> You are helping produce a handoff manifest so this app can be safely merged into a combined
> pnpm monorepo. Please do the following steps IN ORDER. Do not skip any step.
>
> ### STEP 1 — Commit and push ALL uncommitted changes to GitHub
>
> This is critical: the merge will use GitHub as its source of truth.
>
> 1. Run `git status` to list every uncommitted or untracked file.
> 2. Stage everything: `git add -A`
> 3. Commit: `git commit -m "chore: sync all changes before monorepo merge handoff"` (skip
>    if there is nothing to commit, but explicitly confirm that in your response).
> 4. Push to the main branch: `git push origin main` (or master if that is the default).
> 5. Confirm the push succeeded and the remote is up to date.
>
> **Never commit secret values, API keys, passwords, connection strings with credentials,
> or .env files in this step.**
>
> ### STEP 2 — Create MERGE_HANDOFF.md and commit it
>
> Create a file named `MERGE_HANDOFF.md` in the repo root. Populate it with all of the
> following. Use ONLY non-secret information — never include the VALUE of any secret,
> API key, password, or connection string. Key NAMES only.
>
> #### Section A — Secret key names
>
> List every Secret key name that is configured in this Repl's Secrets panel.
> For each key name, note:
> - Whether it is set in **development** (this Repl) only, or also on the live
>   **deployment** (production) — check the Repl's Secrets tab and also check the
>   Deployment's Secrets/Config if available.
> - If a key is missing from the deployment that you expect to be there, flag it.
>
> Example format (names only, no values):
> ```
> SUPABASE_URL              — dev ✓  production ✓
> OPENAI_API_KEY            — dev ✓  production ✓
> SOME_MISSING_KEY          — dev ✓  production ✗ (MISSING from deployment)
> ```
>
> #### Section B — Supabase project
>
> - Report the Supabase project ref — this is just the subdomain portion of SUPABASE_URL.
>   For example, if SUPABASE_URL is `https://abcxyz.supabase.co`, report `abcxyz`.
>   Do NOT include the service role key or any credentials.
> - List all Supabase Storage bucket names this app uses.
> - Confirm whether the `vector` (pgvector) extension is enabled in the database.
>   Run: `SELECT extname FROM pg_extension WHERE extname = 'vector'` (or check
>   Supabase dashboard > Database > Extensions).
>
> #### Section C — Google OAuth
>
> - Report the last 6 characters of GOOGLE_CLIENT_ID (to confirm both apps share the
>   same OAuth client).
> - List the exact authorized redirect URIs and JavaScript origins currently registered
>   for this app in Google Cloud Console (these are non-secret). If you cannot see the
>   Google Cloud Console, report the redirect URI that the code constructs at runtime
>   (check `artifacts/api-server/src/routes/auth.ts` for the `googleCallbackUrl`
>   function or similar).
>
> #### Section D — Deployment
>
> - Deployment type (autoscale, reserved, etc.)
> - Custom domain(s) attached to the live deployment (e.g. pottery.batchelor.app)
> - The Replit deployment subdomain (e.g. xxx.replit.app) if known
> - Build command and run command as configured in the deployment
> - Any environment variables set at the deployment level that differ from the dev Repl
>
> #### Section E — Scheduled jobs and background tasks
>
> - List any cron jobs, scheduled deployments, or background tasks configured for this
>   app (in .replit, deployment config, or external schedulers).
> - If none, explicitly state "none".
>
> #### Section F — Database snapshot (read-only)
>
> Run these read-only queries and paste the results:
>
> ```sql
> -- Row counts for all tables this app owns
> SELECT tablename,
>        (SELECT count(*) FROM information_schema.columns
>         WHERE table_name = t.tablename
>           AND table_schema = 'public') AS column_count
> FROM pg_tables t
> WHERE schemaname = 'public'
> ORDER BY tablename;
> ```
>
> And for each table: `SELECT count(*) FROM <tablename>;`
>
> #### Section G — Anything not reproducible from a fresh clone
>
> - Any manual configuration steps taken inside Replit (port forwarding, run commands,
>   .replit edits) that are NOT reflected in the committed `.replit` file.
> - Any data or configuration that lives only in the Repl's filesystem (outside of git).
> - Any third-party service configurations (email domain verification in Resend,
>   authorized domains in Supabase Auth, etc.) that are not captured in code.
> - Any differences between what is in this app's GitHub repo and what is actually
>   running right now (e.g. features built but not yet pushed).
>
> #### Section H — .replit file contents
>
> Paste the full contents of the `.replit` file currently on disk (run `cat .replit`).
> This may differ from what is in GitHub.
>
> ### STEP 3 — Commit and push MERGE_HANDOFF.md
>
> ```bash
> git add MERGE_HANDOFF.md
> git commit -m "chore: add MERGE_HANDOFF.md for monorepo merge"
> git push origin main
> ```
>
> Confirm the push succeeded.
>
> ### STEP 4 — Confirm completion
>
> Reply with:
> - "HANDOFF COMPLETE for [app name]"
> - A summary of anything unusual, unexpected, or that you were unable to determine.
> - Any warnings or concerns about the merge that you noticed while doing this.
