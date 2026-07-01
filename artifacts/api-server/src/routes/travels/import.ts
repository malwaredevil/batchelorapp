import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, travelsTrips, travelsWishlist } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

const ImportTripSchema = z.object({
  title: z.string(),
  destination: z.string(),
  status: z.enum(["wishlist", "planning", "booked", "active", "completed"]).default("completed"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  travelers: z.array(z.string()).optional(),
  theOneThing: z.array(z.string()).optional(),
  notes: z.string().optional(),
  travellerCount: z.number().int().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  transportTo: z.enum(["drove", "flew", "train"]).optional(),
  accommodationName: z.string().optional(),
});

const ImportWishlistSchema = z.object({
  destination: z.string(),
  targetDate: z.string().optional(),
  notes: z.string().optional(),
  done: z.boolean().default(false),
});

const ImportBody = z.object({
  trips: z.array(ImportTripSchema).default([]),
  wishlistItems: z.array(ImportWishlistSchema).default([]),
});

async function geocode(dest: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(dest)}&format=json&limit=1`,
      { headers: { "User-Agent": "Batchelor-App/1.0" }, signal: AbortSignal.timeout(4000) },
    );
    const d = (await r.json()) as Array<{ lat: string; lon: string }>;
    return d[0] ? { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) } : null;
  } catch { return null; }
}

router.post("/import", async (req, res) => {
  const userId = req.session.userId!;
  const body = ImportBody.parse(req.body);
  const results = { tripsCreated: 0, tripsSkipped: 0, wishlistCreated: 0, wishlistSkipped: 0 };

  for (const trip of body.trips) {
    // Deduplicate across all users by destination + startDate
    const [existing] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(
        trip.startDate
          ? eq(travelsTrips.startDate, trip.startDate)
          : eq(travelsTrips.destination, trip.destination),
      );
    if (existing) { results.tripsSkipped++; continue; }

    const coords = (trip.lat != null && trip.lng != null)
      ? { lat: trip.lat, lng: trip.lng }
      : await geocode(trip.destination);

    await db.insert(travelsTrips).values({
      userId,
      title: trip.title,
      destination: trip.destination,
      status: trip.status,
      startDate: trip.startDate,
      endDate: trip.endDate,
      travelers: (trip.travelers ?? null) as unknown as Record<string, unknown>,
      theOneThing: (trip.theOneThing ?? null) as unknown as Record<string, unknown>,
      notes: trip.notes,
      travellerCount: trip.travellerCount ?? (trip.travelers?.length ?? 2),
      transportTo: trip.transportTo,
      accommodationName: trip.accommodationName,
      ...(coords ?? {}),
    });
    results.tripsCreated++;
  }

  for (const item of body.wishlistItems) {
    const [existing] = await db
      .select({ id: travelsWishlist.id })
      .from(travelsWishlist)
      .where(eq(travelsWishlist.destination, item.destination));
    if (existing) { results.wishlistSkipped++; continue; }
    await db.insert(travelsWishlist).values({
      userId, destination: item.destination, targetDate: item.targetDate,
      notes: item.notes, done: item.done, sortOrder: 0,
    });
    results.wishlistCreated++;
  }

  res.json({ success: true, ...results });
});

export default router;
