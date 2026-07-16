import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";

/** Minimal duck-type that covers both Zod v3 and v4 schema objects. */
type ParseableSchema = { parse: (data: unknown) => unknown };

// ---------------------------------------------------------------------------
// Shared type returned by every category query
// ---------------------------------------------------------------------------

export interface CategoryRow {
  id: number;
  name: string;
  bgColor: string | null;
  textColor: string | null;
  count: number;
}

// ---------------------------------------------------------------------------
// Abstract DB operations — each domain provides its own implementation
// ---------------------------------------------------------------------------

export interface CategoryOps {
  /** Full list with per-category item counts, ordered by name. */
  listWithCounts(): Promise<CategoryRow[]>;
  /** Single row with count, or null when not found. */
  fetchWithCount(id: number): Promise<CategoryRow | null>;
  /** Insert and return the new row's id. */
  create(
    userId: number,
    name: string,
    bgColor: string | null,
    textColor: string | null,
  ): Promise<number>;
  /** Update name; return whether the row existed. */
  rename(id: number, name: string): Promise<boolean>;
  /** Update colors; return whether the row existed. */
  updateColors(
    id: number,
    bgColor: string | null,
    textColor: string | null,
  ): Promise<boolean>;
  /** Delete by id; return whether the row existed. */
  deleteById(id: number): Promise<boolean>;
  /** Delete categories with no assigned items; return count deleted. */
  deleteUnused(): Promise<number>;
  /** Return true if the category row exists (for merge validation). */
  categoryExists(id: number): Promise<boolean>;
  /**
   * For merge: collect all join-table rows currently assigned to
   * `categoryId`. The shape is opaque to the factory — it is passed
   * straight back to `reattachAssignments`.
   */
  getAssignmentsForCategory(categoryId: number): Promise<unknown[]>;
  /**
   * For merge: insert the collected assignments with `targetId` as the
   * new category, ignoring conflicts.
   */
  reattachAssignments(assignments: unknown[], targetId: number): Promise<void>;
  /** Hard-delete the category row (used at the end of merge). */
  deleteCategoryRow(id: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Zod schema bundle expected by the factory
// ---------------------------------------------------------------------------

export interface CategorySchemas {
  listResponse: ParseableSchema;
  listItem: ParseableSchema;
  createBody: ParseableSchema;
  deleteParams: ParseableSchema;
  renameParams: ParseableSchema;
  renameBody: ParseableSchema;
  /** Field parsed from merge body that holds the *target* category id */
  mergeSourceIdField: string;
  mergeBody: ParseableSchema;
  updateColorsBody: ParseableSchema;
  updateColorsParams: ParseableSchema;
}

// ---------------------------------------------------------------------------
// Router config
// ---------------------------------------------------------------------------

export interface CategoryRouterConfig {
  ops: CategoryOps;
  normalize: (raw: string) => string;
  schemas: CategorySchemas;
  /**
   * How to respond after a successful merge.
   * - "no-content" → 204 (pottery, ornaments)
   * - "json-count"  → 200 `{ merged: N }` (quilting)
   */
  mergeResponse?: "no-content" | "json-count";
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

export function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

/**
 * Pottery / ornaments normalisation:
 * trim, coerce inch-mark variants to plain ", capitalise first letter.
 */
export function normalizeCategoryNameSimple(raw: string): string {
  const t = raw.trim().replace(/[″\u201C\u201D]/g, '"');
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Quilting normalisation: aggressive smart-quote / dash / ellipsis coercion
 * plus the same trim and capitalise as the simple variant.
 */
export function normalizeCategoryNameAggressive(raw: string): string {
  const t = raw
    .replace(
      /[\u201C\u201D\u201E\u201F\u2033\u2036\u275D\u275E\u301D\u301E\u02BA\uFF02″]/g,
      '"',
    )
    .replace(
      /[\u2018\u2019\u201A\u201B\u2032\u2035\u275B\u275C\u02B9\u02BC\uFF07′]/g,
      "'",
    )
    .replace(/[\u2013\u2014\u2015\u2012]/g, "-")
    .replace(/\u2026/g, "...")
    .trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---------------------------------------------------------------------------
// Merge helper — shared by route AND Elaine action executors
// ---------------------------------------------------------------------------

export interface MergeResult {
  status: number;
  error?: string;
  merged?: number;
}

export async function mergeCategoriesOp(
  ops: CategoryOps,
  id: number,
  targetId: number,
): Promise<MergeResult> {
  if (id === targetId) {
    return { status: 400, error: "Cannot merge a category into itself." };
  }

  const [sourceExists, targetExists] = await Promise.all([
    ops.categoryExists(id),
    ops.categoryExists(targetId),
  ]);

  if (!sourceExists || !targetExists) {
    return { status: 404, error: "Category not found." };
  }

  const assignments = await ops.getAssignmentsForCategory(id);
  if (assignments.length > 0) {
    await ops.reattachAssignments(assignments, targetId);
  }
  await ops.deleteCategoryRow(id);

  return { status: 204, merged: assignments.length };
}

// ---------------------------------------------------------------------------
// Rename helper — shared by route AND Elaine action executors
// ---------------------------------------------------------------------------

export interface RenameResult {
  status: number;
  error?: string;
  row?: { id: number };
}

export async function renameCategoryOp(
  ops: CategoryOps,
  normalize: (raw: string) => string,
  id: number,
  rawName: string,
): Promise<RenameResult> {
  const name = normalize(rawName);
  try {
    const found = await ops.rename(id, name);
    if (!found) return { status: 404, error: "Category not found." };
    return { status: 200, row: { id } };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      return {
        status: 409,
        error: "A category with that name already exists.",
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Router builder
// ---------------------------------------------------------------------------

export interface BuiltCategoryRouter {
  router: IRouter;
  /** Shared rename logic — for Elaine action executors. */
  rename(id: number, rawName: string): Promise<RenameResult>;
  /** Shared merge logic — for Elaine action executors. */
  merge(id: number, targetId: number): Promise<MergeResult>;
}

export function buildCategoryRouter(
  config: CategoryRouterConfig,
): BuiltCategoryRouter {
  const { ops, normalize, schemas } = config;
  const mergeMode = config.mergeResponse ?? "no-content";

  const router: IRouter = Router();
  router.use(requireAuth);

  // GET /categories
  router.get("/categories", async (_req, res) => {
    const rows = await ops.listWithCounts();
    res.json(schemas.listResponse.parse(rows));
  });

  // POST /categories
  router.post("/categories", async (req, res) => {
    const userId = req.session.userId!;
    const body = schemas.createBody.parse(req.body) as {
      name: string;
      bgColor?: string | null;
      textColor?: string | null;
    };
    const name = normalize(body.name);
    try {
      const id = await ops.create(
        userId,
        name,
        body.bgColor ?? null,
        body.textColor ?? null,
      );
      const withCount = await ops.fetchWithCount(id);
      res.status(201).json(schemas.listItem.parse(withCount));
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

  // PATCH /categories/:id  (rename)
  router.patch("/categories/:id", async (req, res) => {
    const { id } = schemas.renameParams.parse(req.params) as { id: number };
    const body = schemas.renameBody.parse(req.body) as { name: string };
    const result = await renameCategoryOp(ops, normalize, id, body.name);
    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const withCount = await ops.fetchWithCount(id);
    res.json(schemas.listItem.parse(withCount));
  });

  // PUT /categories/:id/colors
  router.put("/categories/:id/colors", async (req, res) => {
    const { id } = schemas.updateColorsParams.parse(req.params) as {
      id: number;
    };
    const body = schemas.updateColorsBody.parse(req.body) as {
      bgColor?: string | null;
      textColor?: string | null;
    };
    const found = await ops.updateColors(
      id,
      body.bgColor ?? null,
      body.textColor ?? null,
    );
    if (!found) {
      res.status(404).json({ error: "Category not found." });
      return;
    }
    const withCount = await ops.fetchWithCount(id);
    res.json(schemas.listItem.parse(withCount));
  });

  // DELETE /categories/unused — must be before /:id so "unused" is not an :id
  router.delete("/categories/unused", async (_req, res) => {
    const deleted = await ops.deleteUnused();
    res.json({ deleted });
  });

  // DELETE /categories/:id
  router.delete("/categories/:id", async (req, res) => {
    const { id } = schemas.deleteParams.parse(req.params) as { id: number };
    const found = await ops.deleteById(id);
    if (!found) {
      res.status(404).json({ error: "Category not found." });
      return;
    }
    res.status(204).end();
  });

  // POST /categories/:id/merge
  router.post("/categories/:id/merge", async (req, res) => {
    const { id } = schemas.deleteParams.parse(req.params) as { id: number };
    const body = schemas.mergeBody.parse(req.body) as Record<string, number>;
    const targetId = body[schemas.mergeSourceIdField];
    const result = await mergeCategoriesOp(ops, id, targetId);
    if (result.status === 400 || result.status === 404) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    if (mergeMode === "json-count") {
      res.json({ merged: result.merged });
    } else {
      res.status(204).end();
    }
  });

  return {
    router,
    rename: (id, rawName) => renameCategoryOp(ops, normalize, id, rawName),
    merge: (id, targetId) => mergeCategoriesOp(ops, id, targetId),
  };
}
