import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, travelsCalendarSettings } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  isGoogleCalendarConnected,
  listGoogleCalendars,
} from "../../lib/google-calendar";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

async function getSettingsRow() {
  const [row] = await db.select().from(travelsCalendarSettings).limit(1);
  return row ?? null;
}

// GET /calendar/status — connection + currently-chosen family calendar
router.get("/calendar/status", async (_req, res) => {
  const [connected, settings] = await Promise.all([
    isGoogleCalendarConnected(),
    getSettingsRow(),
  ]);

  res.json({
    connected,
    calendarId: settings?.calendarId ?? null,
    calendarSummary: settings?.calendarSummary ?? null,
  });
});

// GET /calendar/list — calendars available on the connected Google account
router.get("/calendar/list", async (_req, res) => {
  try {
    const calendars = await listGoogleCalendars();
    res.json(calendars);
  } catch (err) {
    logger.error({ err }, "calendar: failed to list Google calendars");
    res.status(502).json({
      error:
        "Could not reach Google Calendar. Make sure the Google Calendar integration is connected.",
    });
  }
});

const SelectCalendarBody = z.object({
  calendarId: z.string().min(1),
  calendarSummary: z.string().min(1),
});

// PUT /calendar/settings — choose the shared family calendar
router.put("/calendar/settings", async (req, res) => {
  const body = SelectCalendarBody.parse(req.body);

  await db
    .insert(travelsCalendarSettings)
    .values({
      id: 1,
      calendarId: body.calendarId,
      calendarSummary: body.calendarSummary,
    })
    .onConflictDoUpdate({
      target: travelsCalendarSettings.id,
      set: {
        calendarId: body.calendarId,
        calendarSummary: body.calendarSummary,
        updatedAt: new Date(),
      },
    });

  res.json({ calendarId: body.calendarId, calendarSummary: body.calendarSummary });
});

export default router;
