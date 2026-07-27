/**
 * One-shot script: bootstrap the full schema + storage buckets on the DEV
 * Supabase project.
 *
 * Run this BEFORE activating the dev/prod DB split in resolve-url.ts so the
 * dev Supabase already has all tables when the server first connects to it.
 *
 *   pnpm --filter @workspace/scripts run bootstrap-dev-db
 *
 * Safe to re-run: every STATEMENT is CREATE IF NOT EXISTS / additive-only.
 * Automatically discovers the correct pooler region for the dev project.
 */

import { Pool } from "pg";
import { STATEMENTS, sslConfig } from "@workspace/db";

const DEV_DB_URL = process.env.DEV_DATABASE_URL?.trim();
const DEV_SUPABASE_URL = process.env.DEV_SUPABASE_URL?.trim();
const DEV_SERVICE_KEY = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!DEV_DB_URL) {
  console.error("❌  DEV_DATABASE_URL is not set");
  process.exit(1);
}
if (!DEV_SUPABASE_URL || !DEV_SERVICE_KEY) {
  console.warn(
    "⚠️  DEV_SUPABASE_URL or DEV_SUPABASE_SERVICE_ROLE_KEY not set — skipping bucket provisioning",
  );
}

const POOLER_REGIONS = [
  "us-east-1",
  "us-west-1",
  "eu-west-1",
  "eu-central-1",
  "ap-southeast-1",
  "ap-northeast-1",
  "sa-east-1",
];

/**
 * Try every Supabase pooler region until one accepts the dev project, then
 * return a working connection string. Throws if none of them work.
 */
async function resolvePoolerUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  // Already a pooler URL — normalise port and return.
  if (url.hostname.includes("pooler.supabase.com")) {
    if (url.port === "5432" || url.port === "") url.port = "6543";
    return url.toString();
  }

  // Direct host: db.<ref>.supabase.co — probe each region.
  const m = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  if (!m) return url.toString(); // unknown host, return as-is

  const ref = m[1];
  const password = url.password;

  for (const region of POOLER_REGIONS) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    const candidate = `postgresql://postgres.${ref}:${password}@${host}:6543/postgres`;
    const pool = new Pool({
      connectionString: candidate,
      ssl: sslConfig,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      await pool.end();
      console.log(`  Pooler region: ${region}`);
      return candidate;
    } catch (e: any) {
      // "tenant not found" means wrong region — try next.
      // Any other error might also be transient — keep trying.
      try {
        await pool.end();
      } catch {}
    }
  }

  throw new Error(
    `Could not find a working pooler region for dev project ref "${ref}". ` +
      `The project may be paused or in a non-standard region. ` +
      `Run the bootstrap via the owner panel instead.`,
  );
}

async function bootstrapSchema(poolUrl: string) {
  const pool = new Pool({ connectionString: poolUrl, ssl: sslConfig, max: 2 });
  const client = await pool.connect();
  try {
    let ok = 0;
    let skipped = 0;
    for (const stmt of STATEMENTS) {
      try {
        await client.query(stmt);
        ok++;
      } catch (e: any) {
        if (
          e.code === "42P07" ||
          e.code === "42710" ||
          (e.message as string | undefined)?.includes("already exists")
        ) {
          skipped++;
        } else {
          throw e;
        }
      }
    }
    console.log(`  Schema: ${ok} executed, ${skipped} already existed`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function bootstrapBuckets() {
  if (!DEV_SUPABASE_URL || !DEV_SERVICE_KEY) return;
  const buckets = ["pottery", "quilting", "ornaments", "travels"];
  for (const name of buckets) {
    const res = await fetch(`${DEV_SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEV_SERVICE_KEY}`,
        "Content-Type": "application/json",
        apikey: DEV_SERVICE_KEY,
      },
      body: JSON.stringify({ id: name, name, public: false }),
    });
    const body = (await res.json()) as { error?: string; message?: string };
    if (res.ok) {
      console.log(`  Bucket ${name}: created`);
    } else {
      const msg = body.error ?? body.message ?? res.statusText;
      if (
        msg.toLowerCase().includes("already exists") ||
        msg.toLowerCase().includes("duplicate")
      ) {
        console.log(`  Bucket ${name}: already exists`);
      } else {
        console.warn(`  Bucket ${name}: ${msg}`);
      }
    }
  }
}

(async () => {
  console.log("Bootstrapping dev Supabase…");
  const maskedUrl = DEV_DB_URL!.replace(/:([^:@]+)@/, ":****@").slice(0, 60);
  console.log(`  DB URL: ${maskedUrl}…`);

  console.log("  → Discovering pooler region…");
  const poolUrl = await resolvePoolerUrl(DEV_DB_URL!);

  console.log("  → Running schema statements…");
  await bootstrapSchema(poolUrl);

  console.log("  → Provisioning storage buckets…");
  await bootstrapBuckets();

  console.log("✓ Dev Supabase bootstrap complete.");
})().catch((e) => {
  console.error("Bootstrap failed:", (e as Error).message);
  process.exit(1);
});
