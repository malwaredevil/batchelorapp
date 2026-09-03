/**
 * Resolve (or create) shared magnet categories by name.
 *
 * Magnet categories are household-shared. userId is recorded solely as
 * creation attribution, while category names are unique across the household.
 */
import { and, inArray } from "drizzle-orm";
import { db, magnetsCategories } from "@workspace/db";

export interface ResolveOptions {
  /** Maximum number of distinct category names to process (default 20). */
  maxCategories?: number;
  /** Maximum length of each category name in characters (default 50). */
  maxNameLength?: number;
}

/**
 * Given raw category names and the creating userId, insert any that do not yet
 * exist for the household and return the resolved IDs.
 *
 * Concurrent callers are handled safely: INSERT … ON CONFLICT DO NOTHING
 * followed by a SELECT avoids duplicates even under parallel requests.
 */
export async function resolveOrCreateMagnetCategories(
  names: string[],
  userId: number,
  options: ResolveOptions = {},
): Promise<number[]> {
  const maxCategories = options.maxCategories ?? 20;
  const maxNameLength = options.maxNameLength ?? 50;

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

  // Insert missing categories (household-wide unique constraint handles conflicts).
  await db
    .insert(magnetsCategories)
    .values(unique.map((name) => ({ userId, name })))
    .onConflictDoNothing();

  // Fetch resolved IDs.
  const rows = await db
    .select({ id: magnetsCategories.id })
    .from(magnetsCategories)
    .where(and(inArray(magnetsCategories.name, unique)));

  return rows.map((r) => r.id);
}
