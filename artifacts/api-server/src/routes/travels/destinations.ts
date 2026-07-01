import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, travelsTrips } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

// GET /destinations — group all trips by destination, newest visit first within each group.
// Returns destinations sorted by most recent trip (descending).
router.get("/destinations", async (req, res) => {
  const userId = req.session.userId!;

  const trips = await db
    .select()
    .from(travelsTrips)
    .where(eq(travelsTrips.userId, userId))
    .orderBy(desc(travelsTrips.startDate));

  // Group by normalized destination key
  const map = new Map<
    string,
    {
      destination: string;
      lat: number | null;
      lng: number | null;
      trips: typeof trips;
    }
  >();

  for (const trip of trips) {
    const key = trip.destination.toLowerCase().trim();
    if (!map.has(key)) {
      map.set(key, {
        destination: trip.destination,
        lat: trip.lat ?? null,
        lng: trip.lng ?? null,
        trips: [],
      });
    }
    map.get(key)!.trips.push(trip);
  }

  // Sort groups by most recent trip date (newest first)
  const result = [...map.values()].sort((a, b) => {
    const aDate = a.trips[0]?.startDate ?? "";
    const bDate = b.trips[0]?.startDate ?? "";
    return bDate.localeCompare(aDate);
  });

  res.json(result);
});

export default router;
