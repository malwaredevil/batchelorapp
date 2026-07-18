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
  extraWhere?: SQL;
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
  extraWhere,
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
      ${extraWhere ? sql`and ${extraWhere}` : sql``}
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
          ${extraWhere ? sql`and ${extraWhere}` : sql``}
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
  const rerankDocs = candidateIds.map((id) => ({
    id,
    text: byId.get(id)?.text ?? "Unknown collection item",
  }));
  const rerankedIds = await rerankCandidates(query, rerankDocs, limit);

  return rerankedIds.slice(0, limit);
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
  const parts: string[] = [];
  if (attrs.name) parts.push(`Name: ${attrs.name}`);
  if (attrs.style) parts.push(`Style: ${attrs.style}`);
  if (attrs.shape) parts.push(`Shape: ${attrs.shape}`);
  if (attrs.maker) parts.push(`Maker: ${attrs.maker}`);
  if (attrs.patternDescription)
    parts.push(`Pattern: ${attrs.patternDescription}`);
  const motifs = Array.isArray(attrs.motifs) ? (attrs.motifs as string[]) : [];
  if (motifs.length) parts.push(`Motifs: ${motifs.join(", ")}`);
  const colors = Array.isArray(attrs.dominantColors)
    ? (attrs.dominantColors as string[])
    : [];
  if (colors.length) parts.push(`Colours: ${colors.join(", ")}`);
  if (attrs.aiDescription) parts.push(attrs.aiDescription);
  return parts.join(". ") || "Unknown pottery piece";
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
}): string {
  const parts: string[] = [];
  if (attrs.name) parts.push(`Name: ${attrs.name}`);
  if (attrs.brand) parts.push(`Brand: ${attrs.brand}`);
  if (attrs.seriesOrCollection)
    parts.push(`Series: ${attrs.seriesOrCollection}`);
  if (attrs.year) parts.push(`Year: ${attrs.year}`);
  const motifs = Array.isArray(attrs.motifs) ? (attrs.motifs as string[]) : [];
  if (motifs.length) parts.push(`Motifs: ${motifs.join(", ")}`);
  const colors = Array.isArray(attrs.dominantColors)
    ? (attrs.dominantColors as string[])
    : [];
  if (colors.length) parts.push(`Colours: ${colors.join(", ")}`);
  if (attrs.notes) parts.push(`Notes: ${attrs.notes}`);
  if (attrs.aiDescription) parts.push(attrs.aiDescription);
  return parts.join(". ") || "Unknown ornament";
}
