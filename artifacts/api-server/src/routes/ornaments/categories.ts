import { eq, isNull } from "drizzle-orm";
import {
  db,
  ornamentsCategories as cats,
  ornamentsItemCategories as joinTable,
  ornamentsItems,
} from "@workspace/db";
import {
  ListOrnamentCategoriesResponse,
  ListOrnamentCategoriesResponseItem,
  CreateOrnamentCategoryBody,
  DeleteOrnamentCategoryParams,
  RenameOrnamentCategoryParams,
  RenameOrnamentCategoryBody,
  MergeOrnamentCategoryBody,
  UpdateOrnamentCategoryColorsBody,
  UpdateOrnamentCategoryColorsParams,
  SuggestOrnamentCategoriesResponse,
  CreateAndBackfillOrnamentCategoriesBody,
  CreateAndBackfillOrnamentCategoriesResponse,
  ApplyExistingOrnamentCategoriesResponse,
} from "@workspace/api-zod";
import {
  buildCategoryRouter,
  normalizeCategoryNameSimple,
  type CategoryOps,
} from "../../lib/category-router-factory";
import { createCategoryCountOps } from "../../lib/collection-category-ops";
import { getCategoryPalette } from "@workspace/web-core/colors";
import { applyExistingOrnamentCategories } from "../../lib/ornaments/category-assignment";
import {
  suggestOrnamentCategoryNames,
  type OrnamentCollectionSignals,
} from "../../lib/ornaments/openai";
import { aiLimiter } from "../../middleware/rateLimit";

// ---------------------------------------------------------------------------
// Domain-specific DB ops
// ---------------------------------------------------------------------------

const ops: CategoryOps = {
  ...createCategoryCountOps(cats, joinTable, joinTable.itemId),

  async create(userId, name, bgColor, textColor) {
    const [row] = await db
      .insert(cats)
      .values({ userId, name, bgColor, textColor })
      .returning({ id: cats.id });
    return row.id;
  },

  async rename(id, name) {
    const [updated] = await db
      .update(cats)
      .set({ name })
      .where(eq(cats.id, id))
      .returning({ id: cats.id });
    return !!updated;
  },

  async updateColors(id, bgColor, textColor) {
    const [updated] = await db
      .update(cats)
      .set({ bgColor, textColor })
      .where(eq(cats.id, id))
      .returning({ id: cats.id });
    return !!updated;
  },

  async deleteById(id) {
    const [row] = await db
      .delete(cats)
      .where(eq(cats.id, id))
      .returning({ id: cats.id });
    return !!row;
  },

  async categoryExists(id) {
    const [row] = await db
      .select({ id: cats.id })
      .from(cats)
      .where(eq(cats.id, id));
    return !!row;
  },

  async getAssignmentsForCategory(categoryId) {
    return db
      .select({ itemId: joinTable.itemId })
      .from(joinTable)
      .where(eq(joinTable.categoryId, categoryId));
  },

  async reattachAssignments(assignments, targetId) {
    const rows = assignments as { itemId: number }[];
    if (rows.length === 0) return;
    await db
      .insert(joinTable)
      .values(rows.map((r) => ({ itemId: r.itemId, categoryId: targetId })))
      .onConflictDoNothing();
  },

  async deleteCategoryRow(id) {
    await db.delete(cats).where(eq(cats.id, id));
  },
};

// ---------------------------------------------------------------------------
// Build router + exported helpers for Elaine actions
// ---------------------------------------------------------------------------

const { router, merge } = buildCategoryRouter({
  ops,
  normalize: normalizeCategoryNameSimple,
  schemas: {
    listResponse: ListOrnamentCategoriesResponse,
    listItem: ListOrnamentCategoriesResponseItem,
    createBody: CreateOrnamentCategoryBody,
    deleteParams: DeleteOrnamentCategoryParams,
    renameParams: RenameOrnamentCategoryParams,
    renameBody: RenameOrnamentCategoryBody,
    mergeBody: MergeOrnamentCategoryBody,
    mergeSourceIdField: "intoId",
    updateColorsBody: UpdateOrnamentCategoryColorsBody,
    updateColorsParams: UpdateOrnamentCategoryColorsParams,
  },
  mergeResponse: "no-content",
});

/**
 * Merge ornament category `id` into category `intoId`.
 * Shared by the REST route and Elaine's ornament category action executor.
 */
export async function mergeOrnamentCategories(
  id: number,
  intoId: number,
): Promise<{ status: number; error?: string }> {
  return merge(id, intoId);
}

// ---------------------------------------------------------------------------
// AI-suggested categories (#1077)
// ---------------------------------------------------------------------------

/** Dedupe a list of possibly-null/blank strings, trim, and cap at `max`. */
function uniqueStrings(
  values: (string | null | undefined)[],
  max: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

async function gatherCollectionSignals(): Promise<OrnamentCollectionSignals> {
  const rows = await db
    .select({
      name: ornamentsItems.name,
      seriesOrCollection: ornamentsItems.seriesOrCollection,
      motifs: ornamentsItems.motifs,
      dominantColors: ornamentsItems.dominantColors,
      brand: ornamentsItems.brand,
      notes: ornamentsItems.notes,
    })
    .from(ornamentsItems)
    .where(isNull(ornamentsItems.deletedAt));

  return {
    names: uniqueStrings(
      rows.map((r) => r.name),
      300,
    ),
    series: uniqueStrings(
      rows.map((r) => r.seriesOrCollection),
      150,
    ),
    motifs: uniqueStrings(
      rows.flatMap((r) => r.motifs),
      150,
    ),
    colors: uniqueStrings(
      rows.flatMap((r) => r.dominantColors),
      60,
    ),
    brands: uniqueStrings(
      rows.map((r) => r.brand),
      30,
    ),
    notes: uniqueStrings(
      rows.map((r) => r.notes),
      40,
    ),
  };
}

/**
 * Analyze the household's current ornament collection and ask AI to propose
 * new category names, filtering out any that already match an existing
 * category (case/whitespace-insensitive). Shared by the REST route and
 * Elaine's ornament category action executor.
 */
export async function suggestOrnamentCategories(): Promise<string[]> {
  const signals = await gatherCollectionSignals();
  if (signals.names.length === 0) return [];

  const existingRows = await db.select({ name: cats.name }).from(cats);
  const existingNames = existingRows.map((r) => r.name);
  const existingNormalized = new Set(
    existingNames.map((n) => normalizeCategoryNameSimple(n).toLowerCase()),
  );

  const raw = await suggestOrnamentCategoryNames(signals, existingNames);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of raw) {
    const normalized = normalizeCategoryNameSimple(name);
    const key = normalized.toLowerCase();
    if (!key || existingNormalized.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export interface CreateAndBackfillResult {
  categories: Awaited<ReturnType<typeof ops.listWithCounts>>;
  createdCount: number;
  assignmentsCreated: number;
}

/**
 * Create the given category names (skipping ones that already exist, same
 * normalization/duplicate handling as the manual create-category flow), then
 * run the existing auto-match logic against every existing ornament's stored
 * fields to backfill assignments for both the newly created and any
 * pre-existing categories — skipping items already assigned to a category.
 * Shared by the REST route and Elaine's ornament category action executor.
 */
export async function createAndBackfillOrnamentCategories(
  userId: number,
  rawNames: string[],
): Promise<CreateAndBackfillResult> {
  const names = [
    ...new Set(
      rawNames
        .map((n) => normalizeCategoryNameSimple(n))
        .filter((n) => n.length > 0),
    ),
  ];

  let createdCount = 0;
  if (names.length > 0) {
    const inserted = await db
      .insert(cats)
      .values(
        names.map((name) => ({
          userId,
          name,
          ...getCategoryPalette(name),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: cats.id });
    createdCount = inserted.length;
  }

  const assignment = await applyExistingOrnamentCategories();

  return {
    categories: await ops.listWithCounts(),
    createdCount,
    assignmentsCreated: assignment.assignmentsCreated,
  };
}

router.post("/categories/suggest", aiLimiter, async (_req, res) => {
  const suggestions = await suggestOrnamentCategories();
  res.json(SuggestOrnamentCategoriesResponse.parse({ suggestions }));
});

router.post("/categories/create-and-backfill", async (req, res) => {
  const userId = req.session.userId!;
  const body = CreateAndBackfillOrnamentCategoriesBody.parse(req.body);
  const result = await createAndBackfillOrnamentCategories(userId, body.names);
  res.json(CreateAndBackfillOrnamentCategoriesResponse.parse(result));
});

// Applies only categories that already exist. It is intentionally separate
// from suggestions/creation so maintenance can be safely retried without
// changing the household taxonomy.
router.post("/categories/apply-existing", async (_req, res) => {
  const result = await applyExistingOrnamentCategories();
  res.json(ApplyExistingOrnamentCategoriesResponse.parse(result));
});

export default router;
