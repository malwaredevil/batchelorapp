import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { db, travelsTrips, travelsTripDocuments, travelsTripPhotos, travelsReminders } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { deleteTripPhoto } from "../../lib/travels/storage";
import { deleteDocument } from "../../lib/travels-storage";

const router: IRouter = Router();
router.use(requireAuth);

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase())
    .trim();
}

async function geocodeDestination(
  destination: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Batchelor-App/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    return null;
  } catch {
    return null;
  }
}

const CreateTripBody = z.object({
  title: z.string().min(1),
  destination: z.string().min(1),
  lat: z.number().optional(),
  lng: z.number().optional(),
  status: z
    .enum(["wishlist", "planning", "booked", "active", "completed"])
    .default("wishlist"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  transportTo: z.enum(["drove", "flew", "train"]).optional(),
  transportDetails: z.string().optional(),
  hasRentalCar: z.boolean().default(false),
  accommodationName: z.string().optional(),
  accommodationArea: z.string().optional(),
  notes: z.string().optional(),
  funFact: z.string().optional(),
  travellerCount: z.number().int().min(1).default(2),
  travelers: z.array(z.string()).optional(),
  theOneThing: z.array(z.string()).optional(),
});

const UpdateTripBody = CreateTripBody.partial().extend({
  itinerary: z.unknown().optional(),
  packingList: z.unknown().optional(),
  todoList: z.unknown().optional(),
});

// Must be before /:id routes to avoid Express routing conflict
router.get("/highlights", async (_req, res) => {
  const rows = await db
    .select({ theOneThing: travelsTrips.theOneThing })
    .from(travelsTrips);

  const values = new Set<string>();
  for (const row of rows) {
    const arr = row.theOneThing as string[] | null;
    if (Array.isArray(arr)) arr.forEach((v) => values.add(v));
  }
  res.json([...values].sort());
});

router.get("/trips", async (_req, res) => {
  const rows = await db
    .select()
    .from(travelsTrips)
    .orderBy(asc(travelsTrips.createdAt));
  res.json(rows);
});

router.post("/trips", async (req, res) => {
  const userId = req.session.userId!;
  const body = CreateTripBody.parse(req.body);
  const normalizedOneThing = body.theOneThing?.map(toTitleCase);
  const coords =
    body.lat == null && body.lng == null
      ? await geocodeDestination(body.destination)
      : null;
  const [row] = await db
    .insert(travelsTrips)
    .values({
      ...body,
      theOneThing: (normalizedOneThing ?? null) as unknown as Record<string, unknown>,
      travelers: (body.travelers ?? null) as unknown as Record<string, unknown>,
      userId,
      ...(coords ?? {}),
    })
    .returning();
  res.status(201).json(row);
});

router.get("/trips/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [trip] = await db
    .select()
    .from(travelsTrips)
    .where(eq(travelsTrips.id, id));

  if (!trip) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const documents = await db
    .select()
    .from(travelsTripDocuments)
    .where(eq(travelsTripDocuments.tripId, id))
    .orderBy(asc(travelsTripDocuments.createdAt));

  res.json({ ...trip, documents });
});

router.patch("/trips/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = UpdateTripBody.parse(req.body);
  const normalizedOneThing = body.theOneThing?.map(toTitleCase);

  const [existing] = await db
    .select({ id: travelsTrips.id, destination: travelsTrips.destination })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, id));

  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  let geocoded: { lat: number; lng: number } | null = null;
  if (
    body.destination != null &&
    body.destination !== existing.destination &&
    body.lat == null &&
    body.lng == null
  ) {
    geocoded = await geocodeDestination(body.destination);
  }

  const updateData: Record<string, unknown> = {
    ...(body as Record<string, unknown>),
    ...(geocoded ?? {}),
  };
  if (normalizedOneThing !== undefined) {
    updateData.theOneThing = normalizedOneThing;
  }
  if (body.travelers !== undefined) {
    updateData.travelers = body.travelers ?? null;
  }

  const [updated] = await db
    .update(travelsTrips)
    .set(updateData)
    .where(eq(travelsTrips.id, id))
    .returning();

  res.json(updated);
});

router.delete("/trips/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, id));

  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Clean up photos and documents from Supabase Storage before deleting DB rows
  const photos = await db
    .select({ storagePath: travelsTripPhotos.storagePath })
    .from(travelsTripPhotos)
    .where(eq(travelsTripPhotos.tripId, id));

  const docs = await db
    .select({ storagePath: travelsTripDocuments.storagePath })
    .from(travelsTripDocuments)
    .where(eq(travelsTripDocuments.tripId, id));

  await Promise.allSettled([
    ...photos.map((p) => deleteTripPhoto(p.storagePath)),
    ...docs.map((d) => deleteDocument(d.storagePath)),
  ]);

  // Delete child rows first, then the trip
  await db.delete(travelsTripPhotos).where(eq(travelsTripPhotos.tripId, id));
  await db.delete(travelsTripDocuments).where(eq(travelsTripDocuments.tripId, id));
  await db.delete(travelsReminders).where(eq(travelsReminders.tripId, id));
  await db.delete(travelsTrips).where(eq(travelsTrips.id, id));

  res.status(204).send();
});

export default router;
