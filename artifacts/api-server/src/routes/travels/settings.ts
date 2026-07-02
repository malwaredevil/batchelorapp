import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { sendReminderAlertEmail, resendConfigured } from "../../lib/email";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

const UpdateSettingsBody = z.object({
  reminderEmail: z.email().nullable(),
});

// GET /api/travels/users — app_users' emails, for picking reminder recipients
router.get("/users", async (_req, res) => {
  const rows = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      displayName: appUsers.displayName,
    })
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

// POST /api/travels/settings/test-email — sends a real test reminder email
// to the logged-in user's own account address, for verifying Resend/domain
// setup without waiting for a real reminder to come due.
router.post("/settings/test-email", async (req, res) => {
  if (!resendConfigured()) {
    res.status(400).json({
      error:
        "Email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL first.",
    });
    return;
  }

  const userId = req.session.userId!;
  const [user] = await db
    .select({ email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.id, userId));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 3);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  try {
    await sendReminderAlertEmail(
      user.email,
      "Test reminder",
      "Sample Trip",
      "Somewhere Nice",
      "3_day",
      dueDateStr,
    );
    res.json({ sent: true, to: user.email });
  } catch (err) {
    logger.error({ err, userId }, "settings: test reminder email failed");
    res.status(502).json({
      error:
        err instanceof Error
          ? err.message
          : "Failed to send test email. Check your Resend configuration.",
    });
  }
});

export default router;
