import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, travelsMonitoringPreferences } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { z } from "zod";

const router: IRouter = Router();
router.use(requireAuth);

const PrefsSchema = z.object({
  monitoringEnabled: z.boolean().optional(),
  weatherAlerts: z.boolean().optional(),
  checkInReminders: z.boolean().optional(),
  documentReminders: z.boolean().optional(),
  minSeverity: z
    .enum(["informational", "attention", "important", "critical"])
    .optional(),
  notifyChannels: z
    .object({ inApp: z.boolean(), email: z.boolean() })
    .optional(),
  scheduleChangeThresholdMinutes: z.number().int().min(0).max(1440).optional(),
});

// ── GET /monitoring/preferences ───────────────────────────────────────────────
router.get("/monitoring/preferences", async (req, res) => {
  const userId = req.session.userId!;

  const [prefs] = await db
    .select()
    .from(travelsMonitoringPreferences)
    .where(eq(travelsMonitoringPreferences.userId, userId));

  if (!prefs) {
    // Return defaults without inserting — first PUT call will create the row
    return void res.json({
      userId,
      monitoringEnabled: true,
      weatherAlerts: true,
      checkInReminders: true,
      documentReminders: true,
      minSeverity: "attention",
      notifyChannels: { inApp: true, email: false },
      scheduleChangeThresholdMinutes: 30,
    });
  }

  res.json(prefs);
});

// ── PUT /monitoring/preferences ───────────────────────────────────────────────
router.put("/monitoring/preferences", async (req, res) => {
  const userId = req.session.userId!;

  const parsed = PrefsSchema.safeParse(req.body);
  if (!parsed.success)
    return void res.status(400).json({ error: parsed.error.flatten() });

  const [existing] = await db
    .select({ id: travelsMonitoringPreferences.id })
    .from(travelsMonitoringPreferences)
    .where(eq(travelsMonitoringPreferences.userId, userId));

  let prefs;
  if (existing) {
    [prefs] = await db
      .update(travelsMonitoringPreferences)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(travelsMonitoringPreferences.userId, userId))
      .returning();
  } else {
    [prefs] = await db
      .insert(travelsMonitoringPreferences)
      .values({
        userId,
        ...parsed.data,
      })
      .returning();
  }

  res.json(prefs);
});

export default router;
