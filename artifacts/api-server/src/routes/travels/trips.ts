import { Router, type IRouter } from "express";
import { and, eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { db, travelsTrips, travelsTripDocuments } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

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
  hasRentalCar: z.boolean().default(false),
  accommodationName: z.string().optional(),
  accommodationArea: z.string().optional(),
  notes: z.string().optional(),
  travellerCount: z.number().int().min(1).default(2),
});

const UpdateTripBody = CreateTripBody.partial().extend({
  itinerary: z.unknown().optional(),
  packingList: z.unknown().optional(),
});

router.get("/travels/trips", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select()
    .from(travelsTrips)
    .where(eq(travelsTrips.userId, userId))
    .orderBy(asc(travelsTrips.createdAt));
  res.json(rows);
});

router.post("/travels/trips", async (req, res) => {
  const userId = req.session.userId!;
  const body = CreateTripBody.parse(req.body);
  const [row] = await db
    .insert(travelsTrips)
    .values({ ...body, userId })
    .returning();
  res.status(201).json(row);
});

router.get("/travels/trips/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [trip] = await db
    .select()
    .from(travelsTrips)
    .where(and(eq(travelsTrips.id, id), eq(travelsTrips.userId, userId)));

  if (!trip) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const documents = await db
    .select()
    .from(travelsTripDocuments)
    .where(
      and(
        eq(travelsTripDocuments.tripId, id),
        eq(travelsTripDocuments.userId, userId),
      ),
    )
    .orderBy(asc(travelsTripDocuments.createdAt));

  res.json({ ...trip, documents });
});

router.patch("/travels/trips/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = UpdateTripBody.parse(req.body);

  const [existing] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(and(eq(travelsTrips.id, id), eq(travelsTrips.userId, userId)));

  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [updated] = await db
    .update(travelsTrips)
    .set(body as Record<string, unknown>)
    .where(and(eq(travelsTrips.id, id), eq(travelsTrips.userId, userId)))
    .returning();

  res.json(updated);
});

router.delete("/travels/trips/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(and(eq(travelsTrips.id, id), eq(travelsTrips.userId, userId)));

  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db
    .delete(travelsTrips)
    .where(and(eq(travelsTrips.id, id), eq(travelsTrips.userId, userId)));

  res.status(204).send();
});

export default router;
