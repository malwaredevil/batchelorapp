import { Router, type IRouter } from "express";
import multer from "multer";
import pLimit from "p-limit";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  db,
  ornamentsItems,
  ornamentsCategories as categories,
  ornamentsItemCategories as itemCategories,
  ornamentsImages,
  type OrnamentItemRow,
} from "@workspace/db";

import {
  ListOrnamentsResponse,
  ListOrnamentsQueryParams,
  GetOrnamentParams,
  GetOrnamentResponse,
  UpdateOrnamentParams,
  UpdateOrnamentBody,
  UpdateOrnamentResponse,
  DeleteOrnamentParams,
  AddOrnamentImageParams,
  UpdateOrnamentImageParams,
  UpdateOrnamentImageBody,
  DeleteOrnamentImageParams,
  GetOrnamentStragglersResponse,
  BulkReanalyzeOrnamentsBody,
  LookupOrnamentBarcodeParams,
  LookupOrnamentBarcodeBody,
  LookupOrnamentBarcodeResponse,
  LookupBarcodeBody,
  LookupBarcodeResponse,
  LookupOrnamentBookValueParams,
  LookupOrnamentBookValueResponse,
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
} from "../../lib/ornaments/image";
import {
  uploadImage,
  deleteImage,
  downloadImageBuffer,
} from "../../lib/ornaments/storage";
import {
  analyzeOrnamentImage,
  buildEmbeddingText,
  embedText,
} from "../../lib/ornaments/openai";
import { lookupBarcode } from "../../lib/ornaments/barcode";
import { lookupBookValue } from "../../lib/ornaments/book-value";
import { serializeItem, serializeItems } from "../../lib/ornaments/serialize";
import { logger } from "../../lib/logger";
import {
  buildOrnamentSearchDocument,
  semanticCollectionSearch,
} from "../../lib/collection-search";

// Excludes the embedding + visualEmbedding vectors from list/detail queries —
// they're large and only needed internally, never surfaced via the API.
const {
  embedding: _embedding,
  visualEmbedding: _visualEmbedding,
  ...itemColumns
} = getTableColumns(ornamentsItems);

const MAX_NAME = 200;
const MAX_NOTES = 4000;
const MAX_TEXT = 500;
const MAX_LABEL = 100;

const MAX_SUPPLEMENTAL_IMAGES = 20;
const MAX_AI_SUPPLEMENTAL = 5;
export const MAX_BULK_REANALYZE = 20;
const BULK_REANALYZE_CONCURRENCY = 3;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8, fieldSize: 8192 },
});

function clampField(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

router.get("/items", async (req, res) => {
  const parsed = ListOrnamentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters." });
    return;
  }
  const { q, categoryId, seriesOrCollection, year, page, pageSize } =
    parsed.data;

  async function getCategoryItemIds(): Promise<number[] | undefined> {
    if (categoryId === undefined) return undefined;
    const catRows = await db
      .select({ itemId: itemCategories.itemId })
      .from(itemCategories)
      .where(eq(itemCategories.categoryId, categoryId));
    return catRows.map((r) => r.itemId);
  }

  async function runKeywordSearch(searchMode: "keyword" = "keyword") {
    const conditions: SQL<unknown>[] = [];
    if (q && q.trim()) {
      const term = `%${q.trim().toLowerCase()}%`;
      conditions.push(
        or(
          ilike(ornamentsItems.name, term),
          ilike(ornamentsItems.seriesOrCollection, term),
          ilike(ornamentsItems.brand, term),
          ilike(ornamentsItems.notes, term),
        )!,
      );
    }
    if (seriesOrCollection) {
      conditions.push(
        eq(ornamentsItems.seriesOrCollection, seriesOrCollection),
      );
    }
    if (year !== undefined) {
      conditions.push(eq(ornamentsItems.year, year));
    }

    const itemIdsForCategory = await getCategoryItemIds();
    if (itemIdsForCategory?.length === 0) {
      res.json(
        ListOrnamentsResponse.parse({
          items: [],
          total: 0,
          page,
          pageSize,
          searchMode,
        }),
      );
      return;
    }
    if (itemIdsForCategory) {
      conditions.push(inArray(ornamentsItems.id, itemIdsForCategory));
    }

    const where =
      conditions.length > 0
        ? and(...(conditions as [SQL<unknown>, ...SQL<unknown>[]]))
        : undefined;

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(ornamentsItems)
      .where(where);

    const offset = (page - 1) * pageSize;
    const rows = await db
      .select(itemColumns)
      .from(ornamentsItems)
      .where(where)
      .orderBy(desc(ornamentsItems.createdAt))
      .limit(pageSize)
      .offset(offset);

    const items = await serializeItems(rows);
    res.json(
      ListOrnamentsResponse.parse({
        items,
        total,
        page,
        pageSize,
        searchMode,
      }),
    );
  }

  if (q && q.trim()) {
    const itemIdsForCategory = await getCategoryItemIds();
    if (itemIdsForCategory?.length === 0) {
      res.json(
        ListOrnamentsResponse.parse({
          items: [],
          total: 0,
          page,
          pageSize,
          searchMode: "semantic",
        }),
      );
      return;
    }

    const extraWhereConditions: SQL<unknown>[] = [];
    if (seriesOrCollection) {
      extraWhereConditions.push(
        eq(ornamentsItems.seriesOrCollection, seriesOrCollection),
      );
    }
    if (year !== undefined)
      extraWhereConditions.push(eq(ornamentsItems.year, year));
    if (itemIdsForCategory) {
      extraWhereConditions.push(inArray(ornamentsItems.id, itemIdsForCategory));
    }

    const rankedIds = await semanticCollectionSearch({
      query: q.trim(),
      table: ornamentsItems,
      textEmbeddingCol: "embedding",
      visualEmbeddingCol: "visual_embedding",
      limit: pageSize,
      extraWhere:
        extraWhereConditions.length > 0
          ? and(...(extraWhereConditions as [SQL<unknown>, ...SQL<unknown>[]]))
          : undefined,
      db,
      fetchDocuments: async (ids) => {
        const rows = await db
          .select({
            id: ornamentsItems.id,
            name: ornamentsItems.name,
            brand: ornamentsItems.brand,
            seriesOrCollection: ornamentsItems.seriesOrCollection,
            year: ornamentsItems.year,
            notes: ornamentsItems.notes,
            motifs: ornamentsItems.motifs,
            dominantColors: ornamentsItems.dominantColors,
            aiDescription: ornamentsItems.aiDescription,
          })
          .from(ornamentsItems)
          .where(inArray(ornamentsItems.id, ids));
        return rows.map((row) => ({
          id: row.id,
          text: buildOrnamentSearchDocument(row),
        }));
      },
    });

    if (rankedIds.length > 0) {
      const rows = await db
        .select(itemColumns)
        .from(ornamentsItems)
        .where(inArray(ornamentsItems.id, rankedIds));
      const idOrder = new Map(rankedIds.map((id, index) => [id, index]));
      rows.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
      const items = await serializeItems(rows);
      res.json(
        ListOrnamentsResponse.parse({
          items,
          total: items.length,
          page: 1,
          pageSize: items.length,
          searchMode: "semantic",
        }),
      );
      return;
    }
  }

  await runKeywordSearch();
});

// Registered BEFORE /items/:id so the literal "stragglers" segment isn't
// captured as an :id param.
router.get("/items/stragglers", async (_req, res) => {
  const rows = await db
    .select({
      id: ornamentsItems.id,
      missingEmbedding: sql<boolean>`${ornamentsItems.embedding} is null`,
      missingAttributes: sql<boolean>`(${ornamentsItems.seriesOrCollection} is null and ${ornamentsItems.year} is null)`,
    })
    .from(ornamentsItems)
    .where(
      or(
        isNull(ornamentsItems.embedding),
        and(
          isNull(ornamentsItems.seriesOrCollection),
          isNull(ornamentsItems.year),
        ),
      ),
    )
    .orderBy(desc(ornamentsItems.createdAt));

  const items = rows.map((row) => {
    const reasons: ("embedding" | "attributes")[] = [];
    if (row.missingEmbedding) reasons.push("embedding");
    if (row.missingAttributes) reasons.push("attributes");
    return { id: row.id, reasons };
  });

  res.json(GetOrnamentStragglersResponse.parse({ items }));
});

// Barcode lookup for the add-item form — not scoped to an existing item.
// Registered before /items/:id/* routes below to avoid path ambiguity (this
// is a distinct top-level path, /items/lookup-barcode, not /items/:id/...).
router.post("/items/lookup-barcode", async (req, res) => {
  const { barcode } = LookupBarcodeBody.parse(req.body);
  const result = await lookupBarcode(barcode);
  res.json(
    LookupBarcodeResponse.parse({
      found: result.found,
      name: result.name,
      brand: result.brand,
      seriesOrCollection: result.seriesOrCollection,
      year: result.year,
      description: result.description,
      imageUrl: result.imageUrl,
    }),
  );
});

router.get("/items/:id", async (req, res) => {
  const { id } = GetOrnamentParams.parse(req.params);
  const [row] = await db
    .select(itemColumns)
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Ornament not found." });
    return;
  }
  res.json(GetOrnamentResponse.parse(await serializeItem(row)));
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

  const cleanBuffer = await stripImageMetadata(file.buffer, contentType);

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
  const analysis = await analyzeOrnamentImage([dataUrl]);
  const embedding = await embedText(buildEmbeddingText(analysis));

  const nameField = clampField(req.body?.name, MAX_NAME);
  const notesField = clampField(req.body?.notes, MAX_NOTES);
  const userDimensions = clampField(req.body?.dimensions, MAX_TEXT);
  const brandField = clampField(req.body?.brand, MAX_TEXT);
  const conditionField = clampField(req.body?.condition, MAX_TEXT);
  const originField = clampField(req.body?.origin, MAX_TEXT);
  const barcodeField =
    clampField(req.body?.barcodeValue, MAX_TEXT) ??
    clampField(analysis.upc, MAX_TEXT);
  const quantityField = Math.max(
    1,
    parseInt(req.body?.quantity ?? "1", 10) || 1,
  );

  // If the vision analysis detected a barcode on the packaging, auto-enrich
  // with UPC lookup data (name/brand/series/year) — user-supplied and
  // AI-vision fields still take priority over the barcode lookup.
  let barcodeLookup: Awaited<ReturnType<typeof lookupBarcode>> | null = null;
  if (barcodeField) {
    try {
      barcodeLookup = await lookupBarcode(barcodeField);
    } catch (err) {
      logger.warn(
        { err, barcode: barcodeField },
        "Auto barcode lookup failed during ornament create",
      );
    }
  }

  const imagePath = await uploadImage(cleanBuffer, contentType);
  const today = new Date().toISOString().slice(0, 10);

  try {
    const [row] = await db
      .insert(ornamentsItems)
      .values({
        userId,
        name:
          nameField ??
          analysis.name ??
          (barcodeLookup?.found ? barcodeLookup.name : null),
        brand:
          brandField ??
          (barcodeLookup?.found ? barcodeLookup.brand : null) ??
          "Hallmark",
        seriesOrCollection:
          analysis.seriesOrCollection ??
          (barcodeLookup?.found ? barcodeLookup.seriesOrCollection : null),
        year:
          analysis.year ?? (barcodeLookup?.found ? barcodeLookup.year : null),
        barcodeValue: barcodeField,
        quantity: quantityField,
        notes: notesField,
        dimensions: userDimensions ?? analysis.dimensions,
        condition: conditionField,
        origin: originField,
        aiDescription: analysis.aiDescription,
        dominantColors: analysis.dominantColors,
        motifs: analysis.motifs,
        acquiredAt: today,
        imagePath,
        embedding,
      })
      .returning();

    // Categories are a shared household set — auto-match plus manual picks.
    const allCats = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories);
    const normalizeQuotes = (s: string) => s.replace(/[″\u201C\u201D]/g, '"');
    const analysisText = normalizeQuotes(
      [
        analysis.name,
        analysis.seriesOrCollection,
        analysis.dimensions,
        ...(analysis.motifs ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    );
    function categoryMatchesText(catName: string): boolean {
      const normalized = normalizeQuotes(catName.toLowerCase());
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
      return pattern.test(analysisText);
    }
    const autoCategoryIds = allCats
      .filter((cat) => categoryMatchesText(cat.name))
      .map((cat) => cat.id);
    const allCatIds = new Set(allCats.map((c) => c.id));
    const safeManualCategoryIds = manualCategoryIds.filter((id) =>
      allCatIds.has(id),
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

    res.status(201).json(GetOrnamentResponse.parse(await serializeItem(row)));
  } catch (err) {
    await deleteImage(imagePath).catch(() => {});
    throw err;
  }
});

router.patch("/items/:id", async (req, res) => {
  const { id } = UpdateOrnamentParams.parse(req.params);
  const body = UpdateOrnamentBody.parse(req.body);

  const fieldUpdates: Partial<typeof ornamentsItems.$inferInsert> = {};
  if (body.name !== undefined)
    fieldUpdates.name = clampField(body.name, MAX_NAME) ?? "Untitled ornament";
  if (body.brand !== undefined)
    fieldUpdates.brand = clampField(body.brand, MAX_TEXT) ?? "Hallmark";
  if (body.seriesOrCollection !== undefined)
    fieldUpdates.seriesOrCollection = clampField(
      body.seriesOrCollection,
      MAX_TEXT,
    );
  if (body.year !== undefined) fieldUpdates.year = body.year;
  if (body.barcodeValue !== undefined)
    fieldUpdates.barcodeValue = clampField(body.barcodeValue, MAX_TEXT);
  if (body.quantity !== undefined)
    fieldUpdates.quantity = Math.max(1, body.quantity);
  if (body.lockedFields !== undefined)
    fieldUpdates.lockedFields = body.lockedFields;
  if (body.notes !== undefined)
    fieldUpdates.notes = clampField(body.notes, MAX_NOTES);
  if (body.acquiredAt !== undefined) fieldUpdates.acquiredAt = body.acquiredAt;
  if (body.aiDescription !== undefined)
    fieldUpdates.aiDescription = clampField(body.aiDescription, MAX_NOTES);
  if (body.dimensions !== undefined)
    fieldUpdates.dimensions = clampField(body.dimensions, MAX_TEXT);
  if (body.condition !== undefined)
    fieldUpdates.condition = clampField(body.condition, MAX_TEXT);
  if (body.origin !== undefined)
    fieldUpdates.origin = clampField(body.origin, MAX_TEXT);
  if (body.bookValue !== undefined)
    fieldUpdates.bookValue =
      body.bookValue === null ? null : String(body.bookValue);
  if (body.bookValueSource !== undefined)
    fieldUpdates.bookValueSource = clampField(body.bookValueSource, MAX_TEXT);
  if (
    body.bookValue !== undefined &&
    fieldUpdates.bookValue !== null &&
    body.bookValue !== null
  ) {
    fieldUpdates.bookValueUpdatedAt = new Date();
  }

  let row: Omit<OrnamentItemRow, "embedding" | "visualEmbedding">;
  if (Object.keys(fieldUpdates).length > 0) {
    const [updated] = await db
      .update(ornamentsItems)
      .set(fieldUpdates)
      .where(eq(ornamentsItems.id, id))
      .returning(itemColumns);
    if (!updated) {
      res.status(404).json({ error: "Ornament not found." });
      return;
    }
    row = updated;
  } else {
    const [existing] = await db
      .select(itemColumns)
      .from(ornamentsItems)
      .where(eq(ornamentsItems.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Ornament not found." });
      return;
    }
    row = existing;
  }

  if (body.categoryIds !== undefined) {
    const allCats = await db.select({ id: categories.id }).from(categories);
    const allCatIds = new Set(allCats.map((c) => c.id));
    const safeCategoryIds = body.categoryIds.filter((catId) =>
      allCatIds.has(catId),
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

  res.json(UpdateOrnamentResponse.parse(await serializeItem(row)));
});

router.delete("/items/:id", async (req, res) => {
  const { id } = DeleteOrnamentParams.parse(req.params);

  const [item] = await db
    .select({ imagePath: ornamentsItems.imagePath })
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Ornament not found." });
    return;
  }
  const suppImages = await db
    .select({ storagePath: ornamentsImages.storagePath })
    .from(ornamentsImages)
    .where(eq(ornamentsImages.itemId, id));

  await db.delete(ornamentsItems).where(eq(ornamentsItems.id, id));

  await Promise.all([
    deleteImage(item.imagePath),
    ...suppImages.map((img) => deleteImage(img.storagePath)),
  ]);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Authenticated image delivery
// ---------------------------------------------------------------------------

router.get("/items/:id/image", async (req, res) => {
  const { id } = GetOrnamentParams.parse(req.params);
  const [row] = await db
    .select({ imagePath: ornamentsItems.imagePath })
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Ornament not found." });
    return;
  }
  const { buffer, contentType } = await downloadImageBuffer(row.imagePath);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=60");
  res.end(buffer);
});

router.get("/items/:id/images/:imageId", async (req, res) => {
  const { id } = GetOrnamentParams.parse(req.params);
  const imageId = Number(req.params["imageId"]);
  if (!Number.isFinite(imageId)) {
    res.status(400).json({ error: "Invalid image ID." });
    return;
  }
  const [item] = await db
    .select({ id: ornamentsItems.id })
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Ornament not found." });
    return;
  }
  const [row] = await db
    .select({
      storagePath: ornamentsImages.storagePath,
      itemId: ornamentsImages.itemId,
    })
    .from(ornamentsImages)
    .where(eq(ornamentsImages.id, imageId))
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
    const { id } = AddOrnamentImageParams.parse(req.params);

    const [item] = await db
      .select({ id: ornamentsItems.id })
      .from(ornamentsItems)
      .where(eq(ornamentsItems.id, id))
      .limit(1);
    if (!item) {
      res.status(404).json({ error: "Ornament not found." });
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

    const existing = await db
      .select({ position: ornamentsImages.position })
      .from(ornamentsImages)
      .where(eq(ornamentsImages.itemId, id))
      .orderBy(asc(ornamentsImages.position));
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
        .insert(ornamentsImages)
        .values({ itemId: id, storagePath, label, position: maxPos + 1 })
        .returning();

      res.status(201).json({
        id: newImg.id,
        url: `/api/ornaments/items/${id}/images/${newImg.id}`,
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
  const { id } = UpdateOrnamentImageParams.parse(req.params);
  const imageId = Number(req.params["imageId"]);
  if (!Number.isFinite(imageId)) {
    res.status(400).json({ error: "Invalid image ID." });
    return;
  }
  const body = UpdateOrnamentImageBody.parse(req.body);

  const [item] = await db
    .select({ id: ornamentsItems.id })
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Ornament not found." });
    return;
  }

  const [existing] = await db
    .select()
    .from(ornamentsImages)
    .where(eq(ornamentsImages.id, imageId))
    .limit(1);
  if (!existing || existing.itemId !== id) {
    res.status(404).json({ error: "Image not found." });
    return;
  }

  const updates: Partial<typeof ornamentsImages.$inferInsert> = {};
  if (body.label !== undefined)
    updates.label = body.label ? clampField(body.label, MAX_LABEL) : null;
  if (body.position !== undefined) updates.position = body.position;

  const [updated] =
    Object.keys(updates).length > 0
      ? await db
          .update(ornamentsImages)
          .set(updates)
          .where(eq(ornamentsImages.id, imageId))
          .returning()
      : [existing];

  res.json({
    id: updated.id,
    url: `/api/ornaments/items/${id}/images/${updated.id}`,
    label: updated.label,
    position: updated.position,
  });
});

router.delete("/items/:id/images/:imageId", async (req, res) => {
  const { id } = DeleteOrnamentImageParams.parse(req.params);
  const imageId = Number(req.params["imageId"]);
  if (!Number.isFinite(imageId)) {
    res.status(400).json({ error: "Invalid image ID." });
    return;
  }

  const [item] = await db
    .select({ id: ornamentsItems.id })
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Ornament not found." });
    return;
  }

  const [imageRow] = await db
    .select({
      storagePath: ornamentsImages.storagePath,
      itemId: ornamentsImages.itemId,
    })
    .from(ornamentsImages)
    .where(eq(ornamentsImages.id, imageId))
    .limit(1);
  if (!imageRow || imageRow.itemId !== id) {
    res.status(404).json({ error: "Image not found." });
    return;
  }

  await db.delete(ornamentsImages).where(eq(ornamentsImages.id, imageId));
  await deleteImage(imageRow.storagePath).catch(() => {});
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Barcode lookup, scoped to an existing item (does not save — caller PATCHes)
// ---------------------------------------------------------------------------

router.post("/items/:id/lookup-barcode", async (req, res) => {
  const { id } = LookupOrnamentBarcodeParams.parse(req.params);
  const { barcode } = LookupOrnamentBarcodeBody.parse(req.body);

  const [item] = await db
    .select({ id: ornamentsItems.id })
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Ornament not found." });
    return;
  }

  const result = await lookupBarcode(barcode);
  res.json(
    LookupOrnamentBarcodeResponse.parse({
      found: result.found,
      name: result.name,
      brand: result.brand,
      seriesOrCollection: result.seriesOrCollection,
      year: result.year,
      description: result.description,
      imageUrl: result.imageUrl,
    }),
  );
});

// ---------------------------------------------------------------------------
// Book value lookup — fetches from hallmarkornaments.com /
// hookedonhallmark.com, saves the result, and returns the updated item.
// ---------------------------------------------------------------------------

router.post("/items/:id/lookup-book-value", aiLimiter, async (req, res) => {
  const { id } = LookupOrnamentBookValueParams.parse(req.params);

  const [item] = await db
    .select(itemColumns)
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Ornament not found." });
    return;
  }

  const result = await lookupBookValue({
    name: item.name,
    seriesOrCollection: item.seriesOrCollection,
    year: item.year,
  });

  if (!result) {
    res.status(422).json({
      error:
        "Could not find a book value for this ornament on hallmarkornaments.com or hookedonhallmark.com.",
    });
    return;
  }

  const [updated] = await db
    .update(ornamentsItems)
    .set({
      bookValue: String(result.value),
      bookValueSource: result.source,
      bookValueUpdatedAt: new Date(),
    })
    .where(eq(ornamentsItems.id, id))
    .returning(itemColumns);

  res.json(LookupOrnamentBookValueResponse.parse(await serializeItem(updated)));
});

// ---------------------------------------------------------------------------
// Shared AI analysis pipeline — used by both reanalyze and set-primary-image
// ---------------------------------------------------------------------------

export async function runItemAnalysis(id: number): Promise<unknown> {
  const [item] = await db
    .select(itemColumns)
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  if (!item)
    throw Object.assign(new Error("Ornament not found."), { status: 404 });

  const suppRows = (
    await db
      .select({ storagePath: ornamentsImages.storagePath })
      .from(ornamentsImages)
      .where(eq(ornamentsImages.itemId, id))
      .orderBy(asc(ornamentsImages.position))
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

  const analysis = await analyzeOrnamentImage(dataUrls);
  const embedding = await embedText(buildEmbeddingText(analysis));

  const locked = new Set(item.lockedFields ?? []);
  const keep = <T>(field: string, aiVal: T, existing: T): T =>
    locked.has(field) ? existing : (aiVal ?? existing);

  const merged = {
    name: keep("name", analysis.name, item.name),
    seriesOrCollection: keep(
      "seriesOrCollection",
      analysis.seriesOrCollection,
      item.seriesOrCollection,
    ),
    year: keep("year", analysis.year, item.year),
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
    barcodeValue: keep("barcodeValue", analysis.upc, item.barcodeValue),
    embedding,
  };

  const [updated] = await db
    .update(ornamentsItems)
    .set(merged)
    .where(eq(ornamentsItems.id, id))
    .returning(itemColumns);

  // Re-run category auto-matching (union-only — never removes existing assignments).
  const normalizeQ = (s: string) => s.replace(/[″\u201C\u201D]/g, '"');
  const analysisText = normalizeQ(
    [
      merged.name,
      merged.seriesOrCollection,
      merged.dimensions,
      ...merged.motifs,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  );

  const allCats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories);
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

  return GetOrnamentResponse.parse(await serializeItem(updated));
}

router.post("/items/:id/reanalyze", aiLimiter, async (req, res) => {
  const { id } = GetOrnamentParams.parse(req.params);
  try {
    res.json(await runItemAnalysis(id));
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.status(status).json({ error: message });
  }
});

export async function bulkReanalyzeOrnamentItems(ids: number[]): Promise<{
  total: number;
  succeeded: number[];
  failed: number[];
  errors: Array<{ id: number; error: string }>;
}> {
  const capped = [...new Set(ids)].slice(0, MAX_BULK_REANALYZE);
  const limit = pLimit(BULK_REANALYZE_CONCURRENCY);

  const results = await Promise.all(
    capped.map((id) =>
      limit(async () => {
        try {
          await runItemAnalysis(id);
          return { id, status: "ok" as const };
        } catch (err) {
          logger.error({ itemId: id, err }, "bulk-reanalyze: item failed");
          return {
            id,
            status: "error" as const,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    ),
  );

  const succeeded = results
    .filter((result) => result.status === "ok")
    .map((result) => result.id);
  const errors = results
    .filter(
      (
        result,
      ): result is Extract<(typeof results)[number], { status: "error" }> =>
        result.status === "error",
    )
    .map((result) => ({ id: result.id, error: result.error }));

  return {
    total: capped.length,
    succeeded,
    failed: errors.map((error) => error.id),
    errors,
  };
}

router.post("/items/bulk-reanalyze", bulkAiLimiter, async (req, res) => {
  const { ids } = BulkReanalyzeOrnamentsBody.parse(req.body);
  res.json(await bulkReanalyzeOrnamentItems(ids));
});

// ---------------------------------------------------------------------------
// Set primary image: swap a supplemental image to primary, then re-analyse
// ---------------------------------------------------------------------------

export async function promoteOrnamentImageToPrimary(
  id: number,
  imageId: number,
): Promise<unknown> {
  const [item] = await db
    .select(itemColumns)
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  if (!item)
    throw Object.assign(new Error("Ornament not found."), { status: 404 });

  const [suppImage] = await db
    .select()
    .from(ornamentsImages)
    .where(eq(ornamentsImages.id, imageId))
    .limit(1);
  if (!suppImage || suppImage.itemId !== id)
    throw Object.assign(new Error("Image not found."), { status: 404 });

  const oldPrimaryPath = item.imagePath;
  const newPrimaryPath = suppImage.storagePath;

  await db
    .update(ornamentsImages)
    .set({ storagePath: oldPrimaryPath })
    .where(eq(ornamentsImages.id, imageId));

  await db
    .update(ornamentsItems)
    .set({ imagePath: newPrimaryPath })
    .where(eq(ornamentsItems.id, id));

  return runItemAnalysis(id);
}

router.post("/items/:id/set-primary-image", aiLimiter, async (req, res) => {
  const { id } = GetOrnamentParams.parse(req.params);

  const imageId = Number(req.body?.imageId);
  if (!Number.isInteger(imageId) || imageId <= 0) {
    res.status(400).json({ error: "imageId must be a positive integer." });
    return;
  }

  try {
    res.json(await promoteOrnamentImageToPrimary(id, imageId));
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.status(status).json({ error: message });
  }
});

export default router;
