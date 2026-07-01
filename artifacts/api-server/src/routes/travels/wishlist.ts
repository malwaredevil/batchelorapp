import { Router, type IRouter } from "express";
import { and, eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { db, travelsWishlist } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

async function geocodeDestination(destination: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": "batchelor-travels/1.0" } });
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {}
  return null;
}

const CreateBody = z.object({
  destination: z.string().min(1),
  targetDate: z.string().optional(),
  notes: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

const UpdateBody = z.object({
  destination: z.string().min(1).optional(),
  targetDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  done: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

router.get("/wishlist", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select()
    .from(travelsWishlist)
    .where(eq(travelsWishlist.userId, userId))
    .orderBy(asc(travelsWishlist.sortOrder), asc(travelsWishlist.createdAt));
  res.json(rows);
});

router.post("/wishlist", async (req, res) => {
  const userId = req.session.userId!;
  const body = CreateBody.parse(req.body);
  const coords = await geocodeDestination(body.destination);
  const [row] = await db
    .insert(travelsWishlist)
    .values({ ...body, userId, ...(coords ?? {}) })
    .returning();
  res.status(201).json(row);
});

router.patch("/wishlist/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = UpdateBody.parse(req.body);

  const [existing] = await db
    .select()
    .from(travelsWishlist)
    .where(and(eq(travelsWishlist.id, id), eq(travelsWishlist.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  // If destination changed and no explicit coords provided, re-geocode
  let extraCoords: { lat?: number; lng?: number } = {};
  if (body.destination && body.destination !== existing.destination && body.lat == null && body.lng == null) {
    const coords = await geocodeDestination(body.destination);
    if (coords) extraCoords = coords;
  }

  const [updated] = await db
    .update(travelsWishlist)
    .set({ ...body, ...extraCoords } as Record<string, unknown>)
    .where(and(eq(travelsWishlist.id, id), eq(travelsWishlist.userId, userId)))
    .returning();
  res.json(updated);
});

router.delete("/wishlist/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db
    .select({ id: travelsWishlist.id })
    .from(travelsWishlist)
    .where(and(eq(travelsWishlist.id, id), eq(travelsWishlist.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  await db
    .delete(travelsWishlist)
    .where(and(eq(travelsWishlist.id, id), eq(travelsWishlist.userId, userId)));
  res.status(204).send();
});

export default router;
