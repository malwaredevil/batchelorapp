/**
 * One-time migration: encrypt any plaintext OAuth tokens still stored in the
 * three Google OAuth connection tables.
 *
 * Safe to run multiple times — rows whose tokens already start with the v1
 * envelope byte are skipped.
 *
 * IMPORTANT: run this BEFORE deploying the new server code that decrypts
 * tokens on read. After migration, every token in the DB will be encrypted
 * and the server must be able to decrypt them.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run encrypt-oauth-tokens
 *
 * Required env var: OAUTH_TOKEN_ENCRYPTION_KEY (32-byte base64 key, set in
 * Replit Secrets — same value the API server uses at runtime).
 */
import { createCipheriv, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import {
  db,
  travelsGoogleCalendarConnections,
  travelsGmailConnections,
  appGmailConnections,
} from "@workspace/db";

const VERSION = 0x01;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const ENVELOPE_OVERHEAD = 1 + NONCE_LEN + TAG_LEN;

function getKey(): Buffer {
  const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("Missing required env var: OAUTH_TOKEN_ENCRYPTION_KEY");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `OAUTH_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length})`,
    );
  }
  return key;
}

function isEncrypted(value: string): boolean {
  try {
    const buf = Buffer.from(value, "base64");
    return buf.length > ENVELOPE_OVERHEAD && buf[0] === VERSION;
  } catch {
    return false;
  }
}

function encryptToken(plaintext: string): string {
  const key = getKey();
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), nonce, ct, tag]).toString(
    "base64",
  );
}

async function migrateTable<
  TRow extends {
    id: number;
    refreshToken: string;
    accessToken: string | null;
  },
>(
  tableName: string,
  fetchRows: () => Promise<TRow[]>,
  updateRow: (
    id: number,
    refreshToken: string,
    accessToken: string | null,
  ) => Promise<void>,
) {
  const rows = await fetchRows();
  let skipped = 0;
  let migrated = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const refreshAlready = isEncrypted(row.refreshToken);
      const accessAlready =
        row.accessToken == null || isEncrypted(row.accessToken);

      if (refreshAlready && accessAlready) {
        skipped++;
        continue;
      }

      const newRefresh = refreshAlready
        ? row.refreshToken
        : encryptToken(row.refreshToken);
      const newAccess =
        row.accessToken == null || accessAlready
          ? row.accessToken
          : encryptToken(row.accessToken);

      await updateRow(row.id, newRefresh, newAccess);
      migrated++;
      console.log(`  [${tableName}] row ${row.id} encrypted`);
    } catch (err) {
      errors++;
      console.error(
        `  [${tableName}] row ${row.id} FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(
    `  ${tableName}: ${migrated} migrated, ${skipped} already encrypted, ${errors} errors`,
  );
  if (errors > 0) throw new Error(`${errors} row(s) failed in ${tableName}`);
}

async function main() {
  console.log("encrypt-oauth-tokens: starting migration…");

  // Validate key before touching the DB
  getKey();

  await migrateTable(
    "travels_google_calendar_connections",
    () =>
      db
        .select({
          id: travelsGoogleCalendarConnections.id,
          refreshToken: travelsGoogleCalendarConnections.refreshToken,
          accessToken: travelsGoogleCalendarConnections.accessToken,
        })
        .from(travelsGoogleCalendarConnections),
    async (id, refreshToken, accessToken) => {
      await db
        .update(travelsGoogleCalendarConnections)
        .set({ refreshToken, accessToken, updatedAt: new Date() })
        .where(eq(travelsGoogleCalendarConnections.id, id));
    },
  );

  await migrateTable(
    "travels_gmail_connections",
    () =>
      db
        .select({
          id: travelsGmailConnections.id,
          refreshToken: travelsGmailConnections.refreshToken,
          accessToken: travelsGmailConnections.accessToken,
        })
        .from(travelsGmailConnections),
    async (id, refreshToken, accessToken) => {
      await db
        .update(travelsGmailConnections)
        .set({ refreshToken, accessToken, updatedAt: new Date() })
        .where(eq(travelsGmailConnections.id, id));
    },
  );

  await migrateTable(
    "app_gmail_connections",
    () =>
      db
        .select({
          id: appGmailConnections.id,
          refreshToken: appGmailConnections.refreshToken,
          accessToken: appGmailConnections.accessToken,
        })
        .from(appGmailConnections),
    async (id, refreshToken, accessToken) => {
      await db
        .update(appGmailConnections)
        .set({ refreshToken, accessToken, updatedAt: new Date() })
        .where(eq(appGmailConnections.id, id));
    },
  );

  console.log("encrypt-oauth-tokens: migration complete.");
}

main().catch((err) => {
  console.error("encrypt-oauth-tokens: FATAL:", err);
  process.exit(1);
});
