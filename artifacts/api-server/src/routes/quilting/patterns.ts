import { Router, type IRouter } from "express";
import multer from "multer";
import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  quiltPatterns,
  entityCategories,
  quiltingCategories as categories,
  quiltingImages,
  type QuiltPatternRow,
} from "@workspace/db";
import {
  ListPatternsResponse,
  GetPatternParams,
  GetPatternResponse,
  UpdatePatternParams,
  UpdatePatternBody,
  UpdatePatternResponse,
  DeletePatternParams,
  GetPatternImageParams,
  ReanalyzePatternParams,
  ReanalyzePatternResponse,
  BulkReanalyzePatternsBody,
  BulkReanalyzePatternsResponse,
  AddPatternImageParams,
  AddPatternImageBody,
  UpdatePatternImageParams,
  UpdatePatternImageBody,
  DeletePatternImageParams,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter, bulkAiLimiter } from "../../middleware/rateLimit";
import { sniffImageType, stripImageMetadata } from "../../lib/image";
import {
  uploadImage,
  deleteImage,
  downloadImageBuffer,
  downloadImageAsDataUrl,
} from "../../lib/storage";
import {
  analyzePatternImage,
  enrichPatternMetadata,
  extractBlockFromImage,
} from "../../lib/openai";
import { serializePattern, serializePatterns } from "../../lib/serialize";

const MAX_NAME = 200;
const MAX_FIELD = 200;
const MAX_NOTES = 4000;
const MAX_LABEL = 100;
const MAX_CATEGORIES = 50;
const MAX_CATEGORY_NAME = 100;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 12, fieldSize: 8192 },
});

function clamp(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t.slice(0, max) : null;
}

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw))
    return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return parsed.filter((v): v is string => typeof v === "string");
    } catch {
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

async function resolveOrCreateCategories(names: string[]): Promise<number[]> {
  // Bound the work this request can trigger: normalise, drop empties,
  // de-duplicate, and cap the count so a large or repetitive array cannot
  // amplify into a flood of per-name database round-trips. Resolution then uses
  // a fixed number of batched queries regardless of input size.
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().slice(0, MAX_CATEGORY_NAME);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
    if (unique.length >= MAX_CATEGORIES) break;
  }
  if (unique.length === 0) return [];

  // One batched lookup for the names that already exist.
  const existing = await db
    .select({ name: categories.name })
    .from(categories)
    .where(inArray(categories.name, unique));
  const existingNames = new Set(existing.map((c) => c.name));

  // One batched insert for the rest (name is UNIQUE, so concurrent inserts are
  // absorbed by onConflictDoNothing).
  const missing = unique.filter((n) => !existingNames.has(n));
  if (missing.length > 0) {
    await db
      .insert(categories)
      .values(missing.map((name) => ({ name })))
      .onConflictDoNothing();
  }

  // One final batched lookup resolves every id (rows inserted above plus any
  // created concurrently by another request).
  const all = await db
    .select({ id: categories.id })
    .from(categories)
    .where(inArray(categories.name, unique));
  return all.map((c) => c.id);
}

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

router.get("/patterns", async (_req, res) => {
  const rows = await db
    .select()
    .from(quiltPatterns)
    .orderBy(desc(quiltPatterns.createdAt));
  const items = await serializePatterns(rows);
  res.json(ListPatternsResponse.parse(items));
});

// ---------------------------------------------------------------------------
// Get one
// ---------------------------------------------------------------------------

router.get("/patterns/:id", async (req, res) => {
  const { id } = GetPatternParams.parse(req.params);
  const [row] = await db
    .select()
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Pattern not found." });
    return;
  }
  res.json(GetPatternResponse.parse(await serializePattern(row)));
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

router.post("/patterns", upload.single("image"), async (req, res) => {
  const file = req.file;
  let imagePath: string | null = null;

  if (file) {
    const contentType = sniffImageType(file.buffer);
    if (contentType) {
      const cleanBuffer = await stripImageMetadata(file.buffer, contentType);
      imagePath = await uploadImage(cleanBuffer, contentType);
    }
  }

  const name = clamp(req.body.name, MAX_NAME);
  if (!name) {
    res.status(400).json({ error: "Pattern name is required." });
    return;
  }

  const [row] = await db
    .insert(quiltPatterns)
    .values({
      name,
      designer: clamp(req.body.designer, MAX_FIELD),
      blockSize: clamp(req.body.blockSize, MAX_FIELD),
      difficulty: clamp(req.body.difficulty, MAX_FIELD),
      sourceType: clamp(req.body.sourceType, MAX_FIELD),
      sourceReference: clamp(req.body.sourceReference, MAX_FIELD),
      notes: clamp(req.body.notes, MAX_NOTES),
      acquiredAt: clamp(req.body.acquiredAt, 50),
      imagePath,
    })
    .returning();

  const categoryNames = parseStringArray(req.body.categories);
  if (categoryNames.length > 0) {
    const catIds = await resolveOrCreateCategories(categoryNames);
    await db
      .insert(entityCategories)
      .values(
        catIds.map((cid) => ({
          entityType: "pattern" as const,
          entityId: row.id,
          categoryId: cid,
        })),
      )
      .onConflictDoNothing();
  }

  res.status(201).json(await serializePattern(row));
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

router.patch("/patterns/:id", async (req, res) => {
  const { id } = UpdatePatternParams.parse(req.params);
  const body = UpdatePatternBody.parse(req.body);

  const [existing] = await db
    .select({ id: quiltPatterns.id })
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Pattern not found." });
    return;
  }

  const updates: Partial<typeof quiltPatterns.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.slice(0, MAX_NAME);
  if (body.designer !== undefined) updates.designer = body.designer;
  if (body.blockSize !== undefined) updates.blockSize = body.blockSize;
  if (body.difficulty !== undefined) updates.difficulty = body.difficulty;
  if (body.sourceType !== undefined) updates.sourceType = body.sourceType;
  if (body.sourceReference !== undefined)
    updates.sourceReference = body.sourceReference;
  if (body.notes !== undefined)
    updates.notes = body.notes?.slice(0, MAX_NOTES) ?? null;
  if (body.acquiredAt !== undefined) updates.acquiredAt = body.acquiredAt;
  if (body.lockedFields !== undefined) updates.lockedFields = body.lockedFields;

  if (Object.keys(updates).length > 0) {
    await db.update(quiltPatterns).set(updates).where(eq(quiltPatterns.id, id));
  }

  if (body.categories !== undefined) {
    await db
      .delete(entityCategories)
      .where(sql`entity_type = 'pattern' AND entity_id = ${id}`);
    const catIds = await resolveOrCreateCategories(body.categories);
    if (catIds.length > 0) {
      await db
        .insert(entityCategories)
        .values(
          catIds.map((cid) => ({
            entityType: "pattern" as const,
            entityId: id,
            categoryId: cid,
          })),
        )
        .onConflictDoNothing();
    }
  }

  const [updated] = await db
    .select()
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, id))
    .limit(1);
  res.json(UpdatePatternResponse.parse(await serializePattern(updated)));
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

router.delete("/patterns/:id", async (req, res) => {
  const { id } = DeletePatternParams.parse(req.params);
  const [row] = await db
    .select({ imagePath: quiltPatterns.imagePath })
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Pattern not found." });
    return;
  }

  const supplementalImages = await db
    .select({ storagePath: quiltingImages.storagePath })
    .from(quiltingImages)
    .where(sql`entity_type = 'pattern' AND entity_id = ${id}`);

  await db.delete(quiltPatterns).where(eq(quiltPatterns.id, id));
  await Promise.allSettled([
    ...(row.imagePath ? [deleteImage(row.imagePath)] : []),
    ...supplementalImages.map((img) => deleteImage(img.storagePath)),
  ]);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Re-analyze with AI
// ---------------------------------------------------------------------------

const MAX_REANALYZE_IMAGES = 5;
const MAX_BULK_REANALYZE = 20;

router.post("/patterns/:id/reanalyze", aiLimiter, async (req, res) => {
  const { id } = ReanalyzePatternParams.parse(req.params);
  const [row] = await db
    .select()
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Pattern not found." });
    return;
  }
  if (!row.imagePath) {
    res.status(422).json({ error: "This pattern has no image to analyse." });
    return;
  }

  const supplementalPaths = await db
    .select({
      storagePath: quiltingImages.storagePath,
      position: quiltingImages.position,
    })
    .from(quiltingImages)
    .where(sql`entity_type = 'pattern' AND entity_id = ${id}`)
    .orderBy(quiltingImages.position);

  const allPaths = [
    row.imagePath,
    ...supplementalPaths.map((i) => i.storagePath),
  ].slice(0, MAX_REANALYZE_IMAGES);
  const settled = await Promise.allSettled(
    allPaths.map(downloadImageAsDataUrl),
  );
  const dataUrls = settled
    .filter(
      (s): s is PromiseFulfilledResult<string> => s.status === "fulfilled",
    )
    .map((s) => s.value);
  if (dataUrls.length === 0) {
    res
      .status(422)
      .json({ error: "Could not load any image for this pattern." });
    return;
  }

  const lockedFields = (row.lockedFields as string[]) ?? [];
  const analysis = await analyzePatternImage(dataUrls, lockedFields, {
    name: row.name,
    designer: row.designer,
    blockSize: row.blockSize,
    difficulty: row.difficulty,
  });

  await db
    .update(quiltPatterns)
    .set({
      ...(lockedFields.includes("name") ? {} : { name: analysis.name }),
      ...(lockedFields.includes("designer")
        ? {}
        : { designer: analysis.designer }),
      ...(lockedFields.includes("blockSize")
        ? {}
        : { blockSize: analysis.blockSize }),
      ...(lockedFields.includes("difficulty")
        ? {}
        : { difficulty: analysis.difficulty }),
      ...(lockedFields.includes("notes") ? {} : { notes: analysis.notes }),
    })
    .where(eq(quiltPatterns.id, id));

  const [updated] = await db
    .select()
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, id))
    .limit(1);
  res.json(
    ReanalyzePatternResponse.parse(
      await serializePattern(updated as QuiltPatternRow),
    ),
  );
});

router.post("/patterns/bulk-reanalyze", bulkAiLimiter, async (req, res) => {
  const { ids } = BulkReanalyzePatternsBody.parse(req.body);
  const capped = [...new Set(ids)].slice(0, MAX_BULK_REANALYZE);
  const succeeded: number[] = [];
  const failed: number[] = [];

  for (const id of capped) {
    try {
      const [row] = await db
        .select()
        .from(quiltPatterns)
        .where(eq(quiltPatterns.id, id))
        .limit(1);
      if (!row || !row.imagePath) {
        failed.push(id);
        continue;
      }

      const supplementalPaths = await db
        .select({ storagePath: quiltingImages.storagePath })
        .from(quiltingImages)
        .where(sql`entity_type = 'pattern' AND entity_id = ${id}`)
        .orderBy(quiltingImages.position);

      const allPaths = [
        row.imagePath,
        ...supplementalPaths.map((i) => i.storagePath),
      ].slice(0, MAX_REANALYZE_IMAGES);
      const settled = await Promise.allSettled(
        allPaths.map(downloadImageAsDataUrl),
      );
      const dataUrls = settled
        .filter(
          (s): s is PromiseFulfilledResult<string> => s.status === "fulfilled",
        )
        .map((s) => s.value);
      if (dataUrls.length === 0) {
        failed.push(id);
        continue;
      }

      const lockedFields = (row.lockedFields as string[]) ?? [];
      const analysis = await analyzePatternImage(dataUrls, lockedFields, {
        name: row.name,
        designer: row.designer,
        blockSize: row.blockSize,
        difficulty: row.difficulty,
      });
      await db
        .update(quiltPatterns)
        .set({
          ...(lockedFields.includes("name") ? {} : { name: analysis.name }),
          ...(lockedFields.includes("designer")
            ? {}
            : { designer: analysis.designer }),
          ...(lockedFields.includes("blockSize")
            ? {}
            : { blockSize: analysis.blockSize }),
          ...(lockedFields.includes("difficulty")
            ? {}
            : { difficulty: analysis.difficulty }),
          ...(lockedFields.includes("notes") ? {} : { notes: analysis.notes }),
        })
        .where(eq(quiltPatterns.id, id));
      succeeded.push(id);
    } catch {
      failed.push(id);
    }
  }

  res.json(BulkReanalyzePatternsResponse.parse({ succeeded, failed }));
});

// ---------------------------------------------------------------------------
// Primary image
// ---------------------------------------------------------------------------

router.get("/patterns/:id/image", async (req, res) => {
  const { id } = GetPatternImageParams.parse(req.params);
  const [row] = await db
    .select({ imagePath: quiltPatterns.imagePath })
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, id))
    .limit(1);
  if (!row || !row.imagePath) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  const { buffer, contentType } = await downloadImageBuffer(row.imagePath);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=3600");
  res.end(buffer);
});

// ---------------------------------------------------------------------------
// Supplemental images
// ---------------------------------------------------------------------------

router.post(
  "/patterns/:id/images",
  upload.single("image"),
  async (req, res) => {
    const { id } = AddPatternImageParams.parse(req.params);
    const body = AddPatternImageBody.parse(req.body);

    const [pattern] = await db
      .select({ id: quiltPatterns.id })
      .from(quiltPatterns)
      .where(eq(quiltPatterns.id, id))
      .limit(1);
    if (!pattern) {
      res.status(404).json({ error: "Pattern not found." });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "An image file is required." });
      return;
    }
    const contentType = sniffImageType(file.buffer);
    if (!contentType) {
      res.status(400).json({ error: "Unsupported image type." });
      return;
    }
    const cleanBuffer = await stripImageMetadata(file.buffer, contentType);
    const storagePath = await uploadImage(cleanBuffer, contentType);

    const existing = await db
      .select({ position: quiltingImages.position })
      .from(quiltingImages)
      .where(sql`entity_type = 'pattern' AND entity_id = ${id}`)
      .orderBy(quiltingImages.position);
    const nextPosition = (existing[existing.length - 1]?.position ?? 0) + 1;

    const [image] = await db
      .insert(quiltingImages)
      .values({
        entityType: "pattern",
        entityId: id,
        storagePath,
        label: clamp(body.label, MAX_LABEL),
        position: nextPosition,
      })
      .returning();

    res.status(201).json({
      id: image.id,
      url: `/api/quilting/patterns/${id}/images/${image.id}`,
      label: image.label,
      position: image.position,
    });
  },
);

router.get("/patterns/:id/images/:imageId", async (req, res) => {
  const { imageId } = UpdatePatternImageParams.parse(req.params);
  const [image] = await db
    .select()
    .from(quiltingImages)
    .where(eq(quiltingImages.id, imageId))
    .limit(1);
  if (!image) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  const { buffer, contentType } = await downloadImageBuffer(image.storagePath);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=3600");
  res.end(buffer);
});

router.patch("/patterns/:id/images/:imageId", async (req, res) => {
  const { imageId } = UpdatePatternImageParams.parse(req.params);
  const body = UpdatePatternImageBody.parse(req.body);
  const { id } = UpdatePatternParams.parse(req.params);
  const [image] = await db
    .update(quiltingImages)
    .set({
      ...(body.label !== undefined
        ? { label: clamp(body.label, MAX_LABEL) }
        : {}),
      ...(body.position !== undefined ? { position: body.position } : {}),
    })
    .where(eq(quiltingImages.id, imageId))
    .returning();
  if (!image) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  res.json({
    id: image.id,
    url: `/api/quilting/patterns/${id}/images/${image.id}`,
    label: image.label,
    position: image.position,
  });
});

router.delete("/patterns/:id/images/:imageId", async (req, res) => {
  const { imageId } = DeletePatternImageParams.parse(req.params);
  const [image] = await db
    .delete(quiltingImages)
    .where(eq(quiltingImages.id, imageId))
    .returning({ storagePath: quiltingImages.storagePath });
  if (!image) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  await deleteImage(image.storagePath);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// AI metadata enrichment — designer bio, website, publication details (#91)
// ---------------------------------------------------------------------------

router.post("/patterns/:id/enrich", aiLimiter, async (req, res) => {
  const { id } = GetPatternParams.parse(req.params);
  const [row] = await db
    .select()
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Pattern not found." });
    return;
  }

  const enrichment = await enrichPatternMetadata(row.name, row.designer);

  await db
    .update(quiltPatterns)
    .set({
      designerBio: enrichment.designerBio,
      designerWebsite: enrichment.designerWebsite,
      publicationName: enrichment.publicationName,
      publicationYear: enrichment.publicationYear,
    })
    .where(eq(quiltPatterns.id, id));

  const [updated] = await db
    .select()
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, id))
    .limit(1);
  res.json(GetPatternResponse.parse(await serializePattern(updated)));
});

// ---------------------------------------------------------------------------
// AI block schema extraction from pattern image (#90)
// ---------------------------------------------------------------------------

router.post("/patterns/:id/extract-blocks", aiLimiter, async (req, res) => {
  const { id } = GetPatternParams.parse(req.params);
  const [row] = await db
    .select({ imagePath: quiltPatterns.imagePath, name: quiltPatterns.name })
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Pattern not found." });
    return;
  }
  if (!row.imagePath) {
    res.status(422).json({
      error: "This pattern has no image to extract a block from.",
    });
    return;
  }

  const dataUrl = await downloadImageAsDataUrl(row.imagePath);
  const result = await extractBlockFromImage(dataUrl);
  res.json(result);
});

export default router;
