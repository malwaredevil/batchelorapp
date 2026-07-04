import { Router, type IRouter } from "express";
import { and, desc, eq, or, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  travelsCalendarTripSuggestions,
  travelsTrips,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { scanCalendarForTripSuggestions } from "../../lib/travels-calendar-scan";
import { linkExistingCalendarEvent } from "../../lib/trip-calendar-sync";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

// A user may see: suggestions sourced from the shared Travel calendar (any
// household member), suggestions they personally own, and legacy rows from
// before ownership tracking existed (userId is null). Never another user's
// personal-calendar suggestions.
function visibleToUser(userId: number) {
  return or(
    eq(travelsCalendarTripSuggestions.isFromSharedCalendar, true),
    eq(travelsCalendarTripSuggestions.userId, userId),
    isNull(travelsCalendarTripSuggestions.userId),
  );
}

// GET /calendar-trip-suggestions — pending AI-detected trip suggestions
// visible to the current user (their own personal-calendar suggestions plus
// every shared Travel-calendar suggestion).
router.get("/calendar-trip-suggestions", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select()
    .from(travelsCalendarTripSuggestions)
    .where(
      and(
        eq(travelsCalendarTripSuggestions.status, "pending"),
        visibleToUser(userId),
      ),
    )
    .orderBy(desc(travelsCalendarTripSuggestions.createdAt));
  res.json(rows);
});

// POST /calendar-trip-suggestions/scan — manual "Scan now" trigger
router.post("/calendar-trip-suggestions/scan", async (req, res) => {
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
  const userId = req.session.userId!;
  const [updated] = await db
    .update(travelsCalendarTripSuggestions)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(
      and(eq(travelsCalendarTripSuggestions.id, id), visibleToUser(userId)),
    )
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
    .where(
      and(eq(travelsCalendarTripSuggestions.id, id), visibleToUser(userId)),
    );

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
