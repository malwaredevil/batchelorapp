import { db, elaineGlobalConfig } from "@workspace/db";
import { logger } from "./logger";

/**
 * Global, admin-configurable settings for Elaine's AI behaviour. Distinct
 * from the per-user `elaine_settings` table (enabled/confirmation mode) —
 * this is a single row (id=1) that applies to every user across every app
 * surface, editable only by the app owner via /api/elaine/admin/config.
 */
export interface ElaineGlobalConfig {
  chatModel: string;
  subagentModel: string;
  requestTimeoutMs: number;
  maxResponseTokens: number;
}

const DEFAULTS: ElaineGlobalConfig = {
  chatModel: "google/gemini-2.5-flash",
  subagentModel: "z-ai/glm-5.2",
  requestTimeoutMs: 12_000,
  maxResponseTokens: 700,
};

// Short in-memory cache so every chat turn doesn't hit the DB, but an admin
// edit takes effect within a few seconds without needing a server restart.
const CACHE_TTL_MS = 30_000;
let cached: { value: ElaineGlobalConfig; expiresAt: number } | null = null;

export async function getElaineGlobalConfig(): Promise<ElaineGlobalConfig> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  let value: ElaineGlobalConfig = DEFAULTS;
  try {
    const [row] = await db.select().from(elaineGlobalConfig).limit(1);
    if (row) {
      value = {
        chatModel: row.chatModel,
        subagentModel: row.subagentModel,
        requestTimeoutMs: row.requestTimeoutMs,
        maxResponseTokens: row.maxResponseTokens,
      };
    }
  } catch (err) {
    logger.error(
      { err },
      "Failed to load elaine_global_config, falling back to defaults",
    );
    value = DEFAULTS;
  }
  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function invalidateElaineGlobalConfigCache(): void {
  cached = null;
}
