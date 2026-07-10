import { eq, inArray, and, isNotNull } from "drizzle-orm";
import type {
  FabricRow,
  QuiltPatternRow,
  FinishedQuiltRow,
} from "@workspace/db";
import {
  db,
  entityCategories,
  quiltingCategories as categories,
  quiltingImages,
  fabrics,
  quiltPatterns,
  finishedQuilts,
  quiltFabricLinks,
  quiltPatternLinks,
} from "@workspace/db";

type EntityType = "fabric" | "pattern" | "quilt";

// Embedding is excluded from list/detail queries — serialize only needs the rest.
export type FabricRowForSerialization = Omit<
  FabricRow,
  "embedding" | "visualEmbedding"
>;
export type PatternRowForSerialization = Omit<
  QuiltPatternRow,
  "embedding" | "visualEmbedding"
>;
export type QuiltRowForSerialization = FinishedQuiltRow;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface CategoryResult {
  id: number;
  name: string;
  bgColor: string | null;
  textColor: string | null;
}

export interface ImageResult {
  id: number;
  url: string;
  label: string | null;
  position: number;
}

// ---------------------------------------------------------------------------
// Serialized entity shapes
// ---------------------------------------------------------------------------

export interface SerializedFabric {
  id: number;
  name: string;
  lineName: string | null;
  designer: string | null;
  manufacturer: string | null;
  colorway: string | null;
  printType: string | null;
  fiberContent: string | null;
  widthInches: number | null;
  quantity: number;
  quantityUnit: string;
  sku: string | null;
  notes: string | null;
  aiDescription: string | null;
  dominantColors: string[];
  motifs: string[];
  styleDescriptors: string[];
  acquiredAt: string | null;
  lockedFields: string[];
  categories: CategoryResult[];
  images: ImageResult[];
  imageUrl: string;
  tileImageUrl: string;
  hasEmbedding: boolean;
  createdAt: Date;
}

export interface SerializedPattern {
  id: number;
  name: string;
  designer: string | null;
  blockSize: string | null;
  difficulty: string | null;
  sourceType: string | null;
  sourceReference: string | null;
  notes: string | null;
  acquiredAt: string | null;
  dominantColors: string[];
  lockedFields: string[];
  categories: CategoryResult[];
  images: ImageResult[];
  imageUrl: string | null;
  designerBio: string | null;
  designerWebsite: string | null;
  publicationName: string | null;
  publicationYear: string | null;
  hasEmbedding: boolean;
  createdAt: Date;
}

export interface QuiltFabricSummary {
  id: number;
  name: string;
  colorway: string | null;
  imageUrl: string;
  dominantColors: string[];
}

export interface SerializedQuilt {
  id: number;
  name: string;
  dateCompleted: string | null;
  sizeWidth: number | null;
  sizeHeight: number | null;
  recipient: string | null;
  notes: string | null;
  dominantColors: string[];
  lockedFields: string[];
  completionPercentage: number;
  categories: CategoryResult[];
  images: ImageResult[];
  imageUrl: string;
  linkedFabricIds: number[];
  linkedPatternIds: number[];
  linkedFabrics: QuiltFabricSummary[];
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchCategoriesForEntities(
  entityType: EntityType,
  entityIds: number[],
): Promise<Map<number, CategoryResult[]>> {
  if (entityIds.length === 0) return new Map();
  const rows = await db
    .select({
      entityId: entityCategories.entityId,
      id: categories.id,
      name: categories.name,
      bgColor: categories.bgColor,
      textColor: categories.textColor,
    })
    .from(entityCategories)
    .innerJoin(categories, eq(entityCategories.categoryId, categories.id))
    .where(
      and(
        eq(entityCategories.entityType, entityType),
        inArray(entityCategories.entityId, entityIds),
      ),
    );

  const map = new Map<number, CategoryResult[]>();
  for (const row of rows) {
    if (!map.has(row.entityId)) map.set(row.entityId, []);
    map.get(row.entityId)!.push({
      id: row.id,
      name: row.name,
      bgColor: row.bgColor,
      textColor: row.textColor,
    });
  }
  return map;
}

/**
 * Returns the subset of the given ids whose row currently has a non-null
 * embedding vector. Selects only the id (never the heavy 1536-float vector) so
 * it stays cheap even across the full collection. Used to flag items that still
 * need re-analysing after a DB restore (embeddings aren't in the Replit backup).
 */
async function fetchEmbeddingPresence(
  which: "fabric" | "pattern",
  ids: number[],
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const table = which === "fabric" ? fabrics : quiltPatterns;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(inArray(table.id, ids), isNotNull(table.embedding)));
  return new Set(rows.map((r) => r.id));
}

async function fetchImagesForEntities(
  entityType: EntityType,
  entityIds: number[],
  routePrefix: string,
): Promise<Map<number, ImageResult[]>> {
  if (entityIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(quiltingImages)
    .where(
      and(
        eq(quiltingImages.entityType, entityType),
        inArray(quiltingImages.entityId, entityIds),
      ),
    );

  const map = new Map<number, ImageResult[]>();
  for (const row of rows) {
    if (!map.has(row.entityId)) map.set(row.entityId, []);
    map.get(row.entityId)!.push({
      id: row.id,
      url: `${routePrefix}/${row.entityId}/images/${row.id}`,
      label: row.label,
      position: row.position,
    });
  }
  for (const imgs of map.values()) {
    imgs.sort((a, b) => a.position - b.position || a.id - b.id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Fabric serialization
// ---------------------------------------------------------------------------

function toFabric(
  row: FabricRowForSerialization,
  cats: CategoryResult[],
  imgs: ImageResult[],
  hasEmbedding: boolean,
): SerializedFabric {
  return {
    id: row.id,
    name: row.name,
    lineName: row.lineName,
    designer: row.designer,
    manufacturer: row.manufacturer,
    colorway: row.colorway,
    printType: row.printType,
    fiberContent: row.fiberContent,
    widthInches: row.widthInches,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    sku: row.sku,
    notes: row.notes,
    aiDescription: row.aiDescription,
    dominantColors: row.dominantColors ?? [],
    motifs: row.motifs ?? [],
    styleDescriptors: row.styleDescriptors ?? [],
    acquiredAt: row.acquiredAt,
    lockedFields: row.lockedFields ?? [],
    categories: cats,
    images: imgs,
    imageUrl: `/api/quilting/fabrics/${row.id}/image`,
    tileImageUrl: `/api/quilting/fabrics/${row.id}/tile-image`,
    hasEmbedding,
    createdAt: row.createdAt,
  };
}

export async function serializeFabric(
  row: FabricRowForSerialization,
): Promise<SerializedFabric> {
  const [catsMap, imgsMap, embedded] = await Promise.all([
    fetchCategoriesForEntities("fabric", [row.id]),
    fetchImagesForEntities("fabric", [row.id], "/api/quilting/fabrics"),
    fetchEmbeddingPresence("fabric", [row.id]),
  ]);
  return toFabric(
    row,
    catsMap.get(row.id) ?? [],
    imgsMap.get(row.id) ?? [],
    embedded.has(row.id),
  );
}

export async function serializeFabrics(
  rows: FabricRowForSerialization[],
): Promise<SerializedFabric[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [catsMap, imgsMap, embedded] = await Promise.all([
    fetchCategoriesForEntities("fabric", ids),
    fetchImagesForEntities("fabric", ids, "/api/quilting/fabrics"),
    fetchEmbeddingPresence("fabric", ids),
  ]);
  return rows.map((row) =>
    toFabric(
      row,
      catsMap.get(row.id) ?? [],
      imgsMap.get(row.id) ?? [],
      embedded.has(row.id),
    ),
  );
}

// ---------------------------------------------------------------------------
// Pattern serialization
// ---------------------------------------------------------------------------

function toPattern(
  row: PatternRowForSerialization,
  cats: CategoryResult[],
  imgs: ImageResult[],
  hasEmbedding: boolean,
): SerializedPattern {
  return {
    id: row.id,
    name: row.name,
    designer: row.designer,
    blockSize: row.blockSize,
    difficulty: row.difficulty,
    sourceType: row.sourceType,
    sourceReference: row.sourceReference,
    notes: row.notes,
    acquiredAt: row.acquiredAt,
    dominantColors: row.dominantColors ?? [],
    lockedFields: row.lockedFields ?? [],
    categories: cats,
    images: imgs,
    imageUrl: row.imagePath ? `/api/quilting/patterns/${row.id}/image` : null,
    designerBio: row.designerBio ?? null,
    designerWebsite: row.designerWebsite ?? null,
    publicationName: row.publicationName ?? null,
    publicationYear: row.publicationYear ?? null,
    hasEmbedding,
    createdAt: row.createdAt,
  };
}

export async function serializePattern(
  row: PatternRowForSerialization,
): Promise<SerializedPattern> {
  const [catsMap, imgsMap, embedded] = await Promise.all([
    fetchCategoriesForEntities("pattern", [row.id]),
    fetchImagesForEntities("pattern", [row.id], "/api/quilting/patterns"),
    fetchEmbeddingPresence("pattern", [row.id]),
  ]);
  return toPattern(
    row,
    catsMap.get(row.id) ?? [],
    imgsMap.get(row.id) ?? [],
    embedded.has(row.id),
  );
}

export async function serializePatterns(
  rows: PatternRowForSerialization[],
): Promise<SerializedPattern[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [catsMap, imgsMap, embedded] = await Promise.all([
    fetchCategoriesForEntities("pattern", ids),
    fetchImagesForEntities("pattern", ids, "/api/quilting/patterns"),
    fetchEmbeddingPresence("pattern", ids),
  ]);
  return rows.map((row) =>
    toPattern(
      row,
      catsMap.get(row.id) ?? [],
      imgsMap.get(row.id) ?? [],
      embedded.has(row.id),
    ),
  );
}

// ---------------------------------------------------------------------------
// Quilt serialization
// ---------------------------------------------------------------------------

async function fetchFabricSummaries(
  fabricIds: number[],
  userId?: number,
): Promise<Map<number, QuiltFabricSummary>> {
  if (fabricIds.length === 0) return new Map();
  const whereClause =
    userId != null
      ? and(inArray(fabrics.id, fabricIds), eq(fabrics.userId, userId))
      : inArray(fabrics.id, fabricIds);
  const rows = await db
    .select({
      id: fabrics.id,
      name: fabrics.name,
      colorway: fabrics.colorway,
      dominantColors: fabrics.dominantColors,
    })
    .from(fabrics)
    .where(whereClause);
  const map = new Map<number, QuiltFabricSummary>();
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      name: row.name,
      colorway: row.colorway,
      imageUrl: `/api/quilting/fabrics/${row.id}/image`,
      dominantColors: row.dominantColors ?? [],
    });
  }
  return map;
}

async function fetchQuiltLinks(quiltIds: number[]): Promise<{
  fabricLinks: Map<number, number[]>;
  patternLinks: Map<number, number[]>;
}> {
  if (quiltIds.length === 0)
    return { fabricLinks: new Map(), patternLinks: new Map() };

  const [fl, pl] = await Promise.all([
    db
      .select({
        quiltId: quiltFabricLinks.quiltId,
        fabricId: quiltFabricLinks.fabricId,
      })
      .from(quiltFabricLinks)
      .where(inArray(quiltFabricLinks.quiltId, quiltIds)),
    db
      .select({
        quiltId: quiltPatternLinks.quiltId,
        patternId: quiltPatternLinks.patternId,
      })
      .from(quiltPatternLinks)
      .where(inArray(quiltPatternLinks.quiltId, quiltIds)),
  ]);

  const fabricLinks = new Map<number, number[]>();
  for (const r of fl) {
    if (!fabricLinks.has(r.quiltId)) fabricLinks.set(r.quiltId, []);
    fabricLinks.get(r.quiltId)!.push(r.fabricId);
  }
  const patternLinks = new Map<number, number[]>();
  for (const r of pl) {
    if (!patternLinks.has(r.quiltId)) patternLinks.set(r.quiltId, []);
    patternLinks.get(r.quiltId)!.push(r.patternId);
  }
  return { fabricLinks, patternLinks };
}

function toQuilt(
  row: QuiltRowForSerialization,
  cats: CategoryResult[],
  imgs: ImageResult[],
  fabricIds: number[],
  patternIds: number[],
  fabricSummaries: Map<number, QuiltFabricSummary>,
): SerializedQuilt {
  return {
    id: row.id,
    name: row.name,
    dateCompleted: row.dateCompleted,
    sizeWidth: row.sizeWidth,
    sizeHeight: row.sizeHeight,
    recipient: row.recipient,
    notes: row.notes,
    dominantColors: row.dominantColors ?? [],
    lockedFields: row.lockedFields ?? [],
    completionPercentage: row.completionPercentage ?? 0,
    categories: cats,
    images: imgs,
    imageUrl: `/api/quilting/quilts/${row.id}/image`,
    linkedFabricIds: fabricIds,
    linkedPatternIds: patternIds,
    linkedFabrics: fabricIds
      .map((fid) => fabricSummaries.get(fid))
      .filter(Boolean) as QuiltFabricSummary[],
    createdAt: row.createdAt,
  };
}

export async function serializeQuilt(
  row: QuiltRowForSerialization,
): Promise<SerializedQuilt> {
  const userId = row.userId ?? undefined;
  const [catsMap, imgsMap, links] = await Promise.all([
    fetchCategoriesForEntities("quilt", [row.id]),
    fetchImagesForEntities("quilt", [row.id], "/api/quilting/quilts"),
    fetchQuiltLinks([row.id]),
  ]);
  const fabricIds = links.fabricLinks.get(row.id) ?? [];
  // Scope fabric summaries to the quilt owner to prevent cross-user data leakage
  // via linked-fabric fields (name, colorway, dominantColors).
  const fabricSummaries = await fetchFabricSummaries(fabricIds, userId);
  return toQuilt(
    row,
    catsMap.get(row.id) ?? [],
    imgsMap.get(row.id) ?? [],
    fabricIds,
    links.patternLinks.get(row.id) ?? [],
    fabricSummaries,
  );
}

export async function serializeQuilts(
  rows: QuiltRowForSerialization[],
): Promise<SerializedQuilt[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [catsMap, imgsMap, links] = await Promise.all([
    fetchCategoriesForEntities("quilt", ids),
    fetchImagesForEntities("quilt", ids, "/api/quilting/quilts"),
    fetchQuiltLinks(ids),
  ]);
  const allFabricIds = [...new Set([...links.fabricLinks.values()].flat())];
  // Use the first row's userId as the owner scope (all rows belong to the same user
  // because route handlers filter by req.session.userId).
  const userId = rows[0]?.userId ?? undefined;
  const fabricSummaries = await fetchFabricSummaries(allFabricIds, userId);
  return rows.map((row) =>
    toQuilt(
      row,
      catsMap.get(row.id) ?? [],
      imgsMap.get(row.id) ?? [],
      links.fabricLinks.get(row.id) ?? [],
      links.patternLinks.get(row.id) ?? [],
      fabricSummaries,
    ),
  );
}
