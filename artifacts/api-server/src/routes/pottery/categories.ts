import { Router, type IRouter } from "express";
import { asc, eq, count as sqlCount, sql } from "drizzle-orm";
import {
  db,
  potteryCategories as categories,
  potteryItemCategories as itemCategories,
} from "@workspace/db";
import {
  ListPotteryCategoriesResponse as ListCategoriesResponse,
  ListPotteryCategoriesResponseItem as ListCategoriesResponseItem,
  CreatePotteryCategoryBody as CreateCategoryBody,
  DeletePotteryCategoryParams as DeleteCategoryParams,
  RenamePotteryCategoryParams as RenameCategoryParams,
  RenamePotteryCategoryBody as RenameCategoryBody,
  MergePotteryCategoryBody as MergeCategoryBody,
  UpdatePotteryCategoryColorsBody as UpdateCategoryColorsBody,
  UpdatePotteryCategoryColorsParams as UpdateCategoryColorsParams,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

/**
 * Normalise a category name before saving:
 * - Trim surrounding whitespace
 * - Coerce all inch-mark variants (″ double prime, " " smart quotes) to plain "
 *   so categories created by typing and those auto-matched from AI output use
 *   the same character and are deduplicated correctly.
 * - Capitalise the very first letter, leave the rest exactly as typed
 *   (preserves intentional casing like "11" Plates", "Art Deco", "USA")
 */
function normalizeCategoryName(raw: string): string {
  const t = raw.trim().replace(/[″\u201C\u201D]/g, '"');
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const router: IRouter = Router();
router.use(requireAuth);

/** Fetch a single category row with its assigned-piece count. */
async function fetchWithCount(id: number) {
  const [row] = await db
    .select({
      id: categories.id,
      name: categories.name,
      bgColor: categories.bgColor,
      textColor: categories.textColor,
      count: sqlCount(itemCategories.itemId),
    })
    .from(categories)
    .leftJoin(itemCategories, eq(itemCategories.categoryId, categories.id))
    .where(eq(categories.id, id))
    .groupBy(
      categories.id,
      categories.name,
      categories.bgColor,
      categories.textColor,
    );
  return row ?? null;
}

router.get("/categories", async (_req, res) => {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      bgColor: categories.bgColor,
      textColor: categories.textColor,
      count: sqlCount(itemCategories.itemId),
    })
    .from(categories)
    .leftJoin(itemCategories, eq(itemCategories.categoryId, categories.id))
    .groupBy(
      categories.id,
      categories.name,
      categories.bgColor,
      categories.textColor,
    )
    .orderBy(asc(categories.name));
  res.json(ListCategoriesResponse.parse(rows));
});

router.post("/categories", async (req, res) => {
  const body = CreateCategoryBody.parse(req.body);
  const name = normalizeCategoryName(body.name);
  try {
    const [row] = await db
      .insert(categories)
      .values({
        name,
        bgColor: body.bgColor ?? null,
        textColor: body.textColor ?? null,
      })
      .returning({ id: categories.id });
    const withCount = await fetchWithCount(row.id);
    res.status(201).json(ListCategoriesResponseItem.parse(withCount));
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      res
        .status(409)
        .json({ error: "A category with that name already exists." });
      return;
    }
    throw err;
  }
});

router.patch("/categories/:id", async (req, res) => {
  const { id } = RenameCategoryParams.parse(req.params);
  const body = RenameCategoryBody.parse(req.body);
  const name = normalizeCategoryName(body.name);
  try {
    const [updated] = await db
      .update(categories)
      .set({ name })
      .where(eq(categories.id, id))
      .returning({ id: categories.id });
    if (!updated) {
      res.status(404).json({ error: "Category not found." });
      return;
    }
    const withCount = await fetchWithCount(id);
    res.json(ListCategoriesResponseItem.parse(withCount));
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      res
        .status(409)
        .json({ error: "A category with that name already exists." });
      return;
    }
    throw err;
  }
});

router.put("/categories/:id/colors", async (req, res) => {
  const { id } = UpdateCategoryColorsParams.parse(req.params);
  const body = UpdateCategoryColorsBody.parse(req.body);
  const [updated] = await db
    .update(categories)
    .set({ bgColor: body.bgColor ?? null, textColor: body.textColor ?? null })
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  if (!updated) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  const withCount = await fetchWithCount(id);
  res.json(ListCategoriesResponseItem.parse(withCount));
});

// Must be registered before DELETE /categories/:id so Express doesn't treat
// "unused" as an :id parameter.
router.delete("/categories/unused", async (_req, res) => {
  const deletedRows = await db
    .delete(categories)
    .where(
      sql`${categories.id} NOT IN (SELECT category_id FROM item_categories)`,
    )
    .returning({ id: categories.id });
  res.json({ deleted: deletedRows.length });
});

router.delete("/categories/:id", async (req, res) => {
  const { id } = DeleteCategoryParams.parse(req.params);
  const [row] = await db
    .delete(categories)
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  if (!row) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  res.status(204).end();
});

router.post("/categories/:id/merge", async (req, res) => {
  const { id } = DeleteCategoryParams.parse(req.params);
  const { intoId } = MergeCategoryBody.parse(req.body);

  if (id === intoId) {
    res.status(400).json({ error: "Cannot merge a category into itself." });
    return;
  }

  const [source, target] = await Promise.all([
    db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, id))
      .then((r) => r[0]),
    db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, intoId))
      .then((r) => r[0]),
  ]);

  if (!source || !target) {
    res.status(404).json({ error: "Category not found." });
    return;
  }

  const sourceItems = await db
    .select({ itemId: itemCategories.itemId })
    .from(itemCategories)
    .where(eq(itemCategories.categoryId, id));

  if (sourceItems.length > 0) {
    await db
      .insert(itemCategories)
      .values(
        sourceItems.map((r) => ({ itemId: r.itemId, categoryId: intoId })),
      )
      .onConflictDoNothing();
  }

  await db.delete(categories).where(eq(categories.id, id));

  res.status(204).end();
});

export default router;
