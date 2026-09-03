import { and, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

export interface CollectionTextSearchAdapter {
  /** Fields that define the strongest match tier. */
  title: SQLWrapper[];
  /** Optional fields that define the second-strongest match tier. */
  collection?: SQLWrapper[];
  /** Other literal fields that may satisfy a token. */
  broad: SQLWrapper[];
}

export interface CollectionTextSearch {
  tokens: string[];
  where: SQL<unknown> | undefined;
  relevance: SQL<number> | undefined;
}

/**
 * Escape the three characters that have special meaning in a PostgreSQL LIKE
 * pattern. The generated predicates explicitly use backslash as their escape
 * character, so a user's `%`, `_`, or `\` is always treated literally.
 */
export function escapeCollectionSearchLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Gallery search is intentionally word-based rather than semantic. Empty
 * punctuation-only fragments are ignored, while punctuation inside a word is
 * retained and escaped as literal input.
 */
export function normalizeCollectionSearchTokens(query: string): string[] {
  return Array.from(
    new Set(
      query
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => /[\p{L}\p{N}]/u.test(token)),
    ),
  );
}

/**
 * Convert a text array to the exact space-separated form gallery searches use.
 *
 * PostgreSQL marks array_to_string() as STABLE, which prevents a trigram
 * expression index. The immutable database wrapper has the same fixed
 * separator and lets the query expression match that index exactly.
 */
export function collectionSearchArrayText(field: SQLWrapper): SQL<unknown> {
  return sql`collection_search_text(${field})`;
}

function tokenVariants(token: string): string[] {
  const variants = new Set([token]);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 1) {
    variants.add(token.slice(0, -1));
  } else {
    variants.add(`${token}s`);
  }
  return [...variants];
}

function fieldTokenMatch(
  token: string,
  fields: SQLWrapper[],
): SQL<unknown> | undefined {
  if (fields.length === 0) return undefined;
  const patterns = tokenVariants(token).map(
    (variant) => `%${escapeCollectionSearchLikePattern(variant)}%`,
  );
  return or(
    ...fields.flatMap((field) =>
      patterns.map((pattern) => sql`${field} ilike ${pattern} escape '\\'`),
    ),
  );
}

function allTokenMatch(
  tokens: string[],
  fields: SQLWrapper[],
): SQL<unknown> | undefined {
  const matches = tokens
    .map((token) => fieldTokenMatch(token, fields))
    .filter((match): match is SQL<unknown> => Boolean(match));
  return matches.length > 0 ? and(...matches) : undefined;
}

/**
 * Build the complete literal search policy for one collection gallery.
 *
 * Every token must match at least one allowed field (AND across tokens). The
 * returned relevance expression is deterministic and is intended to be the
 * first order key, before a route's existing user-selected sort. The fields
 * passed by gallery routes have matching partial pg_trgm indexes in the shared
 * DDL, so PostgreSQL can use bitmap index scans for three-character-or-longer
 * literal patterns without changing this predictable matching policy.
 */
export function createCollectionTextSearch(
  query: string,
  adapter: CollectionTextSearchAdapter,
): CollectionTextSearch {
  const tokens = normalizeCollectionSearchTokens(query);
  if (tokens.length === 0) {
    return { tokens, where: undefined, relevance: undefined };
  }

  const allSearchableFields = [
    ...adapter.title,
    ...(adapter.collection ?? []),
    ...adapter.broad,
  ];
  const where = allTokenMatch(tokens, allSearchableFields);
  if (!where) return { tokens, where: undefined, relevance: undefined };

  const titleMatch = allTokenMatch(tokens, adapter.title);
  const collectionMatch = allTokenMatch(tokens, adapter.collection ?? []);
  const relevance = sql<number>`case
    when ${titleMatch ?? sql`false`} then 0
    when ${collectionMatch ?? sql`false`} then 1
    else 2
  end`;

  return { tokens, where, relevance };
}
