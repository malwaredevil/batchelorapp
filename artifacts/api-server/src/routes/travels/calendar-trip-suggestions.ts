import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  travelsCalendarTripSuggestions,
  travelsTrips,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import { scanCalendarForTripSuggestions } from "../../lib/travels-calendar-scan";
import { linkExistingCalendarEvent } from "../../lib/trip-calendar-sync";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

// Trip suggestions are travel data derived from calendar scans, not a
// calendar/OAuth connection — like trips themselves, they're fully
// household-shared. Any authenticated household member can see, dismiss, or
// accept any pending suggestion, regardless of which member's connected
// calendar it was sourced from.

// GET /calendar-trip-suggestions — all pending AI-detected trip suggestions
router.get("/calendar-trip-suggestions", async (_req, res) => {
  const rows = await db
    .select()
    .from(travelsCalendarTripSuggestions)
    .where(eq(travelsCalendarTripSuggestions.status, "pending"))
    .orderBy(desc(travelsCalendarTripSuggestions.createdAt));
  res.json(rows);
});

// POST /calendar-trip-suggestions/scan — manual "Scan now" trigger
router.post("/calendar-trip-suggestions/scan", aiLimiter, async (req, res) => {
  try {
    const result = await scanCalendarForTripSuggestions();
    res.json(result);
  } catch (err) {
    logger.error(
      { err, userId: req.session.userId },
      "calendar-trip-suggestions: manual scan failed",
    );
    res
      .status(502)
      .json({ error: "Could not scan your connected calendars right now." });
  }
});

// POST /calendar-trip-suggestions/:id/dismiss
router.post("/calendar-trip-suggestions/:id/dismiss", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [updated] = await db
    .update(travelsCalendarTripSuggestions)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(eq(travelsCalendarTripSuggestions.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

const AcceptBody = z.object({
  title: z.string().min(1).optional(),
  destination: z.string().min(1).optional(),
});

// POST /calendar-trip-suggestions/:id/accept — create a real trip from the
// suggestion and link its related calendar events so future scans/syncs
// don't re-suggest or duplicate them.
router.post("/calendar-trip-suggestions/:id/accept", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = AcceptBody.parse(req.body ?? {});

  const userId = req.session.userId!;
  const [suggestion] = await db
    .select()
    .from(travelsCalendarTripSuggestions)
    .where(eq(travelsCalendarTripSuggestions.id, id));

  if (!suggestion || suggestion.status !== "pending") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const title = body.title ?? suggestion.suggestedTitle;
  const destination = body.destination ?? suggestion.destination ?? title;

  const [trip] = await db
    .insert(travelsTrips)
    .values({
      title,
      destination,
      status: "booked",
      startDate: suggestion.startDate,
      endDate: suggestion.endDate,
      hasRentalCar: false,
      travellerCount: 2,
      userId,
    })
    .returning();

  const relatedEventIds = (suggestion.relatedEventIds as string[] | null) ?? [];
  for (const googleEventId of relatedEventIds) {
    await linkExistingCalendarEvent(trip.id, googleEventId);
  }

  await db
    .update(travelsCalendarTripSuggestions)
    .set({ status: "accepted", updatedAt: new Date() })
    .where(eq(travelsCalendarTripSuggestions.id, id));

  res.status(201).json(trip);
});

export default router;
