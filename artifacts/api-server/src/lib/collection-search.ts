import { sql, type SQL } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { db as appDb } from "@workspace/db";
import { embedText } from "./openai";
import { reciprocalRankFusion, rerankCandidates } from "./reranker";
import { getJinaTextEmbedding } from "./visual-embed";

type AppDb = typeof appDb;

interface RankedRow extends Record<string, unknown> {
  id: number;
  similarity: number;
}

export interface CollectionSearchOptions {
  query: string;
  table: AnyPgTable;
  textEmbeddingCol: string;
  visualEmbeddingCol: string;
  limit?: number;
  visibilityWhere: SQL;
  db: AppDb;
  fetchDocuments: (
    ids: number[],
  ) => Promise<Array<{ id: number; text: string }>>;
}

const SEARCH_POOL = 60;
const RERANK_POOL = 20;

export async function semanticCollectionSearch({
  query,
  table,
  textEmbeddingCol,
  visualEmbeddingCol,
  limit = 40,
  visibilityWhere,
  db,
  fetchDocuments,
}: CollectionSearchOptions): Promise<number[]> {
  const queryEmbedding = await embedText(query);
  if (queryEmbedding.length === 0) return [];

  const textColumn = sql.identifier(textEmbeddingCol);
  const visualColumn = sql.identifier(visualEmbeddingCol);
  const queryVec = `[${queryEmbedding.join(",")}]`;

  const textLane = await db.execute<RankedRow>(sql`
    select id, 1 - (${textColumn} <=> ${queryVec}::vector) as similarity
    from ${table}
    where ${textColumn} is not null
      and ${visibilityWhere}
    order by ${textColumn} <=> ${queryVec}::vector
    limit ${SEARCH_POOL}
  `);

  let visualRows: RankedRow[] = [];
  try {
    const jinaEmbedding = await getJinaTextEmbedding(query);
    if (jinaEmbedding) {
      const jinaVec = `[${jinaEmbedding.join(",")}]`;
      const visualLane = await db.execute<RankedRow>(sql`
        select id, 1 - (${visualColumn} <=> ${jinaVec}::vector) as similarity
        from ${table}
        where ${visualColumn} is not null
          and ${visibilityWhere}
        order by ${visualColumn} <=> ${jinaVec}::vector
        limit ${SEARCH_POOL}
      `);
      visualRows = visualLane.rows.map((row) => ({
        id: Number(row.id),
        similarity: Number(row.similarity),
      }));
    }
  } catch {
    visualRows = [];
  }

  const merged = reciprocalRankFusion(
    [
      textLane.rows.map((row) => ({
        id: Number(row.id),
        similarity: Number(row.similarity),
      })),
      visualRows,
    ],
    60,
    RERANK_POOL,
  );

  if (merged.length === 0) return [];

  const candidateIds = merged.map((row) => row.id);
  const documents = await fetchDocuments(candidateIds);
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  // A row can be deleted between candidate selection and hydration. Only pass
  // documents that are still visible to the reranker and final result set.
  const visibleCandidateIds = candidateIds.filter((id) => byId.has(id));
  const rerankDocs = visibleCandidateIds.map((id) => ({
    id,
    text: byId.get(id)!.text,
  }));
  if (rerankDocs.length === 0) return [];
  const rerankedIds = await rerankCandidates(query, rerankDocs, limit);

  return rerankedIds.slice(0, limit);
}

/**
 * One entry of a plain-text search/rerank document:
 *   - `{ label, value }` — emitted as "Label: value" when the value is truthy.
 *   - `{ label, list }`  — emitted as "Label: a, b" when the (unknown-typed)
 *     value is a non-empty array; anything else is treated as empty.
 *   - `{ text }`         — emitted verbatim when truthy (free-form prose).
 */
type SearchDocumentPart =
  | { label: string; value: string | number | null | undefined }
  | { label: string; list: unknown }
  | { text: string | null | undefined };

/**
 * Shared document builder behind every per-domain build*Document function
 * (pottery search + compare, fabric search, ornament search): render the
 * truthy parts in order, joined by ". ", falling back to `fallback` when
 * nothing is present.
 */
export function buildSearchDocument(
  parts: SearchDocumentPart[],
  fallback: string,
): string {
  const rendered: string[] = [];
  for (const part of parts) {
    if ("list" in part) {
      const items = Array.isArray(part.list) ? (part.list as string[]) : [];
      if (items.length) rendered.push(`${part.label}: ${items.join(", ")}`);
    } else if ("value" in part) {
      if (part.value) rendered.push(`${part.label}: ${part.value}`);
    } else if (part.text) {
      rendered.push(part.text);
    }
  }
  return rendered.join(". ") || fallback;
}

export function buildPotterySearchDocument(attrs: {
  name: string | null;
  style?: string | null;
  shape?: string | null;
  maker?: string | null;
  patternDescription?: string | null;
  motifs?: unknown;
  dominantColors?: unknown;
  aiDescription?: string | null;
}): string {
  return buildSearchDocument(
    [
      { label: "Name", value: attrs.name },
      { label: "Style", value: attrs.style },
      { label: "Shape", value: attrs.shape },
      { label: "Maker", value: attrs.maker },
      { label: "Pattern", value: attrs.patternDescription },
      { label: "Motifs", list: attrs.motifs },
      { label: "Colours", list: attrs.dominantColors },
      { text: attrs.aiDescription },
    ],
    "Unknown pottery piece",
  );
}

export function buildFabricSearchDocument(attrs: {
  name: string | null;
  designer?: string | null;
  manufacturer?: string | null;
  colorway?: string | null;
  notes?: string | null;
  dominantColors?: unknown;
  aiDescription?: string | null;
}): string {
  return buildSearchDocument(
    [
      { label: "Name", value: attrs.name },
      { label: "Designer", value: attrs.designer },
      { label: "Manufacturer", value: attrs.manufacturer },
      { label: "Colorway", value: attrs.colorway },
      { label: "Colours", list: attrs.dominantColors },
      { label: "Notes", value: attrs.notes },
      { text: attrs.aiDescription },
    ],
    "Unknown fabric",
  );
}

export function buildOrnamentSearchDocument(attrs: {
  name: string | null;
  brand?: string | null;
  seriesOrCollection?: string | null;
  year?: number | null;
  notes?: string | null;
  motifs?: unknown;
  dominantColors?: unknown;
  aiDescription?: string | null;
  description?: string | null;
}): string {
  return buildSearchDocument(
    [
      { label: "Name", value: attrs.name },
      { label: "Brand", value: attrs.brand },
      { label: "Series", value: attrs.seriesOrCollection },
      { label: "Year", value: attrs.year },
      { label: "Motifs", list: attrs.motifs },
      { label: "Colours", list: attrs.dominantColors },
      { label: "Notes", value: attrs.notes },
      { text: attrs.aiDescription },
      { text: attrs.description },
    ],
    "Unknown ornament",
  );
}
