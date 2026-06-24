import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";
import { z } from "zod/v4";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();

const PreferencesBody = z.object({
  widgetIds: z.array(z.string()).max(50),
});

router.get("/hub/preferences", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  try {
    const [user] = await db
      .select({ hubWidgetIds: appUsers.hubWidgetIds })
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let widgetIds: string[] | null = null;
    if (user.hubWidgetIds) {
      try {
        const parsed = JSON.parse(user.hubWidgetIds) as unknown;
        if (Array.isArray(parsed)) widgetIds = parsed.filter((x): x is string => typeof x === "string");
      } catch {
        // invalid stored JSON — treat as null (let client use defaults)
      }
    }

    res.json({ widgetIds });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch hub preferences");
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/hub/preferences", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const parsed = PreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  try {
    await db
      .update(appUsers)
      .set({ hubWidgetIds: JSON.stringify(parsed.data.widgetIds) })
      .where(eq(appUsers.id, userId));

    res.json({ widgetIds: parsed.data.widgetIds });
  } catch (err) {
    req.log.error({ err }, "Failed to save hub preferences");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
