import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  bulkUpdateNotificationState,
  getUserNotifications,
  getUnreadCounts,
  getUserPreferences,
  replaceUserPreferences,
  updateNotificationState,
} from "../lib/notifications";

const router = Router();
router.use(requireAuth);

// ── GET /api/notifications/counts ────────────────────────────────────────────

router.get("/counts", async (req, res) => {
  const userId = req.session.userId!;
  const counts = await getUnreadCounts(userId);
  res.json(counts);
});

// ── GET /api/notifications ────────────────────────────────────────────────────

const listQuerySchema = z.object({
  module: z.string().optional(),
  severity: z
    .enum(["informational", "attention", "important", "critical"])
    .optional(),
  unread: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(30),
});

router.get("/", async (req, res) => {
  const userId = req.session.userId!;
  const q = listQuerySchema.parse(req.query);
  const result = await getUserNotifications(userId, q);
  res.json(result);
});

// ── PATCH /api/notifications/:recipientId ─────────────────────────────────────

const updateStateSchema = z.object({
  read: z.boolean().optional(),
  acknowledged: z.boolean().optional(),
  dismissed: z.boolean().optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
});

router.patch("/:recipientId", async (req, res) => {
  const userId = req.session.userId!;
  const recipientId = z.coerce
    .number()
    .int()
    .positive()
    .parse(req.params.recipientId);

  const body = updateStateSchema.parse(req.body);

  const updated = await updateNotificationState(userId, recipientId, body);
  if (!updated) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json(updated);
});

// ── POST /api/notifications/bulk-state ───────────────────────────────────────

const bulkStateSchema = z.object({
  recipientIds: z.array(z.number().int().positive()).max(200),
  action: z.enum(["read", "unread", "dismissed", "acknowledged"]),
});

router.post("/bulk-state", async (req, res) => {
  const userId = req.session.userId!;
  const { recipientIds, action } = bulkStateSchema.parse(req.body);

  const updated = await bulkUpdateNotificationState(
    userId,
    recipientIds,
    action,
  );
  res.json({ updated });
});

// ── GET /api/notifications/preferences ───────────────────────────────────────

router.get("/preferences", async (req, res) => {
  const userId = req.session.userId!;
  const entries = await getUserPreferences(userId);
  res.json({ entries });
});

// ── PUT /api/notifications/preferences ───────────────────────────────────────

const preferenceEntrySchema = z.object({
  scope: z.enum(["global", "module", "event_type"]),
  scopeValue: z.string().nullable().optional(),
  channelInApp: z.boolean().default(true),
  channelEmail: z.boolean().default(false),
  channelSms: z.boolean().default(false),
  channelPush: z.boolean().default(false),
  quietHoursEnabled: z.boolean().default(false),
  quietHoursTimezone: z.string().default("America/New_York"),
  quietHoursStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("22:00"),
  quietHoursEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("08:00"),
  criticalOverride: z.boolean().default(true),
});

const preferencesBodySchema = z.object({
  entries: z.array(preferenceEntrySchema).max(50),
});

router.put("/preferences", async (req, res) => {
  const userId = req.session.userId!;
  const { entries } = preferencesBodySchema.parse(req.body);

  const saved = await replaceUserPreferences(userId, entries);
  res.json({ entries: saved });
});

export default router;
