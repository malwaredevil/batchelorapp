import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

const UpdateSettingsBody = z.object({
  reminderEmail: z.email().nullable(),
});

// GET /api/travels/users — app_users' emails, for picking reminder recipients
router.get("/users", async (_req, res) => {
  const rows = await db
    .select({ id: appUsers.id, email: appUsers.email })
    .from(appUsers)
    .orderBy(appUsers.email);

  res.json(rows);
});

// GET /api/travels/settings
router.get("/settings", async (req, res) => {
  const userId = req.session.userId!;
  const [user] = await db
    .select({ travelsReminderEmail: appUsers.travelsReminderEmail })
    .from(appUsers)
    .where(eq(appUsers.id, userId));

  res.json({ reminderEmail: user?.travelsReminderEmail ?? null });
});

// PUT /api/travels/settings
router.put("/settings", async (req, res) => {
  const userId = req.session.userId!;
  const body = UpdateSettingsBody.parse(req.body);

  await db
    .update(appUsers)
    .set({ travelsReminderEmail: body.reminderEmail })
    .where(eq(appUsers.id, userId));

  res.json({ reminderEmail: body.reminderEmail });
});

export default router;
