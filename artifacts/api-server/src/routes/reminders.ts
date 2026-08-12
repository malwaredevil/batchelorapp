import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, appUsers, reminders } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Generic, entity-agnostic reminder creation (issue #522, EPIC #511).
//
// This is deliberately separate from routes/travels/reminders.ts (which is
// nested under /trips/:tripId and always sets entityType = "travels_trip")
// and from elaine/reminder-actions.ts's create_reminder (Elaine's
// natural-language tool, always entityType = null). This route is the one
// generic HTTP entry point for the "bell icon" reminder action added to the
// shared collection-ui detail-view components and to Office Notes / Travel
// Wishlist directly (issue #523) — any record type in the app can be the
// entityType/entityId target.
//
// Scope is intentionally minimal: title, optional description (rich-text
// HTML from the shared editor, same convention as every other reminder),
// and an optional due date. Recipients always default to the creating
// user's own messenger inbox only — matching create_reminder's default —
// since the full recipient/channel/recurrence editing surface belongs to
// the central Reminders page (issue #524), not this quick-create dialog.
// ---------------------------------------------------------------------------

const router: IRouter = Router();
router.use(requireAuth);

const CreateReminderBody = z.object({
  entityType: z.string().min(1).max(50),
  entityId: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  // ISO datetime string. Omit for a bare reminder with no due date (visible
  // only on the central Reminders page / entity's own reminder list until
  // one is set there).
  dueAt: z.string().datetime().optional(),
});

router.post("/", async (req, res) => {
  const parsed = CreateReminderBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: z.prettifyError(parsed.error) });
  }
  const userId = req.session.userId!;
  const { entityType, entityId, title, description, dueAt } = parsed.data;

  const [user] = await db
    .select({ email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.id, userId));

  const [row] = await db
    .insert(reminders)
    .values({
      entityType,
      entityId,
      createdByUserId: userId,
      title,
      description: description ?? null,
      dueAt: dueAt ? new Date(dueAt) : null,
      leadTimes: dueAt ? [{ value: 0, unit: "minutes" }] : [],
      messengerRecipientUserIds: [userId],
    })
    .returning();

  logger.info(
    { reminderId: row?.id, entityType, entityId, userId },
    "reminders: created entity-scoped reminder",
  );

  return res.status(201).json({ reminder: row });
});

export default router;
