/**
 * sync-github-secrets.ts
 *
 * Pushes the current Replit environment's secret values to GitHub Actions
 * repository secrets using the GitHub REST API with libsodium encryption.
 *
 * This keeps GitHub as an encrypted backup of all application secrets,
 * mirroring how the code in the GitHub repo serves as a backup of Replit.
 * Values are encrypted with the repo's public key before transit — GitHub
 * never sees plaintext, and neither does this process's output.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run sync-github-secrets
 *
 * Requires: GH_PAT in environment (Replit Secrets tab)
 *
 * Exit codes:
 *   0 — all required secrets synced (optional ones may have been skipped)
 *   1 — one or more required secrets were missing from the Replit environment
 */

import sodium from "libsodium-wrappers";

const OWNER = "malwaredevil";
const REPO = "batchelorapp";

// ── Secret registry ───────────────────────────────────────────────────────────
// required: true  → must be set in Replit env; missing = error, not synced
// required: false → sync if present; skip silently with a notice if not set
//
// Excluded (intentionally not backed up to GitHub):
//   DEV_SCREENSHOT_TOKEN  — plain env var (not a Replit secret), Replit-dev-only
//   AGENT_LOGIN_EMAIL     — dev-only test credential
//   AGENT_LOGIN_PASSWORD  — dev-only test credential
//   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE — Replit built-in DB, auto-provisioned per workspace

const SECRETS: Array<{ name: string; purpose: string; required: boolean }> = [
  // ── Database ────────────────────────────────────────────────────────────────
  {
    name: "DATABASE_URL",
    purpose:
      "Supabase PostgreSQL connection string (must point to Supabase, not Replit built-in DB)",
    required: true,
  },
  {
    name: "SUPABASE_URL",
    purpose: "Supabase project URL",
    required: true,
  },
  {
    name: "SUPABASE_ANON_KEY",
    purpose: "Supabase anonymous key",
    required: true,
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    purpose: "Supabase service role key",
    required: true,
  },
  {
    name: "SUPABASE_POOLER_HOST",
    purpose: "Supabase connection pooler host",
    required: true,
  },
  // ── Auth ────────────────────────────────────────────────────────────────────
  {
    name: "SESSION_SECRET",
    purpose: "Express session signing secret",
    required: true,
  },
  {
    name: "OAUTH_TOKEN_ENCRYPTION_KEY",
    purpose: "AES-256-GCM key for stored Google OAuth tokens",
    required: true,
  },
  // ── Google OAuth & APIs ─────────────────────────────────────────────────────
  {
    name: "GOOGLE_CLIENT_ID",
    purpose: "Shared Google OAuth client ID (pottery + quilting + travels)",
    required: true,
  },
  {
    name: "GOOGLE_CLIENT_SECRET",
    purpose: "Shared Google OAuth client secret",
    required: true,
  },
  {
    name: "GOOGLE_MAPS_API_KEY",
    purpose: "Server-side Google Maps API key",
    required: true,
  },
  {
    name: "VITE_GOOGLE_MAPS_API_KEY",
    purpose: "Frontend Google Maps API key (baked in at Vite build time)",
    required: true,
  },
  {
    name: "GOOGLE_WALLET_ISSUER_ID",
    purpose: "Google Wallet issuer ID",
    required: true,
  },
  {
    name: "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
    purpose: "Google Wallet service account JSON",
    required: true,
  },
  // ── AI providers ────────────────────────────────────────────────────────────
  {
    name: "OPENAI_API_KEY",
    purpose: "OpenAI Responses API and owner AI Lab image editing",
    required: true,
  },
  {
    name: "OPENROUTER_API_KEY",
    purpose: "OpenRouter — fallback and broad LLM/AI model gateway",
    required: true,
  },
  {
    name: "JINA_API_KEY",
    purpose: "Jina AI — embeddings + reader API",
    required: true,
  },
  {
    name: "VOYAGE_API_KEY",
    purpose: "Voyage AI — reranking API",
    required: true,
  },
  // ── Email ───────────────────────────────────────────────────────────────────
  {
    name: "RESEND_API_KEY",
    purpose: "Resend email API key",
    required: true,
  },
  {
    name: "RESEND_FROM_EMAIL",
    purpose: "Resend sender address for transactional email",
    required: true,
  },
  {
    name: "RESEND_REMINDER_FROM_EMAIL",
    purpose: "Resend sender address for reminder email",
    required: true,
  },
  // ── Error tracking ──────────────────────────────────────────────────────────
  {
    name: "SENTRY_DSN",
    purpose: "Sentry DSN for server-side error tracking",
    required: true,
  },
  {
    name: "VITE_SENTRY_DSN",
    purpose:
      "Sentry DSN baked into Vite frontends at build time (disables browser tracking if missing at publish)",
    required: true,
  },
  // ── Communications ──────────────────────────────────────────────────────────
  {
    name: "AGENTPHONE_API_KEY",
    purpose: "AgentPhone SMS/voice API key",
    required: true,
  },
  {
    name: "AGENTPHONE_WEBHOOK_SECRET",
    purpose: "AgentPhone webhook HMAC signing secret",
    required: true,
  },
  // ── Automation ──────────────────────────────────────────────────────────────
  {
    name: "APIFY_API_TOKEN",
    purpose: "Apify Actors API token (Hallmark HooH crawler, etc.)",
    required: true,
  },
  {
    name: "APIFY_WEBHOOK_SECRET",
    purpose: "Apify webhook HMAC signing secret",
    required: true,
  },
  // ── Product catalog ─────────────────────────────────────────────────────────
  {
    name: "EBAY_APP_ID",
    purpose: "eBay Finding API application ID",
    required: true,
  },
  {
    name: "EBAY_CERT_ID",
    purpose: "eBay Finding API certificate ID",
    required: true,
  },
  {
    name: "EBAY_DEV_ID",
    purpose: "eBay developer ID",
    required: true,
  },
  // ── GitHub ──────────────────────────────────────────────────────────────────
  {
    name: "GH_PAT",
    purpose: "GitHub Personal Access Token (repo read/write + secrets write)",
    required: true,
  },
  // ── Optional (sync when present; skip with notice when not set) ─────────────
  {
    name: "MICROLINK_API_KEY",
    purpose:
      "Microlink.io paid-tier API key (free tier works without this; upgrades rate limits)",
    required: false,
  },
];

// ── GitHub API helpers ────────────────────────────────────────────────────────

type RepoPublicKey = { key_id: string; key: string };

async function getRepoPublicKey(token: string): Promise<RepoPublicKey> {
  const resp = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/secrets/public-key`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!resp.ok) {
    throw new Error(
      `Failed to fetch repo public key: ${resp.status} ${await resp.text()}`,
    );
  }
  return resp.json() as Promise<RepoPublicKey>;
}

async function upsertSecret(
  token: string,
  keyId: string,
  publicKeyBytes: Uint8Array,
  name: string,
  value: string,
): Promise<void> {
  const encrypted = sodium.crypto_box_seal(
    Buffer.from(value, "utf8"),
    publicKeyBytes,
  );
  const encryptedValue = Buffer.from(encrypted).toString("base64");

  const resp = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/secrets/${name}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId }),
    },
  );
  // 201 = created, 204 = updated — both are success
  if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
    throw new Error(
      `Failed to set secret ${name}: ${resp.status} ${await resp.text()}`,
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const token = process.env["GH_PAT"];
  if (!token) {
    console.error("✗  GH_PAT is not set — cannot authenticate with GitHub API");
    process.exit(1);
  }

  await sodium.ready;

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  Batchelor App — GitHub Secrets Sync                ║`);
  console.log(`║  Target: github.com/${OWNER}/${REPO}      ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);

  let repoKey: RepoPublicKey;
  try {
    repoKey = await getRepoPublicKey(token);
  } catch (err) {
    console.error(`✗  ${err}`);
    process.exit(1);
  }

  const { key_id: keyId, key: publicKeyBase64 } = repoKey;
  const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");

  let synced = 0;
  let skipped = 0;
  const missing: string[] = [];

  for (const { name, purpose, required } of SECRETS) {
    const value = process.env[name];
    if (!value) {
      if (required) {
        console.error(`  ✗  MISSING   ${name}`);
        console.error(`              (${purpose})`);
        missing.push(name);
      } else {
        console.log(`  ⊘  skipped   ${name}  [optional — not set in Replit]`);
        skipped++;
      }
      continue;
    }
    try {
      await upsertSecret(token, keyId, publicKeyBytes, name, value);
      console.log(`  ✓  synced    ${name}`);
      synced++;
    } catch (err) {
      console.error(`  ✗  FAILED    ${name}: ${err}`);
      missing.push(name);
    }
  }

  console.log(`\n──────────────────────────────────────────────────────`);
  console.log(`  Synced:  ${synced} secret(s)`);
  if (skipped > 0) {
    console.log(`  Skipped: ${skipped} optional secret(s) not set in Replit`);
    console.log(
      `           (add them to Replit Secrets + re-run when available)`,
    );
  }
  if (missing.length > 0) {
    console.error(
      `\n  ✗ ${missing.length} required secret(s) could not be synced:`,
    );
    console.error(`    ${missing.join(", ")}`);
    console.error(
      `\n  → Set each missing secret in the Replit Secrets tab, then re-run.`,
    );
    process.exit(1);
  }
  console.log(`\n  ✅  GitHub Actions secrets are now in sync with Replit.\n`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
