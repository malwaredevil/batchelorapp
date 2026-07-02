import { Router, type IRouter } from "express";
import { and, eq, asc } from "drizzle-orm";
import multer from "multer";
import { db, travelsTrips, travelsTripPhotos } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  uploadTripPhoto,
  downloadTripPhoto,
  deleteTripPhoto,
} from "../../lib/travels/storage";
import { generateVisualEmbedding } from "../../lib/visual-embed";

const router: IRouter = Router();
router.use(requireAuth);

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_TYPES.has(file.mimetype));
  },
});

async function tripExists(tripId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  return !!row;
}

function parsePhotoType(raw: unknown): "photo" | "magnet" {
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return value === "magnet" ? "magnet" : "photo";
}

// GET /trips/:id/photos
router.get("/trips/:id/photos", async (req, res) => {
  const tripId = parseInt(String(req.params["id"]), 10);
  if (isNaN(tripId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await tripExists(tripId))) { res.status(404).json({ error: "Not found" }); return; }

  const typeFilter = typeof req.query["type"] === "string" ? req.query["type"] : undefined;

  const photos = await db
    .select()
    .from(travelsTripPhotos)
    .where(
      typeFilter
        ? and(eq(travelsTripPhotos.tripId, tripId), eq(travelsTripPhotos.photoType, typeFilter))
        : eq(travelsTripPhotos.tripId, tripId),
    )
    .orderBy(asc(travelsTripPhotos.sortOrder), asc(travelsTripPhotos.createdAt));

  res.json(photos);
});

// POST /trips/:id/photos
router.post("/trips/:id/photos", upload.single("photo"), async (req, res) => {
  const userId = req.session.userId!;
  const tripId = parseInt(String(req.params["id"]), 10);
  if (isNaN(tripId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!req.file) { res.status(400).json({ error: "No photo file provided" }); return; }
  if (!(await tripExists(tripId))) { res.status(404).json({ error: "Not found" }); return; }

  const contentType = req.file.mimetype as "image/jpeg" | "image/png" | "image/webp";
  const storagePath = await uploadTripPhoto(req.file.buffer, contentType);

  const photoType = parsePhotoType(req.body["type"]);

  // Only magnets get a visual embedding — used later to check whether a
  // magnet spotted in a store is already owned. Never fails the upload.
  const visualEmbedding =
    photoType === "magnet"
      ? await generateVisualEmbedding(req.file.buffer).catch(() => null)
      : null;

  const maxOrderRow = await db
    .select({ sortOrder: travelsTripPhotos.sortOrder })
    .from(travelsTripPhotos)
    .where(and(eq(travelsTripPhotos.tripId, tripId), eq(travelsTripPhotos.photoType, photoType)))
    .orderBy(asc(travelsTripPhotos.sortOrder));

  const nextOrder = maxOrderRow.length > 0 ? maxOrderRow[maxOrderRow.length - 1].sortOrder + 1 : 0;

  const caption: string | null = (() => {
    const raw = req.body["caption"];
    if (typeof raw === "string" && raw) return raw;
    if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0]) return raw[0];
    return null;
  })();

  const [photo] = await db
    .insert(travelsTripPhotos)
    .values({
      tripId,
      userId,
      storagePath,
      caption,
      photoType,
      sortOrder: nextOrder,
      visualEmbedding,
    })
    .returning();

  res.status(201).json(photo);
});

// PATCH /trips/:id/photos/:photoId  (update caption)
router.patch("/trips/:id/photos/:photoId", async (req, res) => {
  const tripId = parseInt(String(req.params["id"]), 10);
  const photoId = parseInt(String(req.params["photoId"]), 10);
  if (isNaN(tripId) || isNaN(photoId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [updated] = await db
    .update(travelsTripPhotos)
    .set({ caption: (req.body["caption"] as string | null) ?? null })
    .where(and(eq(travelsTripPhotos.id, photoId), eq(travelsTripPhotos.tripId, tripId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// DELETE /trips/:id/photos/:photoId
router.delete("/trips/:id/photos/:photoId", async (req, res) => {
  const tripId = parseInt(String(req.params["id"]), 10);
  const photoId = parseInt(String(req.params["photoId"]), 10);
  if (isNaN(tripId) || isNaN(photoId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select()
    .from(travelsTripPhotos)
    .where(and(eq(travelsTripPhotos.id, photoId), eq(travelsTripPhotos.tripId, tripId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  await deleteTripPhoto(row.storagePath).catch(() => {});
  await db.delete(travelsTripPhotos).where(eq(travelsTripPhotos.id, photoId));

  const [trip] = await db
    .select({ iconPhotoId: travelsTrips.iconPhotoId })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  if (trip?.iconPhotoId === photoId) {
    await db.update(travelsTrips).set({ iconPhotoId: null }).where(eq(travelsTrips.id, tripId));
  }

  res.status(204).send();
});

// PUT /trips/:id/icon  (set or clear the trip's default/cover picture; can be any photo — memory or magnet — on this trip)
router.put("/trips/:id/icon", async (req, res) => {
  const tripId = parseInt(String(req.params["id"]), 10);
  if (isNaN(tripId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await tripExists(tripId))) { res.status(404).json({ error: "Not found" }); return; }

  const rawPhotoId = req.body["photoId"];
  if (rawPhotoId === null || rawPhotoId === undefined) {
    await db.update(travelsTrips).set({ iconPhotoId: null }).where(eq(travelsTrips.id, tripId));
    res.json({ iconPhotoId: null });
    return;
  }

  const photoId = parseInt(String(rawPhotoId), 10);
  if (isNaN(photoId)) { res.status(400).json({ error: "Invalid photoId" }); return; }

  const [photo] = await db
    .select()
    .from(travelsTripPhotos)
    .where(and(eq(travelsTripPhotos.id, photoId), eq(travelsTripPhotos.tripId, tripId)));

  if (!photo) {
    res.status(400).json({ error: "Photo must belong to this trip" });
    return;
  }

  await db.update(travelsTrips).set({ iconPhotoId: photoId }).where(eq(travelsTrips.id, tripId));
  res.json({ iconPhotoId: photoId });
});

// GET /trips/:id/photos/:photoId/image
router.get("/trips/:id/photos/:photoId/image", async (req, res) => {
  const tripId = parseInt(String(req.params["id"]), 10);
  const photoId = parseInt(String(req.params["photoId"]), 10);
  if (isNaN(tripId) || isNaN(photoId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select()
    .from(travelsTripPhotos)
    .where(and(eq(travelsTripPhotos.id, photoId), eq(travelsTripPhotos.tripId, tripId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const { buffer, contentType } = await downloadTripPhoto(row.storagePath);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(buffer);
});

export default router;
