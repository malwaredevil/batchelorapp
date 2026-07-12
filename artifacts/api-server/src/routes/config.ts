import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import {
  getAllConfig,
  getConfigRow,
  getBootstrappedAt,
  getBootstrapRetryAt,
  getBootstrapStatus,
  updateConfigValue,
  validateConfigValue,
  APP_CONFIG_DEFAULTS,
} from "../lib/app-config";
import { logger } from "../lib/logger";

const DEFAULT_MAP = new Map(
  APP_CONFIG_DEFAULTS.map((d) => [`${d.module}::${d.key}`, d]),
);

const router = Router();

router.use(requireAuth);

function withDefaults(rows: Awaited<ReturnType<typeof getAllConfig>>): ({
  defaultValue: string | null;
  orphaned: boolean;
} & (typeof rows)[number])[] {
  return rows.map((r) => {
    const def = DEFAULT_MAP.get(`${r.module}::${r.key}`);
    const orphaned = def === undefined;
    if (orphaned) {
      // This should not happen after bootstrap prunes stale rows, but emit a
      // warning so it is visible in logs if it ever slips through (e.g. during
      // a deployment where bootstrap has not yet run after a key rename).
      logger.warn(
        { module: r.module, key: r.key },
        "app-config: DB row has no matching APP_CONFIG_DEFAULTS entry — label may be stale",
      );
    }
    return {
      ...r,
      // Always surface the current label/description from APP_CONFIG_DEFAULTS
      // so the Control Panel shows up-to-date text even when the DB row was
      // seeded with an older label before a rename. Falls back to the stored
      // DB value for rows that have no matching default (shouldn't happen in
      // practice, but safe to guard).
      label: def?.label ?? r.label,
      description: def?.description ?? r.description,
      defaultValue: def?.value ?? null,
      orphaned,
    };
  });
}

/**
 * GET /api/config
 * Returns all configurable key/value rows. Visible to any authenticated user
 * so the admin UI can show current values, and future read-only consumers
 * (e.g. client-side page-size defaults) can fetch them.
 */
router.get("/", async (_req, res) => {
  const config = withDefaults(await getAllConfig());
  res.json({
    config,
    bootstrappedAt: getBootstrappedAt()?.toISOString() ?? null,
    bootstrapStatus: getBootstrapStatus(),
    bootstrapRetryAt: getBootstrapRetryAt()?.toISOString() ?? null,
  });
});

/**
 * GET /api/config/:module
 * Returns config rows for a single module. Convenient for module-specific
 * settings pages that only need their own subset.
 */
router.get("/:module", async (req, res) => {
  const { module } = req.params as { module: string };
  const config = withDefaults(await getAllConfig(module));
  res.json({
    config,
    bootstrappedAt: getBootstrappedAt()?.toISOString() ?? null,
    bootstrapStatus: getBootstrapStatus(),
    bootstrapRetryAt: getBootstrapRetryAt()?.toISOString() ?? null,
  });
});

/**
 * PUT /api/config/:module/:key
 * Overwrite a config value. Restricted to isOwner accounts.
 */
router.put("/:module/:key", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [me] = await db
    .select({ isOwner: appUsers.isOwner })
    .from(appUsers)
    .where(eq(appUsers.id, userId));

  if (!me?.isOwner) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const { module, key } = req.params as { module: string; key: string };
  const { value } = req.body as { value?: unknown };

  if (typeof value !== "string") {
    res.status(400).json({ error: "value must be a string" });
    return;
  }

  const existing = await getConfigRow(module, key);
  if (!existing) {
    res.status(404).json({ error: "Config key not found" });
    return;
  }

  const typeError = validateConfigValue(
    existing.type as "string" | "integer" | "float" | "boolean",
    value,
  );
  if (typeError) {
    res.status(400).json({ error: typeError });
    return;
  }

  const row = await updateConfigValue(module, key, value);
  if (!row) {
    res.status(404).json({ error: "Config key not found" });
    return;
  }

  logger.info({ module, key, value }, "app-config: value updated by owner");
  const def = DEFAULT_MAP.get(`${module}::${key}`);
  res.json({
    config: {
      ...row,
      label: def?.label ?? row.label,
      description: def?.description ?? row.description,
      defaultValue: def?.value ?? null,
      orphaned: def === undefined,
    },
  });
});

export default router;
