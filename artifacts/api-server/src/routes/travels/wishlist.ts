import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { db, travelsWishlist } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { fetchJsonSafe } from "../../lib/ssrf-safe-fetch";

const router: IRouter = Router();
router.use(requireAuth);

async function geocodeDestination(
  destination: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`;
    const data = await fetchJsonSafe<Array<{ lat: string; lon: string }>>(url, {
      headers: { "User-Agent": "Batchelor-App/1.0" },
    });
    if (data[0])
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
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

router.get("/wishlist", async (_req, res) => {
  const rows = await db
    .select()
    .from(travelsWishlist)
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
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = UpdateBody.parse(req.body);

  const [existing] = await db
    .select()
    .from(travelsWishlist)
    .where(eq(travelsWishlist.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  let extraCoords: { lat?: number; lng?: number } = {};
  if (
    body.destination &&
    body.destination !== existing.destination &&
    body.lat == null &&
    body.lng == null
  ) {
    const coords = await geocodeDestination(body.destination);
    if (coords) extraCoords = coords;
  }

  const [updated] = await db
    .update(travelsWishlist)
    .set({ ...body, ...extraCoords } as Record<string, unknown>)
    .where(eq(travelsWishlist.id, id))
    .returning();
  res.json(updated);
});

router.delete("/wishlist/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select({ id: travelsWishlist.id })
    .from(travelsWishlist)
    .where(eq(travelsWishlist.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(travelsWishlist).where(eq(travelsWishlist.id, id));
  res.status(204).send();
});

export default router;
