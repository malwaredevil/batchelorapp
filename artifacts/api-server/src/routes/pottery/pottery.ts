import { Router, type IRouter } from "express";
import multer from "multer";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  potteryItems,
  potteryCategories as categories,
  potteryItemCategories as itemCategories,
  potteryImages,
  type PotteryItemRow,
} from "@workspace/db";

import {
  ListPotteryResponse,
  GetPotteryParams,
  GetPotteryResponse,
  UpdatePotteryParams,
  UpdatePotteryBody,
  UpdatePotteryResponse,
  DeletePotteryParams,
  AddPotteryImageParams,
  UpdatePotteryImageParams,
  UpdatePotteryImageBody,
  DeletePotteryImageParams,
  GetStragglersResponse,
  BulkReanalyzePotteryBody,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import {
  aiLimiter,
  bulkAiLimiter,
  supplementalUploadLimiter,
} from "../../middleware/rateLimit";
import {
  sniffImageType,
  stripImageMetadata,
  toDataUrl,
} from "../../lib/pottery/image";
import {
  uploadImage,
  deleteImage,
  downloadImageBuffer,
} from "../../lib/pottery/storage";
import {
  analyzeImage,
  analyzePotteryZones,
  locateBackstampAndEnhanceMaker,
  buildEmbeddingText,
  embedText,
  type AnalysisContext,
} from "../../lib/pottery/openai";
import {
  generateVisualEmbedding,
  generateZoneEmbedding,
} from "../../lib/visual-embed";
import { serializeItem, serializeItems } from "../../lib/pottery/serialize";
import { logger } from "../../lib/logger";

// All columns except the three embedding vectors — the 1536-dim text embedding,
// the 1024-dim whole-piece visual embedding, and the 1024-dim zone embedding are
// only needed in the compare route's similarity search; excluding them from
// list/detail queries cuts several KB per row from every collection page load.
const {
  embedding: _embedding,
  visualEmbedding: _visualEmbedding,
  zoneEmbedding: _zoneEmbedding,
  ...itemColumns
} = getTableColumns(potteryItems);

const MAX_NAME = 200;
const MAX_NOTES = 4000;
const MAX_TEXT = 500;
const MAX_LABEL = 100;

/** Hard cap on how many supplemental images one pottery item may have. */
const MAX_SUPPLEMENTAL_IMAGES = 20;
/**
 * Maximum number of supplemental images forwarded to the AI in a single
 * analysis call (primary + this many supplemental = MAX_AI_IMAGES + 1 total).
 * Keeps in-memory buffer use and OpenAI token cost bounded regardless of how
 * many images are stored.
 */
const MAX_AI_SUPPLEMENTAL = 5;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8, fieldSize: 8192 },
});

function clampField(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

/** Sentence-case a user-supplied short field: first letter upper, rest lower. */
function sentenceCase(value: string | null): string | null {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

router.get("/items", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select(itemColumns)
    .from(potteryItems)
    .where(eq(potteryItems.userId, userId))
    .orderBy(desc(potteryItems.createdAt));
  const items = await serializeItems(rows);
  res.json(ListPotteryResponse.parse(items));
});

// Stragglers: pieces that need re-analysis — either missing a similarity
// embedding (so they're invisible to the "Do I own this?" compare) or with no
// descriptive attributes extracted at all. Registered BEFORE `/pottery/:id` so
// the literal `stragglers` segment isn't captured as an `:id` param.
router.get("/items/stragglers", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select({
      id: potteryItems.id,
      missingEmbedding: sql<boolean>`${potteryItems.embedding} is null`,
      missingAttributes: sql<boolean>`(${potteryItems.patternDescription} is null and ${potteryItems.style} is null and ${potteryItems.shape} is null)`,
    })
    .from(potteryItems)
    .where(
      and(
        eq(potteryItems.userId, userId),
        or(
          isNull(potteryItems.embedding),
          and(
            isNull(potteryItems.patternDescription),
            isNull(potteryItems.style),
            isNull(potteryItems.shape),
          ),
        ),
      ),
    )
    .orderBy(desc(potteryItems.createdAt));

  const items = rows.map((row) => {
    const reasons: ("embedding" | "attributes")[] = [];
    if (row.missingEmbedding) reasons.push("embedding");
    if (row.missingAttributes) reasons.push("attributes");
    return { id: row.id, reasons };
  });

  res.json(GetStragglersResponse.parse({ items }));
});

router.get("/items/:id", async (req, res) => {
  const { id } = GetPotteryParams.parse(req.params);
  const userId = req.session.userId!;
  const [row] = await db
    .select(itemColumns)
    .from(potteryItems)
    .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Pottery piece not found." });
    return;
  }
  res.json(GetPotteryResponse.parse(await serializeItem(row)));
});

router.post("/items", aiLimiter, upload.single("image"), async (req, res) => {
  const userId = req.session.userId!;
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "An image file is required." });
    return;
  }
  const contentType = sniffImageType(file.buffer);
  if (!contentType) {
    res.status(400).json({
      error: "Unsupported image. Please upload a JPEG, PNG, or WEBP photo.",
    });
    return;
  }

  // Strip all embedded metadata (EXIF, GPS, XMP, ICC) before any further use
  // of the image data — before it goes to OpenAI and before it is stored.
  const cleanBuffer = await stripImageMetadata(file.buffer, contentType);

  // Parse manually selected category IDs from the form field
  let manualCategoryIds: number[] = [];
  try {
    const raw = req.body?.categoryIds;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        manualCategoryIds = parsed
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0);
      }
    }
  } catch {
    // Ignore malformed field — manual categories are optional
  }

  const dataUrl = toDataUrl(cleanBuffer, contentType);

  // Phase 1: main cataloguing analysis, whole-piece visual embed, and zone
  // analysis all run in parallel. Each gracefully returns null when the
  // relevant API key is absent rather than hard-failing the upload.
  const [analysis, visualEmbedding, surfaceZones] = await Promise.all([
    analyzeImage([dataUrl]),
    generateVisualEmbedding(cleanBuffer).catch(() => null),
    analyzePotteryZones([dataUrl]).catch(() => null),
  ]);

  // Phase 2: text embed + zone embed in parallel (zone embed crops the center
  // 70% of the image to focus on the main decorative body).
  const [embedding, zoneEmbedding] = await Promise.all([
    embedText(buildEmbeddingText(analysis)),
    generateZoneEmbedding(cleanBuffer).catch(() => null),
  ]);

  // Optional backstamp enhancement: if the main analysis found no maker,
  // run a focused identification pass concentrated on marks and stamps.
  if (!analysis.maker) {
    const backstampResult = await locateBackstampAndEnhanceMaker([
      dataUrl,
    ]).catch(() => null);
    if (backstampResult?.maker) {
      analysis.maker = backstampResult.maker;
      analysis.makerInfo = backstampResult.makerInfo ?? analysis.makerInfo;
    }
  }

  const nameField = clampField(req.body?.name, MAX_NAME);
  const notesField = clampField(req.body?.notes, MAX_NOTES);
  const userDimensions = clampField(req.body?.dimensions, MAX_TEXT);
  const quantityField = Math.max(
    1,
    parseInt(req.body?.quantity ?? "1", 10) || 1,
  );

  const imagePath = await uploadImage(cleanBuffer, contentType);

  // Default acquiredAt to today's date
  const today = new Date().toISOString().slice(0, 10);

  try {
    const [row] = await db
      .insert(potteryItems)
      .values({
        userId,
        name: nameField ?? analysis.name,
        quantity: quantityField,
        notes: notesField,
        dimensions: userDimensions ?? analysis.dimensions,
        patternDescription: analysis.patternDescription,
        style: analysis.style,
        shape: analysis.shape,
        maker: analysis.maker,
        makerInfo: analysis.makerInfo,
        dominantColors: analysis.dominantColors,
        motifs: analysis.motifs,
        aiDescription: analysis.aiDescription,
        acquiredAt: today,
        imagePath,
        embedding,
        visualEmbedding,
        glazeType: analysis.glazeType,
        surfaceZones: surfaceZones ?? undefined,
        ...(zoneEmbedding ? { zoneEmbedding } : {}),
      })
      .returning();

    // Auto-match categories based on AI analysis, merged with user's manual picks.
    // Manual picks always win (union — nothing is ever removed).
    const allCats = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.userId, userId));

    // Normalise inch-mark variants so AI output (which may use ″ double-prime)
    // and user-typed category names (which use plain ") match each other.
    const normalizeQuotes = (s: string) => s.replace(/[″\u201C\u201D]/g, '"');

    const analysisText = normalizeQuotes(
      [
        analysis.name,
        analysis.style,
        analysis.shape,
        analysis.patternDescription,
        analysis.dimensions,
        ...(analysis.motifs ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    );

    // Match category names as whole words/phrases only — not as substrings of larger
    // numbers or words.  E.g. category "8"" must NOT match inside "18"" or "28"".
    // The lookbehind/lookahead rejects a match when it is immediately surrounded by
    // an alphanumeric character (a-z, 0-9), which catches digit-prefix false positives
    // (28 contains 8) and word-suffix false positives (plates contains plate).
    function categoryMatchesText(catName: string): boolean {
      const normalized = normalizeQuotes(catName.toLowerCase());
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
      return pattern.test(analysisText);
    }

    const autoCategoryIds = allCats
      .filter((cat) => categoryMatchesText(cat.name))
      .map((cat) => cat.id);

    // Restrict manual category picks to this user's own categories.
    // allCats is already scoped to userId above.
    const userCatIds = new Set(allCats.map((c) => c.id));
    const safeManualCategoryIds = manualCategoryIds.filter((id) =>
      userCatIds.has(id),
    );

    const allCategoryIds = [
      ...new Set([...autoCategoryIds, ...safeManualCategoryIds]),
    ];
    if (allCategoryIds.length > 0) {
      await db.insert(itemCategories).values(
        allCategoryIds.map((catId) => ({
          itemId: row.id,
          categoryId: catId,
        })),
      );
    }

    // Auto-assign (or remove) the "Duplicate" category based on quantity.
    await syncDuplicateCategory(row.id, row.quantity, userId);

    res.status(201).json(GetPotteryResponse.parse(await serializeItem(row)));
  } catch (err) {
    await deleteImage(imagePath).catch(() => {});
    throw err;
  }
});

router.patch("/items/:id", async (req, res) => {
  const { id } = UpdatePotteryParams.parse(req.params);
  const userId = req.session.userId!;
  const body = UpdatePotteryBody.parse(req.body);

  const fieldUpdates: Partial<typeof potteryItems.$inferInsert> = {};
  if (body.name !== undefined)
    fieldUpdates.name = clampField(body.name, MAX_NAME) ?? "Untitled piece";
  if (body.quantity !== undefined)
    fieldUpdates.quantity = Math.max(1, body.quantity);
  if (body.lockedFields !== undefined)
    fieldUpdates.lockedFields = body.lockedFields;
  if (body.notes !== undefined)
    fieldUpdates.notes = clampField(body.notes, MAX_NOTES);
  if (body.acquiredAt !== undefined) fieldUpdates.acquiredAt = body.acquiredAt;
  if (body.aiDescription !== undefined)
    fieldUpdates.aiDescription = clampField(body.aiDescription, MAX_NOTES);
  if (body.maker !== undefined)
    fieldUpdates.maker = sentenceCase(clampField(body.maker, MAX_TEXT));
  if (body.makerInfo !== undefined)
    fieldUpdates.makerInfo = clampField(body.makerInfo, MAX_NOTES);
  if (body.dimensions !== undefined)
    fieldUpdates.dimensions = clampField(body.dimensions, MAX_TEXT);

  let row: Omit<
    PotteryItemRow,
    "embedding" | "visualEmbedding" | "zoneEmbedding"
  >;

  if (Object.keys(fieldUpdates).length > 0) {
    const [updated] = await db
      .update(potteryItems)
      .set(fieldUpdates)
      .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
      .returning(itemColumns);
    if (!updated) {
      res.status(404).json({ error: "Pottery piece not found." });
      return;
    }
    row = updated;
  } else {
    const [existing] = await db
      .select(itemColumns)
      .from(potteryItems)
      .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Pottery piece not found." });
      return;
    }
    row = existing;
  }

  // Replace categories for this item if provided.
  // Only allow category IDs that belong to this user.
  if (body.categoryIds !== undefined) {
    const userCats = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.userId, userId));
    const userCatIds = new Set(userCats.map((c) => c.id));
    const safeCategoryIds = body.categoryIds.filter((catId) =>
      userCatIds.has(catId),
    );

    await db.transaction(async (tx) => {
      await tx.delete(itemCategories).where(eq(itemCategories.itemId, id));
      if (safeCategoryIds.length > 0) {
        await tx.insert(itemCategories).values(
          safeCategoryIds.map((catId) => ({
            itemId: id,
            categoryId: catId,
          })),
        );
      }
    });
  }

  // Re-sync the "Duplicate" category based on the item's current quantity.
  // Runs after any category replacement so it always wins, even if the user
  // didn't include "Duplicate" in their categoryIds list.
  await syncDuplicateCategory(id, row.quantity, userId);

  res.json(UpdatePotteryResponse.parse(await serializeItem(row)));
});

router.delete("/items/:id", async (req, res) => {
  const { id } = DeletePotteryParams.parse(req.params);
  const userId = req.session.userId!;

  // Collect all storage paths BEFORE deleting the DB row: the cascade on
  // pottery_images.item_id removes child rows the instant the parent is
  // deleted, so any query that runs afterwards returns nothing and leaves
  // objects stranded in the bucket forever.
  const [item] = await db
    .select({
      imagePath: potteryItems.imagePath,
      patternCropPath: potteryItems.patternCropPath,
    })
    .from(potteryItems)
    .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Pottery piece not found." });
    return;
  }
  const suppImages = await db
    .select({ storagePath: potteryImages.storagePath })
    .from(potteryImages)
    .where(eq(potteryImages.itemId, id));

  await db
    .delete(potteryItems)
    .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)));

  await Promise.all([
    deleteImage(item.imagePath),
    item.patternCropPath
      ? deleteImage(item.patternCropPath)
      : Promise.resolve(),
    ...suppImages.map((img) => deleteImage(img.storagePath)),
  ]);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Authenticated image delivery
// ---------------------------------------------------------------------------

router.get("/items/:id/image", async (req, res) => {
  const { id } = GetPotteryParams.parse(req.params);
  const userId = req.session.userId!;
  const [row] = await db
    .select({ imagePath: potteryItems.imagePath })
    .from(potteryItems)
    .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Pottery piece not found." });
    return;
  }
  const { buffer, contentType } = await downloadImageBuffer(row.imagePath);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=60");
  res.end(buffer);
});

// Supplemental image delivery
router.get("/items/:id/images/:imageId", async (req, res) => {
  const { id } = GetPotteryParams.parse(req.params);
  const userId = req.session.userId!;
  const imageId = Number(req.params.imageId);
  if (!Number.isFinite(imageId)) {
    res.status(400).json({ error: "Invalid image ID." });
    return;
  }
  // Verify item ownership before serving the image
  const [item] = await db
    .select({ id: potteryItems.id })
    .from(potteryItems)
    .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Pottery piece not found." });
    return;
  }
  const [row] = await db
    .select({
      storagePath: potteryImages.storagePath,
      itemId: potteryImages.itemId,
    })
    .from(potteryImages)
    .where(eq(potteryImages.id, imageId))
    .limit(1);
  if (!row || row.itemId !== id) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  const { buffer, contentType } = await downloadImageBuffer(row.storagePath);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=60");
  res.end(buffer);
});

// ---------------------------------------------------------------------------
// Supplemental image management
// ---------------------------------------------------------------------------

router.post(
  "/items/:id/images",
  supplementalUploadLimiter,
  upload.single("image"),
  async (req, res) => {
    const { id } = AddPotteryImageParams.parse(req.params);
    const userId = req.session.userId!;

    // Verify item exists and belongs to this user
    const [item] = await db
      .select({ id: potteryItems.id })
      .from(potteryItems)
      .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
      .limit(1);
    if (!item) {
      res.status(404).json({ error: "Pottery piece not found." });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "An image file is required." });
      return;
    }
    const contentType = sniffImageType(file.buffer);
    if (!contentType) {
      res.status(400).json({ error: "Unsupported image format." });
      return;
    }

    const cleanBuffer = await stripImageMetadata(file.buffer, contentType);
    const label = clampField(req.body?.label, MAX_LABEL);

    // Determine next position and enforce per-item count cap.
    const existing = await db
      .select({ position: potteryImages.position })
      .from(potteryImages)
      .where(eq(potteryImages.itemId, id))
      .orderBy(asc(potteryImages.position));
    if (existing.length >= MAX_SUPPLEMENTAL_IMAGES) {
      res.status(409).json({
        error: `This item already has the maximum number of supplemental images (${MAX_SUPPLEMENTAL_IMAGES}).`,
      });
      return;
    }
    const maxPos =
      existing.length > 0 ? Math.max(...existing.map((r) => r.position)) : -1;

    const storagePath = await uploadImage(cleanBuffer, contentType);
    try {
      const [newImg] = await db
        .insert(potteryImages)
        .values({ itemId: id, storagePath, label, position: maxPos + 1 })
        .returning();

      res.status(201).json({
        id: newImg.id,
        url: `/api/pottery/items/${id}/images/${newImg.id}`,
        label: newImg.label,
        position: newImg.position,
      });
    } catch (err) {
      await deleteImage(storagePath).catch(() => {});
      throw err;
    }
  },
);

router.patch("/items/:id/images/:imageId", async (req, res) => {
  const { id } = UpdatePotteryImageParams.parse(req.params);
  const userId = req.session.userId!;
  const imageId = Number(req.params.imageId);
  if (!Number.isFinite(imageId)) {
    res.status(400).json({ error: "Invalid image ID." });
    return;
  }
  const body = UpdatePotteryImageBody.parse(req.body);

  // Verify item ownership before modifying supplemental image
  const [item] = await db
    .select({ id: potteryItems.id })
    .from(potteryItems)
    .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Pottery piece not found." });
    return;
  }

  const [existing] = await db
    .select()
    .from(potteryImages)
    .where(eq(potteryImages.id, imageId))
    .limit(1);
  if (!existing || existing.itemId !== id) {
    res.status(404).json({ error: "Image not found." });
    return;
  }

  const updates: Partial<typeof potteryImages.$inferInsert> = {};
  if (body.label !== undefined)
    updates.label = body.label ? clampField(body.label, MAX_LABEL) : null;
  if (body.position !== undefined) updates.position = body.position;

  const [updated] =
    Object.keys(updates).length > 0
      ? await db
          .update(potteryImages)
          .set(updates)
          .where(eq(potteryImages.id, imageId))
          .returning()
      : [existing];

  res.json({
    id: updated.id,
    url: `/api/pottery/items/${id}/images/${updated.id}`,
    label: updated.label,
    position: updated.position,
  });
});

router.delete("/items/:id/images/:imageId", async (req, res) => {
  const { id } = DeletePotteryImageParams.parse(req.params);
  const userId = req.session.userId!;
  const imageId = Number(req.params.imageId);
  if (!Number.isFinite(imageId)) {
    res.status(400).json({ error: "Invalid image ID." });
    return;
  }

  // Verify item ownership BEFORE touching any data.
  // Previous code deleted first and checked afterwards, which allowed
  // removing images from items that didn't match the requested :id.
  const [item] = await db
    .select({ id: potteryItems.id })
    .from(potteryItems)
    .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Pottery piece not found." });
    return;
  }

  const [imageRow] = await db
    .select({
      storagePath: potteryImages.storagePath,
      itemId: potteryImages.itemId,
    })
    .from(potteryImages)
    .where(eq(potteryImages.id, imageId))
    .limit(1);
  if (!imageRow || imageRow.itemId !== id) {
    res.status(404).json({ error: "Image not found." });
    return;
  }

  await db.delete(potteryImages).where(eq(potteryImages.id, imageId));
  await deleteImage(imageRow.storagePath).catch(() => {});
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Duplicate-category sync — purely data-driven, no AI needed
// ---------------------------------------------------------------------------

/**
 * Ensures the "Duplicate" category (matched case-insensitively by name) is
 * assigned to or removed from a pottery item based solely on its quantity.
 *
 *   quantity > 1  → guarantee the association exists (INSERT … ON CONFLICT DO NOTHING)
 *   quantity <= 1 → guarantee the association is absent (DELETE if present)
 *
 * If no category named "Duplicate" exists, this is a no-op.
 */
async function syncDuplicateCategory(
  itemId: number,
  quantity: number,
  userId: number,
): Promise<void> {
  const [dupCat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        sql`lower(${categories.name}) = 'duplicate'`,
        eq(categories.userId, userId),
      ),
    )
    .limit(1);
  if (!dupCat) return;

  if (quantity > 1) {
    await db
      .insert(itemCategories)
      .values({ itemId, categoryId: dupCat.id })
      .onConflictDoNothing();
  } else {
    await db
      .delete(itemCategories)
      .where(
        and(
          eq(itemCategories.itemId, itemId),
          eq(itemCategories.categoryId, dupCat.id),
        ),
      );
  }
}

// ---------------------------------------------------------------------------
// Shared AI analysis pipeline — used by both reanalyze and set-primary-image
// ---------------------------------------------------------------------------

async function runItemAnalysis(id: number, userId: number): Promise<unknown> {
  const [item] = await db
    .select(itemColumns)
    .from(potteryItems)
    .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
    .limit(1);
  if (!item)
    throw Object.assign(new Error("Pottery piece not found."), { status: 404 });

  const suppRows = (
    await db
      .select({ storagePath: potteryImages.storagePath })
      .from(potteryImages)
      .where(eq(potteryImages.itemId, id))
      .orderBy(asc(potteryImages.position))
  ).slice(0, MAX_AI_SUPPLEMENTAL);

  const [primaryResult, ...suppResults] = await Promise.all([
    downloadImageBuffer(item.imagePath),
    ...suppRows.map((r) => downloadImageBuffer(r.storagePath)),
  ]);

  const primaryContentType =
    sniffImageType(primaryResult.buffer) ?? "image/jpeg";
  const dataUrls = [
    toDataUrl(primaryResult.buffer, primaryContentType),
    ...suppResults.map((r) =>
      toDataUrl(r.buffer, sniffImageType(r.buffer) ?? "image/jpeg"),
    ),
  ];

  // Pass existing field values as context so locked facts anchor the refresh
  // and previously-known values give the AI a better starting point.
  const reanalysisContext: AnalysisContext = {
    lockedFields: item.lockedFields ?? [],
    name: item.name,
    patternDescription: item.patternDescription,
    style: item.style,
    shape: item.shape,
    maker: item.maker,
    makerInfo: item.makerInfo,
    dimensions: item.dimensions,
    dominantColors: item.dominantColors,
    motifs: item.motifs,
  };

  // Phase 1: analysis + visual embed + zone analysis in parallel.
  // All three use .catch(() => null) so a single API error (e.g. Jina rate
  // limit) cannot kill the whole item — the analysis itself still succeeds and
  // existing embedding values are left untouched (see spread below).
  const [analysis, visualEmbedding, surfaceZones] = await Promise.all([
    analyzeImage(dataUrls, reanalysisContext),
    generateVisualEmbedding(primaryResult.buffer).catch(() => null),
    analyzePotteryZones(dataUrls).catch(() => null),
  ]);

  // Phase 2: text embed + zone embed in parallel.
  const [embedding, zoneEmbedding] = await Promise.all([
    embedText(buildEmbeddingText(analysis)),
    generateZoneEmbedding(primaryResult.buffer).catch(() => null),
  ]);

  // Optional backstamp enhancement when no maker was found in the main pass.
  if (!analysis.maker) {
    const backstampResult = await locateBackstampAndEnhanceMaker(
      dataUrls,
    ).catch(() => null);
    if (backstampResult?.maker) {
      analysis.maker = backstampResult.maker;
      analysis.makerInfo = backstampResult.makerInfo ?? analysis.makerInfo;
    }
  }

  const locked = new Set(item.lockedFields ?? []);
  const keep = <T>(field: string, aiVal: T, existing: T): T =>
    locked.has(field) ? existing : (aiVal ?? existing);

  const merged = {
    name: keep("name", analysis.name, item.name),
    patternDescription: keep(
      "patternDescription",
      analysis.patternDescription,
      item.patternDescription,
    ),
    style: keep("style", analysis.style, item.style),
    shape: keep("shape", analysis.shape, item.shape),
    maker: keep("maker", analysis.maker, item.maker),
    makerInfo: keep("makerInfo", analysis.makerInfo, item.makerInfo),
    dimensions: keep("dimensions", analysis.dimensions, item.dimensions),
    dominantColors: locked.has("dominantColors")
      ? item.dominantColors
      : analysis.dominantColors.length
        ? analysis.dominantColors
        : item.dominantColors,
    motifs: locked.has("motifs")
      ? item.motifs
      : analysis.motifs.length
        ? analysis.motifs
        : item.motifs,
    aiDescription: keep(
      "aiDescription",
      analysis.aiDescription,
      item.aiDescription,
    ),
    embedding,
    glazeType: keep("glazeType", analysis.glazeType, item.glazeType ?? null),
    surfaceZones: surfaceZones ?? item.surfaceZones ?? null,
    // Only overwrite embeddings when newly generated — leaves existing column
    // values untouched when JINA_API_KEY is absent.
    ...(visualEmbedding ? { visualEmbedding } : {}),
    ...(zoneEmbedding ? { zoneEmbedding } : {}),
  };

  const [updated] = await db
    .update(potteryItems)
    .set(merged)
    .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
    .returning(itemColumns);

  // Re-run category auto-matching (union-only — never removes existing assignments).
  const normalizeQ = (s: string) => s.replace(/[″\u201C\u201D]/g, '"');
  const analysisText = normalizeQ(
    [
      merged.name,
      merged.style,
      merged.shape,
      merged.patternDescription,
      merged.dimensions,
      ...(Array.isArray(merged.motifs) ? merged.motifs : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  );

  const allCats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.userId, userId));
  const existingCatRows = await db
    .select({ categoryId: itemCategories.categoryId })
    .from(itemCategories)
    .where(eq(itemCategories.itemId, id));
  const existingCatIds = new Set(existingCatRows.map((r) => r.categoryId));

  const newCatIds = allCats
    .filter((cat) => {
      const norm = normalizeQ(cat.name.toLowerCase());
      const esc = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i").test(
        analysisText,
      );
    })
    .map((cat) => cat.id)
    .filter((catId) => !existingCatIds.has(catId));

  if (newCatIds.length > 0) {
    await db
      .insert(itemCategories)
      .values(newCatIds.map((catId) => ({ itemId: id, categoryId: catId })));
  }

  // Sync the "Duplicate" category based on quantity (unchanged by reanalysis,
  // but the category may have been manually removed — re-assert it here).
  await syncDuplicateCategory(id, item.quantity, userId);

  return GetPotteryResponse.parse(await serializeItem(updated));
}

// ---------------------------------------------------------------------------
// Re-analyze: re-run AI pipeline on the existing primary image
// ---------------------------------------------------------------------------

router.post("/items/:id/reanalyze", aiLimiter, async (req, res) => {
  const { id } = GetPotteryParams.parse(req.params);
  const userId = req.session.userId!;
  try {
    res.json(await runItemAnalysis(id, userId));
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.status(status).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Bulk re-analyze with AI
// ---------------------------------------------------------------------------

const MAX_BULK_REANALYZE = 20;

router.post("/items/bulk-reanalyze", bulkAiLimiter, async (req, res) => {
  const { ids } = BulkReanalyzePotteryBody.parse(req.body);
  const userId = req.session.userId!;
  const capped = [...new Set(ids)].slice(0, MAX_BULK_REANALYZE);
  const succeeded: number[] = [];
  const failed: number[] = [];

  for (let i = 0; i < capped.length; i++) {
    const id = capped[i]!;
    try {
      await runItemAnalysis(id, userId);
      succeeded.push(id);
    } catch (err) {
      logger.error({ itemId: id, err }, "bulk-reanalyze: item failed");
      failed.push(id);
    }
    // Brief pause between items so we don't burst-fire Jina/OpenRouter
    // requests fast enough to trigger their rate limiters.
    if (i < capped.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  res.json({ succeeded, failed });
});

// ---------------------------------------------------------------------------
// Set primary image: swap a supplemental image to primary, then re-analyse
// ---------------------------------------------------------------------------

router.post("/items/:id/set-primary-image", aiLimiter, async (req, res) => {
  const { id } = GetPotteryParams.parse(req.params);
  const userId = req.session.userId!;

  const imageId = Number(req.body?.imageId);
  if (!Number.isInteger(imageId) || imageId <= 0) {
    res.status(400).json({ error: "imageId must be a positive integer." });
    return;
  }

  // Fetch item to get the current primary path — enforce ownership
  const [item] = await db
    .select(itemColumns)
    .from(potteryItems)
    .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Pottery piece not found." });
    return;
  }

  // Fetch the supplemental image to be promoted
  const [suppImage] = await db
    .select()
    .from(potteryImages)
    .where(eq(potteryImages.id, imageId))
    .limit(1);
  if (!suppImage || suppImage.itemId !== id) {
    res.status(404).json({ error: "Image not found." });
    return;
  }

  // Swap: supplemental row takes the old primary path, item gets the supplemental path
  const oldPrimaryPath = item.imagePath;
  const newPrimaryPath = suppImage.storagePath;

  await db
    .update(potteryImages)
    .set({ storagePath: oldPrimaryPath })
    .where(eq(potteryImages.id, imageId));

  await db
    .update(potteryItems)
    .set({ imagePath: newPrimaryPath })
    .where(and(eq(potteryItems.id, id), eq(potteryItems.userId, userId)));

  // Re-analyse with the new primary image in place
  try {
    res.json(await runItemAnalysis(id, userId));
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.status(status).json({ error: message });
  }
});

export default router;
