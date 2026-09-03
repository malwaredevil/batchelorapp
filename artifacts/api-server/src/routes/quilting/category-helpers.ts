/**
 * Shared category helpers for Quilting's blocks and layouts routes.
 *
 * Both routes attach shared household categories to their entities via the
 * same entity_categories association table, differing only in the
 * entityType discriminator ("block" vs "layout"). The resolve/create and
 * batch-fetch logic lives here once instead of being duplicated per route.
 */
import { eq } from "drizzle-orm";
import { db, quiltingCategories as categories } from "@workspace/db";
import {
  fetchCategoriesForEntities,
  type CategoryResult,
} from "../../lib/serialize";
import { getCategoryPalette } from "@workspace/web-core/colors";

export const MAX_CATEGORY_NAMES = 20;
export const MAX_CATEGORY_NAME_LEN = 100;

export type { CategoryResult };

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

/** Resolve category names → IDs, creating shared household categories as needed. */
export async function resolveOrCreateCategories(
  names: string[],
): Promise<number[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(
    0,
    MAX_CATEGORY_NAMES,
  );
  const ids: number[] = [];
  for (const name of unique) {
    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, name))
      .limit(1);
    if (existing) {
      ids.push(existing.id);
    } else {
      try {
        const [created] = await db
          .insert(categories)
          .values({ name, ...getCategoryPalette(name) })
          .returning({ id: categories.id });
        if (created) ids.push(created.id);
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
        // Created concurrently by another request — look it up.
        const [race] = await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.name, name))
          .limit(1);
        if (race) ids.push(race.id);
      }
    }
  }
  return ids;
}

/** Fetch categories for a batch of entity IDs of the given entity type. */
export function fetchEntityCategories(
  entityType: "block" | "layout",
  entityIds: number[],
): Promise<Map<number, CategoryResult[]>> {
  return fetchCategoriesForEntities(entityType, entityIds);
}
