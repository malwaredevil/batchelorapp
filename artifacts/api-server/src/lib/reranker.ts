/**
 * Voyage AI reranker — improves Compare precision by re-scoring RRF candidates
 * against the uploaded fabric's text description before the vision model call.
 *
 * Gracefully degrades: when VOYAGE_API_KEY is absent or the API call fails,
 * the original RRF ordering is preserved unchanged.
 */
import { env } from "./env";
import { withRetry } from "./retry";
import { getConfig } from "./app-config";

const VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank";
// rerank-2.5 is Voyage's current generalist model: better retrieval quality
// than the legacy rerank-2 we used to call, plus a 32k-token context limit
// (vs 16k) and instruction-following support. Our per-document text is short
// (a few structured attribute lines), so we're nowhere near either limit —
// the win here is purely ranking quality on the same requests we already make.
const RERANK_MODEL = "rerank-2.5";

interface VoyageRerankResponse {
  data: Array<{
    index: number;
    relevance_score: number;
    document?: string;
  }>;
}

/**
 * Re-score a list of candidates against a text query using Voyage rerank-2.
 *
 * @param query     Text description of the uploaded (candidate) fabric.
 * @param documents Ordered list of {id, text} — one per existing fabric.
 * @param topK      How many top results to return (Voyage truncates server-side).
 * @returns         Array of IDs in reranked order (highest score first).
 *                  Falls back to the original order on error or missing key.
 */
export async function rerankCandidates(
  query: string,
  documents: Array<{ id: number; text: string }>,
  topK: number,
): Promise<number[]> {
  const originalOrder = documents.map((d) => d.id);

  if (!env.voyageApiKey || documents.length === 0) {
    return originalOrder;
  }

  try {
    const rerankerTimeoutMs = await getConfig(
      "quilting",
      "reranker_timeout_ms",
      10_000,
    );
    const response = await withRetry(
      () =>
        fetch(VOYAGE_RERANK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.voyageApiKey}`,
          },
          body: JSON.stringify({
            model: RERANK_MODEL,
            query,
            documents: documents.map((d) => d.text),
            top_k: Math.min(topK, documents.length),
            return_documents: false,
          }),
          signal: AbortSignal.timeout(rerankerTimeoutMs),
        }),
      { label: "voyage-rerank" },
    );

    if (!response.ok) {
      return originalOrder;
    }

    const data = (await response.json()) as VoyageRerankResponse;
    const reranked = data.data
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map((item) => documents[item.index].id);

    return reranked;
  } catch {
    return originalOrder;
  }
}

/**
 * Build a plain-text document string from a fabric's structured attributes.
 * This is what Voyage compares against the query.
 */
export function buildFabricDocument(attrs: {
  name: string | null;
  lineName?: string | null;
  designer?: string | null;
  manufacturer?: string | null;
  printType?: string | null;
  motifs?: unknown;
  dominantColors?: unknown;
  styleDescriptors?: unknown;
  aiDescription?: string | null;
}): string {
  const parts: string[] = [];
  if (attrs.name) parts.push(`Name: ${attrs.name}`);
  if (attrs.lineName) parts.push(`Line: ${attrs.lineName}`);
  if (attrs.designer) parts.push(`Designer: ${attrs.designer}`);
  if (attrs.manufacturer) parts.push(`Manufacturer: ${attrs.manufacturer}`);
  if (attrs.printType) parts.push(`Print type: ${attrs.printType}`);
  const motifs = Array.isArray(attrs.motifs) ? (attrs.motifs as string[]) : [];
  if (motifs.length) parts.push(`Motifs: ${motifs.join(", ")}`);
  const colors = Array.isArray(attrs.dominantColors)
    ? (attrs.dominantColors as string[])
    : [];
  if (colors.length) parts.push(`Colors: ${colors.join(", ")}`);
  const style = Array.isArray(attrs.styleDescriptors)
    ? (attrs.styleDescriptors as string[])
    : [];
  if (style.length) parts.push(`Style: ${style.join(", ")}`);
  if (attrs.aiDescription) parts.push(attrs.aiDescription);
  return parts.join(". ") || "Unknown fabric";
}
