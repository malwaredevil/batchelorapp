/**
 * verify-github-secrets.ts
 *
 * STOP GATE verification script for Campaign 0A (issue #257).
 *
 * Checks that every required secret is present in the GitHub repository's
 * Actions secrets, AND that a local .env file exists in the repo root.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run verify-github-secrets
 *
 * Requires: GH_PAT in environment (loaded from .env via tsx --env-file=.env)
 *
 * Exit codes:
 *   0 — all checks passed, safe to proceed
 *   1 — one or more checks failed; output lists every failure with remediation
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// ── Required secrets ─────────────────────────────────────────────────────────
// These must be present in GitHub Actions secrets for CI to work correctly.
// Source of truth: replit.md "Secrets checklist" section.
const REQUIRED_GITHUB_SECRETS: Array<{ name: string; purpose: string }> = [
  { name: "DATABASE_URL", purpose: "Supabase PostgreSQL connection" },
  { name: "SUPABASE_URL", purpose: "Supabase project URL" },
  { name: "SUPABASE_ANON_KEY", purpose: "Supabase anonymous key" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", purpose: "Supabase service role key" },
  { name: "SUPABASE_POOLER_HOST", purpose: "Supabase connection pooler host" },
  { name: "SESSION_SECRET", purpose: "Express session signing secret" },
  { name: "GOOGLE_CLIENT_ID", purpose: "Google OAuth client ID" },
  { name: "GOOGLE_CLIENT_SECRET", purpose: "Google OAuth client secret" },
  { name: "GOOGLE_MAPS_API_KEY", purpose: "Server-side Google Maps API" },
  { name: "VITE_GOOGLE_MAPS_API_KEY", purpose: "Frontend Google Maps API" },
  { name: "GOOGLE_WALLET_ISSUER_ID", purpose: "Google Wallet issuer" },
  {
    name: "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
    purpose: "Google Wallet service account",
  },
  { name: "OPENAI_API_KEY", purpose: "OpenAI API key (kept for future use)" },
  {
    name: "OPENROUTER_API_KEY",
    purpose: "OpenRouter — all LLM/AI calls route here",
  },
  { name: "JINA_API_KEY", purpose: "Jina embeddings + reader" },
  { name: "VOYAGE_API_KEY", purpose: "Voyage reranking" },
  { name: "RESEND_API_KEY", purpose: "Resend email API" },
  { name: "RESEND_FROM_EMAIL", purpose: "Resend from address" },
  {
    name: "RESEND_REMINDER_FROM_EMAIL",
    purpose: "Resend reminder from address",
  },
  { name: "SENTRY_DSN", purpose: "Sentry error tracking DSN" },
  { name: "GH_PAT", purpose: "GitHub Personal Access Token" },
  { name: "AGENTPHONE_API_KEY", purpose: "AgentPhone SMS/voice API key" },
  {
    name: "AGENTPHONE_WEBHOOK_SECRET",
    purpose: "AgentPhone webhook HMAC secret",
  },
  { name: "APIFY_API_TOKEN", purpose: "Apify Actors (Campaign 3+ features)" },
];

// ── Local .env required keys ──────────────────────────────────────────────────
// These must be present in the local .env file (superset of GitHub secrets,
// since some dev-only keys are local-only and not in GitHub secrets).
const REQUIRED_ENV_KEYS: string[] = [
  ...REQUIRED_GITHUB_SECRETS.map((s) => s.name),
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function separator(): void {
  console.log("─".repeat(60));
}

function pass(msg: string): void {
  console.log(`  ✓  ${msg}`);
}

function fail(msg: string): void {
  console.error(`  ✗  ${msg}`);
}

function header(msg: string): void {
  console.log(`\n${msg}`);
  separator();
}

// ── Check 1: .env file exists in repo root ────────────────────────────────────

function checkEnvFile(): { ok: boolean; missingKeys: string[] } {
  header("Check 1: Local .env file");

  const envPath = resolve(REPO_ROOT, ".env");
  if (!existsSync(envPath)) {
    fail(`.env file not found at: ${envPath}`);
    console.error("");
    console.error("  To fix: follow the instructions in issue #257");
    console.error("  (extract the env-secrets.zip into the repo root as .env)");
    return { ok: false, missingKeys: REQUIRED_ENV_KEYS };
  }

  pass(`.env file found at repo root`);

  // Parse the .env and check for missing keys
  const content = readFileSync(envPath, "utf8");
  const setKeys = new Set<string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      setKeys.add(trimmed.slice(0, eqIdx).trim());
    }
  }

  const missingKeys = REQUIRED_ENV_KEYS.filter((k) => !setKeys.has(k));
  if (missingKeys.length > 0) {
    fail(`${missingKeys.length} required key(s) missing from .env:`);
    missingKeys.forEach((k) => console.error(`       ${k}`));
    console.error("");
    console.error("  To fix: open .env and fill in each missing value.");
    console.error("  Values are in the Replit Secrets tab.");
    return { ok: false, missingKeys };
  }

  pass(`All ${REQUIRED_ENV_KEYS.length} required keys present in .env`);
  return { ok: true, missingKeys: [] };
}

// ── Check 2: GitHub Actions secrets ──────────────────────────────────────────

async function checkGitHubSecrets(): Promise<{
  ok: boolean;
  missing: string[];
}> {
  header("Check 2: GitHub Actions secrets");

  const token = process.env["GH_PAT"];
  if (!token) {
    fail("GH_PAT not set in environment — cannot verify GitHub secrets");
    console.error(
      "  Ensure GH_PAT is in your .env file and the script is run",
    );
    console.error(
      "  via: pnpm --filter @workspace/scripts run verify-github-secrets",
    );
    return { ok: false, missing: REQUIRED_GITHUB_SECRETS.map((s) => s.name) };
  }

  let repoSecretNames: Set<string>;
  try {
    const resp = await fetch(
      "https://api.github.com/repos/malwaredevil/batchelorapp/actions/secrets?per_page=100",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!resp.ok) {
      const body = await resp.text();
      fail(`GitHub API returned ${resp.status}: ${body.slice(0, 200)}`);
      return {
        ok: false,
        missing: REQUIRED_GITHUB_SECRETS.map((s) => s.name),
      };
    }
    const data = (await resp.json()) as { secrets: Array<{ name: string }> };
    repoSecretNames = new Set(data.secrets.map((s) => s.name));
  } catch (err) {
    fail(`Failed to fetch GitHub secrets: ${err}`);
    return { ok: false, missing: REQUIRED_GITHUB_SECRETS.map((s) => s.name) };
  }

  pass(
    `Connected to GitHub API — ${repoSecretNames.size} secrets currently set`,
  );

  const missing = REQUIRED_GITHUB_SECRETS.filter(
    (s) => !repoSecretNames.has(s.name),
  );

  if (missing.length > 0) {
    fail(`${missing.length} required secret(s) missing from GitHub Actions:`);
    console.error("");
    missing.forEach((s) => {
      console.error(`       ${s.name}`);
      console.error(`         Purpose: ${s.purpose}`);
      console.error(
        `         Add via: GitHub → Settings → Secrets → Actions → New secret`,
      );
      console.error("");
    });
    console.error("  Follow the step-by-step instructions in issue #257.");
    return { ok: false, missing: missing.map((s) => s.name) };
  }

  pass(
    `All ${REQUIRED_GITHUB_SECRETS.length} required secrets present in GitHub Actions`,
  );
  return { ok: true, missing: [] };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  Batchelor App — Campaign 0A: GitHub Secrets Verification");
  console.log("══════════════════════════════════════════════════════════");
  console.log("  Related issue: #257");
  console.log("  Run before: Campaign 1, Campaign 2A, Campaign 2B, Campaign 3");

  const envResult = checkEnvFile();
  const githubResult = await checkGitHubSecrets();

  const allPassed = envResult.ok && githubResult.ok;

  console.log("\n══════════════════════════════════════════════════════════");
  if (allPassed) {
    console.log("  ✅ ALL CHECKS PASSED — safe to proceed with campaign work");
  } else {
    console.error(
      "  ❌ CHECKS FAILED — do not proceed until all issues are resolved",
    );
    console.error("");
    console.error("  1. Complete the manual steps in issue #257");
    console.error(
      "  2. Re-run: pnpm --filter @workspace/scripts run verify-github-secrets",
    );
    console.error("  3. Once this exits with code 0, tell Copilot to continue");
  }
  console.log("══════════════════════════════════════════════════════════\n");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
