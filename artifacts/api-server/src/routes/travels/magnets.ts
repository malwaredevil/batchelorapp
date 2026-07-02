import { Router, type IRouter } from "express";
import multer from "multer";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, travelsTripPhotos, travelsTrips } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { supplementalUploadLimiter } from "../../middleware/rateLimit";
import { generateVisualEmbedding } from "../../lib/visual-embed";
import { downloadTripPhoto } from "../../lib/travels/storage";

const router: IRouter = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype));
  },
});

// Backfill limit — how many un-embedded magnets we'll compute embeddings for
// on a single check request. Personal-scale collections stay well under this.
const BACKFILL_LIMIT = 50;
const RESULT_LIMIT = 5;

// POST /magnets/check — upload a photo of a magnet spotted in a store and see
// whether a visually similar magnet already exists anywhere in the household's
// trips. Trips (and their photos) are shared across all authenticated users —
// see GET /trips, which has no per-user filter — so this search intentionally
// looks across every user's magnets, not just the requester's own uploads.
router.post("/magnets/check", supplementalUploadLimiter, upload.single("photo"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "A photo is required." });
    return;
  }

  const queryEmbedding = await generateVisualEmbedding(req.file.buffer);
  if (!queryEmbedding) {
    res.status(503).json({
      error: "Visual comparison is not configured. Please try again later.",
    });
    return;
  }

  // Lazily backfill embeddings for any magnets uploaded before this feature
  // existed (or if a prior embedding attempt failed), across all users.
  const unembedded = await db
    .select({ id: travelsTripPhotos.id, storagePath: travelsTripPhotos.storagePath })
    .from(travelsTripPhotos)
    .where(
      and(
        eq(travelsTripPhotos.photoType, "magnet"),
        isNull(travelsTripPhotos.visualEmbedding),
      ),
    )
    .limit(BACKFILL_LIMIT);

  for (const magnet of unembedded) {
    try {
      const { buffer } = await downloadTripPhoto(magnet.storagePath);
      const embedding = await generateVisualEmbedding(buffer);
      if (embedding) {
        await db
          .update(travelsTripPhotos)
          .set({ visualEmbedding: embedding })
          .where(eq(travelsTripPhotos.id, magnet.id));
      }
    } catch (err) {
      req.log.warn({ err, photoId: magnet.id }, "magnets/check: backfill embedding failed, skipping");
    }
  }

  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  const matches = await db
    .execute<{
      id: number;
      trip_id: number;
      trip_title: string;
      caption: string | null;
      similarity: number;
    }>(
      sql`
      select p.id, p.trip_id, t.title as trip_title, p.caption,
             1 - (p.visual_embedding <=> ${vectorLiteral}::vector) as similarity
      from travels_trip_photos p
      join travels_trips t on t.id = p.trip_id
      where p.photo_type = 'magnet'
        and p.visual_embedding is not null
      order by p.visual_embedding <=> ${vectorLiteral}::vector
      limit ${RESULT_LIMIT}
    `,
    )
    .then((r) =>
      r.rows.map((row) => ({
        photoId: Number(row.id),
        tripId: Number(row.trip_id),
        tripTitle: row.trip_title,
        caption: row.caption,
        similarity: Number(row.similarity),
      })),
    );

  const best = matches[0];
  let verdict: "likely_owned" | "possible_match" | "no_match" = "no_match";
  if (best) {
    if (best.similarity >= 0.9) verdict = "likely_owned";
    else if (best.similarity >= 0.75) verdict = "possible_match";
  }

  res.json({ verdict, matches });
});

export default router;
