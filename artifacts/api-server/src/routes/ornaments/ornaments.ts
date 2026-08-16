import { Router, type IRouter } from "express";
import multer from "multer";
import { DEFAULT_MULTER_FILE_BYTES } from "../../middleware/uploadSizeGuard";
import { z } from "zod";
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
import { logActivity } from "../../lib/soft-delete";
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
  ReportBarcodeCorrectionBody,
  ReportBarcodeCorrectionResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import {
  aiLimiter,
  bulkAiLimiter,
  supplementalUploadLimiter,
} from "../../middleware/rateLimit";
import { toDataUrl } from "../../lib/ornaments/image";
import {
  createImageFileFilter,
  sniffImageType,
  sniffAndValidateMime,
  isImageMimeType,
  stripMetadata,
} from "@workspace/upload-validation";
import {
  uploadImage,
  deleteImage,
  downloadImageBuffer,
} from "../../lib/ornaments/storage";
import {
  analyzeOrnamentImage,
  appraiseOrnamentImage,
  buildEmbeddingText,
  embedText,
  extractBarcodeFromPhoto,
} from "../../lib/ornaments/openai";
import { lookupBarcode } from "../../lib/ornaments/barcode";
import { lookupBookValue } from "../../lib/ornaments/book-value";
import {
  lookupEbayMarketValue,
  lookupOrnamentEbayData,
  buildEbayQuery,
} from "../../lib/pottery/ebay-market-value";
import { env } from "../../lib/env";
import { serializeItem, serializeItems } from "../../lib/ornaments/serialize";
import { logger } from "../../lib/logger";
import pLimit from "p-limit";
import {
  semanticCollectionSearch,
  buildOrnamentSearchDocument,
} from "../../lib/collection-search";
import { getModels } from "../../lib/ai-client";
import {
  assignGenerationRunTarget,
  runAnalysisWithEvidence,
  runAnalysisWithEvidenceTrace,
} from "../../lib/ai-provenance";
import {
  matchCategoryIds,
  mergeExistingCategoryIds,
  parsePositiveIntegerArray,
} from "../../lib/collection-parsing";

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

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: DEFAULT_MULTER_FILE_BYTES,
    files: 1,
    fields: 8,
    fieldSize: 8192,
  },
  fileFilter: createImageFileFilter(ALLOWED_IMAGE_TYPES),
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

type OrnamentSort =
  | "newest"
  | "oldest"
  | "year-desc"
  | "year-asc"
  | "name-asc"
  | "name-desc"
  | "value-desc";

function ornamentOrder(sort: OrnamentSort) {
  switch (sort) {
    case "oldest":
      return [asc(ornamentsItems.createdAt)];
    case "year-desc":
      return [desc(ornamentsItems.year), asc(ornamentsItems.name)];
    case "year-asc":
      return [asc(ornamentsItems.year), asc(ornamentsItems.name)];
    case "name-asc":
      return [asc(ornamentsItems.name)];
    case "name-desc":
      return [desc(ornamentsItems.name)];
    case "value-desc":
      return [desc(ornamentsItems.bookValue), asc(ornamentsItems.name)];
    case "newest":
    default:
      return [desc(ornamentsItems.createdAt)];
  }
}

async function ornamentListMeta(
  where: SQL<unknown>,
  total: number,
  pageSize: number,
) {
  const [colorsResult, statsResult, categoryResult] = await Promise.all([
    db.execute<{ color: string }>(sql`
      select distinct unnest(dominant_colors) as color
      from ornaments_items
      where ${where}
      order by color
    `),
    db.execute<{
      brand_count: number;
      min_year: number | null;
      max_year: number | null;
    }>(sql`
      select count(distinct brand)::int as brand_count,
             min(year)::int as min_year,
             max(year)::int as max_year
      from ornaments_items
      where ${where}
    `),
    db.select({ value: count() }).from(categories),
  ]);
  const stats = statsResult.rows[0];
  return {
    totalPages: total === 0 ? 1 : Math.ceil(total / pageSize),
    facets: {
      colors: colorsResult.rows.map((row) => row.color).filter(Boolean),
    },
    stats: {
      categoryCount: Number(categoryResult[0]?.value ?? 0),
      brandCount: Number(stats?.brand_count ?? 0),
      minYear: stats?.min_year ?? null,
      maxYear: stats?.max_year ?? null,
    },
  };
}

router.get("/items", async (req, res) => {
  // Normalize categoryIds: Express parses a single query value as a scalar
  // string; Zod array validation rejects that. Wrap scalar in array first.
  const rawQuery = {
    ...req.query,
    ...(req.query.categoryIds !== undefined && {
      categoryIds: Array.isArray(req.query.categoryIds)
        ? req.query.categoryIds
        : [req.query.categoryIds],
    }),
  };
  const parsed = ListOrnamentsQueryParams.safeParse(rawQuery);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters." });
    return;
  }
  const {
    q,
    categoryId,
    categoryIds = [],
    uncategorized = false,
    color,
    seriesOrCollection,
    year,
    sort = "newest",
    page,
    pageSize,
  } = parsed.data;

  const conditions: SQL<unknown>[] = [isNull(ornamentsItems.deletedAt)];
  if (seriesOrCollection) {
    conditions.push(eq(ornamentsItems.seriesOrCollection, seriesOrCollection));
  }
  if (year !== undefined) conditions.push(eq(ornamentsItems.year, year));
  if (color)
    conditions.push(sql`${color} = any(${ornamentsItems.dominantColors})`);

  const selectedCategoryIds = Array.from(
    new Set([
      ...(categoryId !== undefined ? [categoryId] : []),
      ...categoryIds,
    ]),
  );
  if (selectedCategoryIds.length > 0 || uncategorized) {
    const categoryClauses: SQL<unknown>[] = [];
    if (selectedCategoryIds.length > 0) {
      categoryClauses.push(sql`exists (
        select 1 from ornaments_item_categories oic
        where oic.item_id = ${ornamentsItems.id}
          and oic.category_id in (${sql.join(
            selectedCategoryIds.map((id) => sql`${id}`),
            sql`, `,
          )})
      )`);
    }
    if (uncategorized) {
      categoryClauses.push(sql`not exists (
        select 1 from ornaments_item_categories oic
        where oic.item_id = ${ornamentsItems.id}
      )`);
    }
    conditions.push(or(...(categoryClauses as [SQL, ...SQL[]]))!);
  }

  const baseWhere = and(...(conditions as [SQL, ...SQL[]]))!;
  const offset = (page - 1) * pageSize;

  if (q && q.trim()) {
    try {
      const rankedIds = await semanticCollectionSearch({
        query: q.trim(),
        table: ornamentsItems,
        textEmbeddingCol: "embedding",
        visualEmbeddingCol: "visual_embedding",
        limit: 500,
        db,
        visibilityWhere: baseWhere,
        fetchDocuments: async (ids) => {
          const rows = await db
            .select(itemColumns)
            .from(ornamentsItems)
            .where(and(inArray(ornamentsItems.id, ids), baseWhere));
          return rows.map((row) => ({
            id: row.id,
            text: buildOrnamentSearchDocument(row),
          }));
        },
      });
      if (rankedIds.length > 0) {
        const total = rankedIds.length;
        const pageIds = rankedIds.slice(offset, offset + pageSize);
        const rows = pageIds.length
          ? await db
              .select(itemColumns)
              .from(ornamentsItems)
              .where(and(inArray(ornamentsItems.id, pageIds), baseWhere))
          : [];
        const byId = new Map(rows.map((row) => [row.id, row]));
        const orderedRows = pageIds.flatMap((id) => {
          const row = byId.get(id);
          return row ? [row] : [];
        });
        const items = await serializeItems(orderedRows);
        const metaWhere = rankedIds.length
          ? and(inArray(ornamentsItems.id, rankedIds), baseWhere)!
          : baseWhere;
        const meta = await ornamentListMeta(metaWhere, total, pageSize);
        res.json(
          ListOrnamentsResponse.parse({
            items,
            total,
            page,
            pageSize,
            totalPages: total === 0 ? 1 : Math.ceil(total / pageSize),
            searchMode: "semantic",
            facets: meta.facets,
            stats: meta.stats,
          }),
        );
        return;
      }
    } catch (err) {
      logger.warn(
        { err },
        "ornaments: semantic search unavailable; using keyword search",
      );
    }

    const term = `%${q.trim()}%`;
    conditions.push(
      or(
        ilike(ornamentsItems.name, term),
        ilike(ornamentsItems.seriesOrCollection, term),
        ilike(ornamentsItems.brand, term),
        ilike(ornamentsItems.notes, term),
        ilike(ornamentsItems.description, term),
      )!,
    );
  }

  const where = and(...(conditions as [SQL, ...SQL[]]))!;
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(ornamentsItems)
    .where(where);
  const rows = await db
    .select(itemColumns)
    .from(ornamentsItems)
    .where(where)
    .orderBy(...ornamentOrder(sort as OrnamentSort))
    .limit(pageSize)
    .offset(offset);
  const [items, meta] = await Promise.all([
    serializeItems(rows),
    ornamentListMeta(where, Number(total), pageSize),
  ]);
  res.json(
    ListOrnamentsResponse.parse({
      items,
      total: Number(total),
      page,
      pageSize,
      totalPages: Number(total) === 0 ? 1 : Math.ceil(Number(total) / pageSize),
      searchMode: "keyword",
      facets: meta.facets,
      stats: meta.stats,
    }),
  );
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
      and(
        isNull(ornamentsItems.deletedAt),
        or(
          isNull(ornamentsItems.embedding),
          and(
            isNull(ornamentsItems.seriesOrCollection),
            isNull(ornamentsItems.year),
          ),
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
      hallmarkSku: result.hallmarkSku,
      hallmarkArtist: result.hallmarkArtist,
      hallmarkSeriesName: result.hallmarkSeriesName,
      hallmarkSequenceNumber: result.hallmarkSequenceNumber,
      hallmarkRetailPriceUsd: result.hallmarkRetailPriceUsd,
      hallmarkCollectorPriceUsd: result.hallmarkCollectorPriceUsd,
      hallmarkInStock: result.hallmarkInStock,
      hallmarkImages: result.hallmarkImages,
      hallmarkProductUrl: result.hallmarkProductUrl,
    }),
  );
});

// User-submitted correction when a barcode lookup returned wrong data.
// Stored in ornament_upc_corrections for future lookup prioritisation.
// Registered before /items/:id/* routes to avoid path ambiguity.
router.post(
  "/items/report-barcode-correction",
  requireAuth,
  async (req, res) => {
    const { ReportBarcodeCorrectionBody, ReportBarcodeCorrectionResponse } =
      await import("@workspace/api-zod");
    const body = ReportBarcodeCorrectionBody.parse(req.body);
    await db.execute(sql`
    INSERT INTO ornament_upc_corrections
      (barcode, wrong_name, wrong_brand, corrected_name, corrected_brand,
       corrected_series_or_collection, corrected_year, submitted_by)
    VALUES
      (${body.barcode}, ${body.wrongName ?? null}, ${body.wrongBrand ?? null},
       ${body.correctedName ?? null}, ${body.correctedBrand ?? null},
       ${body.correctedSeriesOrCollection ?? null}, ${body.correctedYear ?? null},
       ${req.session.userId})
  `);
    res.json(ReportBarcodeCorrectionResponse.parse({ success: true }));
  },
);

// AI-powered barcode extraction from a user-supplied photo.
// Used as an escape hatch when the native BarcodeDetector API and ZXing
// both fail to scan a barcode from the live camera feed (e.g. awkward angle,
// poor lighting, worn packaging). The client sends a base64 data URL; we run
// it through a fast vision model and return the extracted digit string.
const BarcodePhotoBody = z.object({
  imageDataUrl: z
    .string()
    .min(10)
    .refine(
      (v) => /^data:image\/(jpeg|jpg|png|webp);base64,/.test(v),
      "Must be a JPEG, PNG, or WEBP base64 data URL",
    ),
});

router.post("/barcode-photo-lookup", aiLimiter, async (req, res) => {
  const parsed = BarcodePhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "An image data URL (JPEG/PNG/WEBP) is required." });
    return;
  }
  try {
    const barcode = await extractBarcodeFromPhoto(parsed.data.imageDataUrl);
    res.json({ barcode });
  } catch (err) {
    req.log.error({ err }, "Barcode photo extraction failed");
    res.json({ barcode: null });
  }
});

router.get("/items/:id", async (req, res) => {
  const { id } = GetOrnamentParams.parse(req.params);
  const [row] = await db
    .select(itemColumns)
    .from(ornamentsItems)
    .where(and(eq(ornamentsItems.id, id), isNull(ornamentsItems.deletedAt)))
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
  let sniffedType: ReturnType<typeof sniffAndValidateMime>;
  try {
    sniffedType = sniffAndValidateMime(file.buffer, file.mimetype);
  } catch {
    res.status(400).json({
      error: "Unsupported image. Please upload a JPEG, PNG, or WEBP photo.",
    });
    return;
  }
  if (!isImageMimeType(sniffedType)) {
    res.status(400).json({
      error: "Unsupported image. Please upload a JPEG, PNG, or WEBP photo.",
    });
    return;
  }
  const contentType = sniffedType;
  const cleanBuffer = await stripMetadata(file.buffer, contentType);

  const manualCategoryIds = parsePositiveIntegerArray(req.body?.categoryIds);

  const dataUrl = toDataUrl(cleanBuffer, contentType);
  const { result: analysis, runId: analysisRunId } =
    await runAnalysisWithEvidenceTrace(
      {
        module: "ornaments",
        feature: "catalogue-image",
        targetType: "ornament_item",
        userId,
        model: (await getModels()).fastVision,
      },
      () => analyzeOrnamentImage([dataUrl]),
    );
  const embedding = await embedText(buildEmbeddingText(analysis));

  const nameField = clampField(req.body?.name, MAX_NAME);
  const notesField = clampField(req.body?.notes, MAX_NOTES);
  const descriptionField = clampField(req.body?.description, MAX_NOTES);
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

  // Build the effective item name for eBay lookup before the image upload
  // so we can run both in parallel.
  const effectiveName =
    nameField ??
    analysis.name ??
    (barcodeLookup?.found ? barcodeLookup.name : null);
  const effectiveBrand =
    brandField ?? (barcodeLookup?.found ? barcodeLookup.brand : null);
  const effectiveYear =
    analysis.year ?? (barcodeLookup?.found ? barcodeLookup.year : null);

  // If we have a name, try to get eBay sold-price data in parallel with the
  // image upload. Use this to pre-populate bookValue when no Hallmark price
  // is available.
  const [imagePath, ebayCreationLookup] = await Promise.all([
    uploadImage(cleanBuffer, contentType),
    env.ebayAppId && effectiveName
      ? lookupEbayMarketValue(
          // Text-based query as primary; UPC (when available) as a parallel
          // keyword search — whichever returns more sold listings wins.
          buildEbayQuery(effectiveName, {
            maker: effectiveBrand ?? undefined,
            year: effectiveYear ?? undefined,
          }),
          { withAspects: false, upc: barcodeField ?? undefined },
        ).catch((err: unknown) => {
          logger.warn(
            { err },
            "eBay lookup during ornament creation failed (non-fatal)",
          );
          return null;
        })
      : Promise.resolve(null),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  try {
    const [row] = await db
      .insert(ornamentsItems)
      .values({
        userId,
        name: effectiveName,
        brand: effectiveBrand ?? "Hallmark",
        seriesOrCollection:
          analysis.seriesOrCollection ??
          (barcodeLookup?.found
            ? (barcodeLookup.hallmarkSeriesName ??
              barcodeLookup.seriesOrCollection)
            : null),
        year: effectiveYear,
        barcodeValue: barcodeField,
        quantity: quantityField,
        notes: notesField,
        // Priority: Hallmark collector price > eBay *sold* median > null.
        // Only use the eBay median as a book-value seed when it comes from real
        // completed/sold listings (sourceType "sold"). Active-listing fallback
        // prices are asking prices, not realized values — don't store them as
        // book value or they'll mislead collectors.
        bookValue:
          barcodeLookup?.hallmarkCollectorPriceUsd != null
            ? String(barcodeLookup.hallmarkCollectorPriceUsd)
            : ebayCreationLookup?.priceMedianUsd != null &&
                ebayCreationLookup.sourceType === "sold"
              ? String(ebayCreationLookup.priceMedianUsd)
              : null,
        bookValueSource: barcodeLookup?.hallmarkCollectorPriceUsd
          ? "hallmarkornaments.com"
          : ebayCreationLookup?.priceMedianUsd != null &&
              ebayCreationLookup.sourceType === "sold"
            ? "ebay"
            : null,
        bookValueUpdatedAt:
          barcodeLookup?.hallmarkCollectorPriceUsd != null ||
          (ebayCreationLookup?.priceMedianUsd != null &&
            ebayCreationLookup.sourceType === "sold")
            ? new Date()
            : null,
        dimensions: userDimensions ?? analysis.dimensions,
        condition: conditionField,
        origin: originField,
        aiDescription: analysis.aiDescription,
        // Verbatim box-back text: user-typed entry wins, then AI vision's
        // transcription of the box (or an AI-generated stand-in when no box
        // text was found), then a catalog/barcode lookup's blurb.
        description:
          descriptionField ??
          analysis.boxDescription ??
          (barcodeLookup?.found ? barcodeLookup.description : null),
        // Only true when the stored description came from the AI-generated
        // fallback (no real box text) — never for manual or looked-up text.
        descriptionGenerated:
          !descriptionField &&
          analysis.boxDescription != null &&
          analysis.boxDescriptionGenerated,
        dominantColors: analysis.dominantColors,
        motifs: analysis.motifs,
        acquiredAt: today,
        imagePath,
        embedding,
      })
      .returning();

    await assignGenerationRunTarget(analysisRunId, row.id);

    // Categories are a shared household set — auto-match plus manual picks.
    const allCats = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories);
    const autoCategoryIds = matchCategoryIds(allCats, [
      analysis.name,
      analysis.seriesOrCollection,
      analysis.dimensions,
      analysis.motifs,
    ]);
    const allCategoryIds = mergeExistingCategoryIds(
      allCats,
      autoCategoryIds,
      manualCategoryIds,
    );
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
  if (body.description !== undefined) {
    fieldUpdates.description = clampField(body.description, MAX_NOTES);
    // A manual edit is always real text, never an AI-generated stand-in.
    fieldUpdates.descriptionGenerated = false;
  }
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
  const now = new Date();
  // Cascade soft-delete supplemental images, then the ornament row itself.
  // Storage objects are preserved so the item can be restored from the recycle
  // bin within 30 days. The purge job (lib/purge-deleted.ts) removes both the
  // DB rows and the storage objects once the item passes the purge threshold.
  await db
    .update(ornamentsImages)
    .set({ deletedAt: now })
    .where(eq(ornamentsImages.itemId, id));
  await db
    .update(ornamentsItems)
    .set({ deletedAt: now })
    .where(eq(ornamentsItems.id, id));
  res.status(200).json({ ok: true });
  void logActivity({
    actorUserId: req.session.userId!,
    actorChannel: "web",
    actionType: "delete_ornament",
    entityType: "ornament",
    entityId: id,
    reversible: true,
  });
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
  res.set(
    "Cache-Control",
    req.query.v
      ? "private, max-age=31536000, immutable"
      : "private, max-age=60",
  );
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
  res.set(
    "Cache-Control",
    req.query.v
      ? "private, max-age=31536000, immutable"
      : "private, max-age=60",
  );
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
    let sniffedType: ReturnType<typeof sniffAndValidateMime>;
    try {
      sniffedType = sniffAndValidateMime(file.buffer, file.mimetype);
    } catch {
      res.status(400).json({ error: "Unsupported image format." });
      return;
    }
    if (!isImageMimeType(sniffedType)) {
      res.status(400).json({ error: "Unsupported image format." });
      return;
    }
    const contentType = sniffedType;
    const cleanBuffer = await stripMetadata(file.buffer, contentType);
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

  await db
    .update(ornamentsImages)
    .set({ deletedAt: new Date() })
    .where(eq(ornamentsImages.id, imageId));
  res.status(200).json({ ok: true });
});

// ---------------------------------------------------------------------------
// Image replacement (primary + supplemental)
// ---------------------------------------------------------------------------

router.put(
  "/items/:id/image",
  supplementalUploadLimiter,
  upload.single("image"),
  async (req, res) => {
    const { id } = GetOrnamentParams.parse(req.params);

    const [item] = await db
      .select({ id: ornamentsItems.id, imagePath: ornamentsItems.imagePath })
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
    let sniffedType: ReturnType<typeof sniffAndValidateMime>;
    try {
      sniffedType = sniffAndValidateMime(file.buffer, file.mimetype);
    } catch {
      res.status(400).json({ error: "Unsupported image format." });
      return;
    }
    if (!isImageMimeType(sniffedType)) {
      res.status(400).json({ error: "Unsupported image format." });
      return;
    }
    const contentType = sniffedType;
    const cleanBuffer = await stripMetadata(file.buffer, contentType);
    const newPath = await uploadImage(cleanBuffer, contentType);
    const oldPath = item.imagePath;
    try {
      await db
        .update(ornamentsItems)
        .set({ imagePath: newPath })
        .where(eq(ornamentsItems.id, id));
      await db
        .update(ornamentsImages)
        .set({ storagePath: newPath })
        .where(
          and(eq(ornamentsImages.itemId, id), eq(ornamentsImages.position, 0)),
        );
      if (oldPath) await deleteImage(oldPath).catch(() => {});
      const [updated] = await db
        .select()
        .from(ornamentsItems)
        .where(eq(ornamentsItems.id, id))
        .limit(1);
      res.json(GetOrnamentResponse.parse(await serializeItem(updated)));
    } catch (err) {
      await deleteImage(newPath).catch(() => {});
      throw err;
    }
  },
);

router.put(
  "/items/:id/images/:imageId",
  supplementalUploadLimiter,
  upload.single("image"),
  async (req, res) => {
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

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "An image file is required." });
      return;
    }
    let sniffedType: ReturnType<typeof sniffAndValidateMime>;
    try {
      sniffedType = sniffAndValidateMime(file.buffer, file.mimetype);
    } catch {
      res.status(400).json({ error: "Unsupported image format." });
      return;
    }
    if (!isImageMimeType(sniffedType)) {
      res.status(400).json({ error: "Unsupported image format." });
      return;
    }
    const contentType = sniffedType;
    const cleanBuffer = await stripMetadata(file.buffer, contentType);
    const newPath = await uploadImage(cleanBuffer, contentType);
    const oldPath = imageRow.storagePath;
    try {
      await db
        .update(ornamentsImages)
        .set({ storagePath: newPath })
        .where(eq(ornamentsImages.id, imageId));
      await deleteImage(oldPath).catch(() => {});
      const [updated] = await db
        .select()
        .from(ornamentsItems)
        .where(eq(ornamentsItems.id, id))
        .limit(1);
      res.json(GetOrnamentResponse.parse(await serializeItem(updated)));
    } catch (err) {
      await deleteImage(newPath).catch(() => {});
      throw err;
    }
  },
);

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
      hallmarkSku: result.hallmarkSku,
      hallmarkArtist: result.hallmarkArtist,
      hallmarkSeriesName: result.hallmarkSeriesName,
      hallmarkSequenceNumber: result.hallmarkSequenceNumber,
      hallmarkRetailPriceUsd: result.hallmarkRetailPriceUsd,
      hallmarkCollectorPriceUsd: result.hallmarkCollectorPriceUsd,
      hallmarkInStock: result.hallmarkInStock,
      hallmarkImages: result.hallmarkImages,
      hallmarkProductUrl: result.hallmarkProductUrl,
    }),
  );
});

// ---------------------------------------------------------------------------
// Book value lookup — fetches from hallmarkornaments.com /
// hookedonhallmark.com, saves the result, and returns the updated item.
// ---------------------------------------------------------------------------

router.post("/items/:id/book-value-lookup", aiLimiter, async (req, res) => {
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

  // If the item has a stored UPC, check the barcode cache first — lookupBarcode
  // already fetched hallmarkCollectorPriceUsd (the HooH collector price) and
  // cached it. Using it directly is faster and more precise than scraping.
  let result: {
    value: number;
    source: "hallmarkornaments.com" | "hookedonhallmark.com";
  } | null = null;
  if (item.barcodeValue) {
    try {
      const cached = await lookupBarcode(item.barcodeValue);
      if (cached.found && cached.hallmarkCollectorPriceUsd) {
        const v = parseFloat(cached.hallmarkCollectorPriceUsd);
        if (Number.isFinite(v) && v > 0) {
          result = { value: v, source: "hookedonhallmark.com" };
        }
      }
    } catch (err) {
      req.log.warn(
        { err },
        "book-value: barcode cache lookup failed, falling through to scrape",
      );
    }
  }

  if (!result) {
    result = await lookupBookValue({
      name: item.name,
      seriesOrCollection: item.seriesOrCollection,
      year: item.year,
    });
  }

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

  const analysis = await runAnalysisWithEvidence(
    {
      module: "ornaments",
      feature: "reanalyze-item",
      targetType: "ornament_item",
      targetId: id,
      userId: item.userId ?? undefined,
      model: (await getModels()).fastVision,
    },
    () => analyzeOrnamentImage(dataUrls),
  );
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
    description: keep("description", analysis.boxDescription, item.description),
    // Tied to the "description" lock: only trust the new generated-flag when
    // we're actually taking the new box description text above.
    descriptionGenerated: locked.has("description")
      ? item.descriptionGenerated
      : analysis.boxDescription != null
        ? analysis.boxDescriptionGenerated
        : item.descriptionGenerated,
    barcodeValue: keep("barcodeValue", analysis.upc, item.barcodeValue),
    embedding,
  };

  const [updated] = await db
    .update(ornamentsItems)
    .set(merged)
    .where(eq(ornamentsItems.id, id))
    .returning(itemColumns);

  // Re-run category auto-matching (union-only — never removes existing assignments).
  const allCats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories);
  const autoCategoryIds = matchCategoryIds(allCats, [
    merged.name,
    merged.seriesOrCollection,
    merged.dimensions,
    merged.motifs,
  ]);
  const existingCatRows = await db
    .select({ categoryId: itemCategories.categoryId })
    .from(itemCategories)
    .where(eq(itemCategories.itemId, id));
  const existingCatIds = new Set(existingCatRows.map((r) => r.categoryId));

  const newCatIds = autoCategoryIds.filter(
    (catId) => !existingCatIds.has(catId),
  );

  if (newCatIds.length > 0) {
    await db
      .insert(itemCategories)
      .values(newCatIds.map((catId) => ({ itemId: id, categoryId: catId })));
  }

  // If we now have a barcode value (either newly detected by AI or already stored),
  // fire the barcode enrichment pipeline in the background so Hallmark catalog
  // data (series, artist, collector price, SKU) is back-patched onto the item.
  if (merged.barcodeValue) {
    void lookupBarcode(merged.barcodeValue);
  }

  return GetOrnamentResponse.parse(await serializeItem(updated));
}

// ---------------------------------------------------------------------------
// #214 — eBay sold-listings fallback (any brand, not just Hallmark)
// ---------------------------------------------------------------------------

/** Cached eBay data (sold-price scraper + Browse API) is reused for 7 days. */
const EBAY_CACHE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

router.post("/items/:id/ebay-price-lookup", aiLimiter, async (req, res) => {
  const { id } = GetOrnamentParams.parse(req.params);

  if (!env.ebayAppId) {
    res.status(503).json({ error: "eBay API not configured." });
    return;
  }

  const [item] = await db
    .select({
      id: ornamentsItems.id,
      name: ornamentsItems.name,
      brand: ornamentsItems.brand,
      seriesOrCollection: ornamentsItems.seriesOrCollection,
      year: ornamentsItems.year,
      barcodeValue: ornamentsItems.barcodeValue,
      ebayPriceCachedAt: ornamentsItems.ebayPriceCachedAt,
      ebayPriceMinUsd: ornamentsItems.ebayPriceMinUsd,
      ebayPriceMaxUsd: ornamentsItems.ebayPriceMaxUsd,
      ebayPriceListings: ornamentsItems.ebayPriceListings,
      ebayLastSoldPriceUsd: ornamentsItems.ebayLastSoldPriceUsd,
      ebayLastSoldDate: ornamentsItems.ebayLastSoldDate,
    })
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id));

  if (!item) {
    res.status(404).json({ error: "Ornament not found." });
    return;
  }

  const force = (req.body as { force?: boolean } | undefined)?.force === true;

  // Return cached eBay data immediately when still fresh — avoids a paid
  // Apify sold-price scraper run on every user-initiated refresh.
  // When `force: true` is passed the cache is bypassed and a fresh run fires.
  const cacheAgeMs = item.ebayPriceCachedAt
    ? Date.now() - item.ebayPriceCachedAt.getTime()
    : Infinity;
  if (
    !force &&
    cacheAgeMs < EBAY_CACHE_STALE_AFTER_MS &&
    (item.ebayPriceMinUsd != null || item.ebayLastSoldPriceUsd != null)
  ) {
    const cachedListings = item.ebayPriceListings as unknown[] | null;
    const searchQuery = buildEbayQuery(item.name, {
      brand: item.brand,
      seriesOrCollection: item.seriesOrCollection,
      year: item.year,
    });
    logger.info(
      { id, cacheAgeMs: Math.round(cacheAgeMs / 1000 / 60) + "min" },
      "ornaments: returning cached eBay data (skipping paid Apify run)",
    );
    res.json({
      forSale:
        item.ebayPriceMinUsd != null
          ? {
              priceMinUsd: Number(item.ebayPriceMinUsd),
              priceMaxUsd: item.ebayPriceMaxUsd
                ? Number(item.ebayPriceMaxUsd)
                : null,
              listingCount: cachedListings?.length ?? 0,
              listings: cachedListings ?? [],
            }
          : null,
      lastSold: item.ebayLastSoldPriceUsd
        ? {
            priceUsd: Number(item.ebayLastSoldPriceUsd),
            soldDate: item.ebayLastSoldDate?.toISOString() ?? null,
            listingCount: null,
          }
        : null,
      searchQuery,
      cachedAt: item.ebayPriceCachedAt!.toISOString(),
      fromCache: true,
    });
    return;
  }

  const query = buildEbayQuery(item.name, {
    brand: item.brand,
    seriesOrCollection: item.seriesOrCollection,
    year: item.year,
  });

  let result: Awaited<ReturnType<typeof lookupOrnamentEbayData>>;
  try {
    result = await lookupOrnamentEbayData(query, {
      upc: item.barcodeValue ?? undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.warn({ err }, "ornaments: eBay price lookup failed");
    res.status(503).json({
      error: `eBay lookup is temporarily unavailable. Please try again in a moment. (${msg.slice(0, 120)})`,
    });
    return;
  }
  if (!result) {
    res.status(422).json({
      error: "No eBay listings found for this ornament.",
    });
    return;
  }

  // Store for-sale range (priceMin/Max) and last-sold data in DB
  await db
    .update(ornamentsItems)
    .set({
      ebayPriceMinUsd: result.forSale
        ? String(result.forSale.priceMinUsd)
        : null,
      ebayPriceMaxUsd: result.forSale
        ? String(result.forSale.priceMaxUsd)
        : null,
      ebayPriceMedianUsd: null,
      ebayPriceCachedAt: new Date(),
      ebayPriceListings: result.forSale
        ? (result.forSale.listings as unknown as Record<string, unknown>[])
        : null,
      ebayLastSoldPriceUsd: result.lastSold
        ? String(result.lastSold.priceUsd)
        : null,
      ebayLastSoldDate: result.lastSold?.soldDate
        ? new Date(result.lastSold.soldDate)
        : null,
    })
    .where(eq(ornamentsItems.id, id));

  res.json({
    forSale: result.forSale
      ? {
          priceMinUsd: result.forSale.priceMinUsd,
          priceMaxUsd: result.forSale.priceMaxUsd,
          listingCount: result.forSale.listingCount,
          listings: result.forSale.listings,
        }
      : null,
    lastSold: result.lastSold
      ? {
          priceUsd: result.lastSold.priceUsd,
          soldDate: result.lastSold.soldDate,
          listingCount: result.lastSold.listingCount,
        }
      : null,
    searchQuery: result.searchQuery,
    cachedAt: result.cachedAt,
  });
});

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

// ---------------------------------------------------------------------------
// AI appraisal — sends photos + metadata to AI for a collector value estimate
// ---------------------------------------------------------------------------

async function runItemAppraisal(id: number): Promise<void> {
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

  const appraisal = await appraiseOrnamentImage(dataUrls, {
    name: item.name,
    brand: item.brand,
    seriesOrCollection: item.seriesOrCollection,
    year: item.year,
    condition: item.condition,
    aiDescription: item.aiDescription,
    description: item.description,
    barcodeValue: item.barcodeValue,
  });

  await db
    .update(ornamentsItems)
    .set({ aiAppraisal: appraisal, aiAppraisalUpdatedAt: new Date() })
    .where(eq(ornamentsItems.id, id));
}

router.post("/items/:id/ai-appraisal", aiLimiter, async (req, res) => {
  const { id } = GetOrnamentParams.parse(req.params);
  try {
    await runItemAppraisal(id);
    const [updated] = await db
      .select(itemColumns)
      .from(ornamentsItems)
      .where(eq(ornamentsItems.id, id))
      .limit(1);
    res.json(GetOrnamentResponse.parse(await serializeItem(updated)));
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Unknown error.";
    res.status(status).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Refresh all — reanalyze + book value + eBay + AI appraisal in parallel
// ---------------------------------------------------------------------------

router.post("/items/:id/refresh-all", aiLimiter, async (req, res) => {
  const { id } = GetOrnamentParams.parse(req.params);

  const [item] = await db
    .select(itemColumns)
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Ornament not found." });
    return;
  }

  // Run all 4 in parallel — each independently stores its result.
  // Non-fatal: a failure in book-value/eBay/appraisal doesn't abort the whole refresh.
  await Promise.allSettled([
    // 1. AI vision reanalysis (description, colors, motifs, name, barcode)
    runItemAnalysis(id),
    // 2. Book value — barcode cache first (hallmarkCollectorPriceUsd), then scrape
    (async () => {
      let result: {
        value: number;
        source: "hallmarkornaments.com" | "hookedonhallmark.com";
      } | null = null;
      if (item.barcodeValue) {
        try {
          const cached = await lookupBarcode(item.barcodeValue);
          if (cached.found && cached.hallmarkCollectorPriceUsd) {
            const v = parseFloat(cached.hallmarkCollectorPriceUsd);
            if (Number.isFinite(v) && v > 0) {
              result = { value: v, source: "hookedonhallmark.com" };
            }
          }
        } catch (err) {
          req.log.warn(
            { err },
            "refresh-all: barcode cache lookup failed, falling through to scrape",
          );
        }
      }
      if (!result) {
        result = await lookupBookValue({
          name: item.name,
          seriesOrCollection: item.seriesOrCollection,
          year: item.year,
        }).catch((err) => {
          req.log.warn({ err }, "refresh-all: book-value lookup failed");
          return null;
        });
      }
      if (result) {
        await db
          .update(ornamentsItems)
          .set({
            bookValue: String(result.value),
            bookValueSource: result.source,
            bookValueUpdatedAt: new Date(),
          })
          .where(eq(ornamentsItems.id, id));
      }
    })(),
    // 3. eBay market data
    env.ebayAppId
      ? (async () => {
          const query = buildEbayQuery(item.name, {
            brand: item.brand,
            seriesOrCollection: item.seriesOrCollection,
            year: item.year,
          });
          const ebayResult = await lookupOrnamentEbayData(query, {
            upc: item.barcodeValue ?? undefined,
          }).catch((err) => {
            req.log.warn({ err }, "refresh-all: eBay lookup failed");
            return null;
          });
          if (ebayResult) {
            await db
              .update(ornamentsItems)
              .set({
                ebayPriceMinUsd: ebayResult.forSale
                  ? String(ebayResult.forSale.priceMinUsd)
                  : null,
                ebayPriceMaxUsd: ebayResult.forSale
                  ? String(ebayResult.forSale.priceMaxUsd)
                  : null,
                ebayPriceMedianUsd: null,
                ebayPriceCachedAt: new Date(),
                ebayPriceListings: ebayResult.forSale
                  ? (ebayResult.forSale.listings as unknown as Record<
                      string,
                      unknown
                    >[])
                  : null,
                ebayLastSoldPriceUsd: ebayResult.lastSold
                  ? String(ebayResult.lastSold.priceUsd)
                  : null,
                ebayLastSoldDate: ebayResult.lastSold?.soldDate
                  ? new Date(ebayResult.lastSold.soldDate)
                  : null,
              })
              .where(eq(ornamentsItems.id, id));
          }
        })()
      : Promise.resolve(),
    // 4. AI collector appraisal
    runItemAppraisal(id).catch((err) => {
      req.log.warn({ err }, "refresh-all: AI appraisal failed");
    }),
  ]);

  // Return the fully updated ornament (re-fetch after all 4 have stored)
  const [final] = await db
    .select(itemColumns)
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id))
    .limit(1);
  res.json(GetOrnamentResponse.parse(await serializeItem(final)));
});

export async function bulkReanalyzeOrnamentItems(
  ids: number[],
): Promise<{ succeeded: number[]; failed: number[] }> {
  const capped = [...new Set(ids)].slice(0, MAX_BULK_REANALYZE);
  const succeeded: number[] = [];
  const failed: number[] = [];

  const limit = pLimit(3);
  await Promise.all(
    capped.map((id) =>
      limit(async () => {
        try {
          await runItemAnalysis(id);
          succeeded.push(id);
        } catch (err) {
          logger.error({ itemId: id, err }, "bulk-reanalyze: item failed");
          failed.push(id);
        }
      }),
    ),
  );

  return { succeeded, failed };
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

/**
 * Create a new ornament item from raw image bytes, running the same analysis
 * pipeline as the POST /items route. Called by Elaine's add_photo_to_ornaments
 * action when the user explicitly asks to file an already-uploaded attachment
 * straight into the collection.
 */
export async function createOrnamentItemFromBuffer(
  userId: number,
  buffer: Buffer,
): Promise<{ id: number; name: string | null }> {
  const sniffed = sniffImageType(buffer);
  if (!sniffed || !isImageMimeType(sniffed)) {
    throw Object.assign(
      new Error("Unsupported image type — must be JPEG, PNG, or WEBP"),
      { status: 400 },
    );
  }
  const contentType = sniffed;
  const cleanBuffer = await stripMetadata(buffer, contentType);
  const dataUrl = toDataUrl(cleanBuffer, contentType);

  const { result: analysis, runId: analysisRunId } =
    await runAnalysisWithEvidenceTrace(
      {
        module: "ornaments",
        feature: "catalogue-image",
        targetType: "ornament_item",
        userId,
        model: (await getModels()).fastVision,
      },
      () => analyzeOrnamentImage([dataUrl]),
    );
  const embedding = await embedText(buildEmbeddingText(analysis));

  const barcodeField = analysis.upc ? analysis.upc.slice(0, MAX_TEXT) : null;

  let barcodeLookup: Awaited<ReturnType<typeof lookupBarcode>> | null = null;
  if (barcodeField) {
    try {
      barcodeLookup = await lookupBarcode(barcodeField);
    } catch (err) {
      logger.warn(
        { err, barcode: barcodeField },
        "Auto barcode lookup during Elaine ornament create failed (non-fatal)",
      );
    }
  }

  const effectiveName =
    analysis.name ?? (barcodeLookup?.found ? barcodeLookup.name : null);
  const effectiveYear =
    analysis.year ?? (barcodeLookup?.found ? barcodeLookup.year : null);
  const effectiveBrand = barcodeLookup?.found ? barcodeLookup.brand : null;

  const [imagePath, ebayCreationLookup] = await Promise.all([
    uploadImage(cleanBuffer, contentType),
    env.ebayAppId && effectiveName
      ? lookupEbayMarketValue(
          buildEbayQuery(effectiveName, {
            maker: effectiveBrand ?? undefined,
            year: effectiveYear ?? undefined,
          }),
          { withAspects: false, upc: barcodeField ?? undefined },
        ).catch((err: unknown) => {
          logger.warn(
            { err },
            "eBay lookup during Elaine ornament creation failed (non-fatal)",
          );
          return null;
        })
      : Promise.resolve(null),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  try {
    const [row] = await db
      .insert(ornamentsItems)
      .values({
        userId,
        name: effectiveName,
        brand: effectiveBrand ?? "Hallmark",
        seriesOrCollection:
          analysis.seriesOrCollection ??
          (barcodeLookup?.found
            ? (barcodeLookup.hallmarkSeriesName ??
              barcodeLookup.seriesOrCollection)
            : null),
        year: effectiveYear,
        barcodeValue: barcodeField,
        quantity: 1,
        // Same guard as the normal ornament upload route: only seed bookValue
        // from eBay when the data comes from real sold/completed listings
        // (sourceType "sold"). Active-listing asking prices must not be stored
        // as book value because they mislead collectors about realised values.
        bookValue:
          barcodeLookup?.hallmarkCollectorPriceUsd != null
            ? String(barcodeLookup.hallmarkCollectorPriceUsd)
            : ebayCreationLookup?.priceMedianUsd != null &&
                ebayCreationLookup.sourceType === "sold"
              ? String(ebayCreationLookup.priceMedianUsd)
              : null,
        bookValueSource: barcodeLookup?.hallmarkCollectorPriceUsd
          ? "hallmarkornaments.com"
          : ebayCreationLookup?.priceMedianUsd != null &&
              ebayCreationLookup.sourceType === "sold"
            ? "ebay"
            : null,
        bookValueUpdatedAt:
          barcodeLookup?.hallmarkCollectorPriceUsd != null ||
          (ebayCreationLookup?.priceMedianUsd != null &&
            ebayCreationLookup.sourceType === "sold")
            ? new Date()
            : null,
        dimensions: analysis.dimensions,
        aiDescription: analysis.aiDescription,
        description:
          analysis.boxDescription ??
          (barcodeLookup?.found ? barcodeLookup.description : null),
        descriptionGenerated:
          analysis.boxDescription != null && analysis.boxDescriptionGenerated,
        dominantColors: analysis.dominantColors,
        motifs: analysis.motifs,
        acquiredAt: today,
        imagePath,
        embedding,
      })
      .returning();

    await assignGenerationRunTarget(analysisRunId, row.id);

    const allCats = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories);
    const autoCategoryIds = matchCategoryIds(allCats, [
      analysis.name,
      analysis.seriesOrCollection,
      analysis.dimensions,
      analysis.motifs,
    ]);
    const allCategoryIds = mergeExistingCategoryIds(
      allCats,
      autoCategoryIds,
      [],
    );
    if (allCategoryIds.length > 0) {
      await db.insert(itemCategories).values(
        allCategoryIds.map((catId) => ({
          itemId: row.id,
          categoryId: catId,
        })),
      );
    }

    return { id: row.id, name: row.name };
  } catch (err) {
    await deleteImage(imagePath).catch(() => {});
    throw err;
  }
}

export default router;
