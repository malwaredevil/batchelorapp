import { inArray } from "drizzle-orm";
import { db, quiltingCategories } from "@workspace/db";
import { getCategoryPalette } from "@workspace/web-core/colors";

export interface ResolveQuiltingCategoriesOptions {
  maxCategories?: number;
  maxNameLength?: number;
}

/**
 * Resolve category names for all Quilting item types. The database remains the
 * authority; concurrent creators are handled by on-conflict-ignore followed
 * by a final lookup.
 */
export async function resolveOrCreateQuiltingCategories(
  names: string[],
  options: ResolveQuiltingCategoriesOptions = {},
): Promise<number[]> {
  const maxCategories = options.maxCategories ?? 50;
  const maxNameLength = options.maxNameLength ?? 100;
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    const name = raw.trim().slice(0, maxNameLength);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
    if (unique.length >= maxCategories) break;
  }
  if (unique.length === 0) return [];

  await db
    .insert(quiltingCategories)
    .values(
      unique.map((name) => ({
        name,
        ...getCategoryPalette(name),
      })),
    )
    .onConflictDoNothing();

  const rows = await db
    .select({ id: quiltingCategories.id })
    .from(quiltingCategories)
    .where(inArray(quiltingCategories.name, unique));

  return rows.map((row) => row.id);
}
