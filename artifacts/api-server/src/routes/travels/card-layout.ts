import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import {
  db,
  travelsCardLayoutPreferences,
  travelsTripCardCollapseState,
  travelsTrips,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

// Whitelist of known Trip Detail card ids. Keep in sync with the client's
// card registry (artifacts/travels/src/pages/TripDetail.tsx). Unknown ids
// submitted by a client are silently dropped rather than rejected outright,
// so older/newer client versions degrade gracefully instead of erroring.
const CARD_ORDER_IDS = [
  "reminders",
  "itinerary",
  "documents",
  "packing-todo",
  "photos",
  "magnets",
  "weather-nearby",
] as const;

const COLLAPSE_CARD_IDS = [
  "reminders",
  "itinerary",
  "documents",
  "packing",
  "todo",
  "photos",
  "magnets",
  "weather-nearby",
] as const;

const UpdateCardOrderBody = z.object({
  cardOrder: z.array(z.string()).max(50),
});

const UpdateCollapseBody = z.object({
  collapsedCards: z.array(z.string()).max(50),
});

// GET /api/travels/card-layout — the logged-in user's own Trip Detail card
// order preference (applies across every trip).
router.get("/card-layout", async (req, res) => {
  const userId = req.session.userId!;
  const [row] = await db
    .select({ cardOrder: travelsCardLayoutPreferences.cardOrder })
    .from(travelsCardLayoutPreferences)
    .where(eq(travelsCardLayoutPreferences.userId, userId));

  res.json({ cardOrder: row?.cardOrder ?? [] });
});

// PUT /api/travels/card-layout — upsert the logged-in user's card order.
router.put("/card-layout", async (req, res) => {
  const userId = req.session.userId!;
  const body = UpdateCardOrderBody.parse(req.body);
  const cardOrder = body.cardOrder.filter((id) =>
    (CARD_ORDER_IDS as readonly string[]).includes(id),
  );

  await db
    .insert(travelsCardLayoutPreferences)
    .values({ userId, cardOrder, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: travelsCardLayoutPreferences.userId,
      set: { cardOrder, updatedAt: new Date() },
    });

  res.json({ cardOrder });
});

// GET /api/travels/trips/:tripId/card-collapse — the logged-in user's own
// collapsed-card state for this specific trip.
router.get("/trips/:tripId/card-collapse", async (req, res) => {
  const userId = req.session.userId!;
  const tripId = parseInt(req.params.tripId, 10);
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid trip id" });
    return;
  }

  const [row] = await db
    .select({ collapsedCards: travelsTripCardCollapseState.collapsedCards })
    .from(travelsTripCardCollapseState)
    .where(
      and(
        eq(travelsTripCardCollapseState.userId, userId),
        eq(travelsTripCardCollapseState.tripId, tripId),
      ),
    );

  res.json({ collapsedCards: row?.collapsedCards ?? [] });
});

// PUT /api/travels/trips/:tripId/card-collapse — upsert the logged-in
// user's collapsed-card state for this trip.
router.put("/trips/:tripId/card-collapse", async (req, res) => {
  const userId = req.session.userId!;
  const tripId = parseInt(req.params.tripId, 10);
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid trip id" });
    return;
  }

  const [trip] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const body = UpdateCollapseBody.parse(req.body);
  const collapsedCards = body.collapsedCards.filter((id) =>
    (COLLAPSE_CARD_IDS as readonly string[]).includes(id),
  );

  await db
    .insert(travelsTripCardCollapseState)
    .values({ userId, tripId, collapsedCards, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [
        travelsTripCardCollapseState.userId,
        travelsTripCardCollapseState.tripId,
      ],
      set: { collapsedCards, updatedAt: new Date() },
    });

  res.json({ collapsedCards });
});

export default router;
