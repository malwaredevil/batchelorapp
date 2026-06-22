import { env } from "./env";

export const VISUAL_EMBEDDING_DIMENSIONS = 1024;

// ---------------------------------------------------------------------------
// Print-type classification labels (mirrors ANALYSIS_PROMPT in openai.ts)
// ---------------------------------------------------------------------------

const PRINT_TYPE_LABELS = [
  "solid",
  "print",
  "geometric",
  "floral",
  "stripe",
  "plaid",
  "check",
  "batik",
  "novelty",
  "abstract",
  "watercolour",
  "text",
  "animal",
  "holiday",
  "landscape",
  "other",
];

type JinaClassifyResponse = {
  data: Array<{
    predictions: Array<{ label: string; score: number }>;
  }>;
};

/**
 * Zero-shot classify a fabric image's print type using Jina CLIP v2.
 * Returns null when JINA_API_KEY is not configured or on API error
 * (callers should catch and fall back to GPT's extraction).
 *
 * @param imageInput - base64, data URL, or HTTPS URL
 */
export async function classifyPrintType(
  imageInput: string | Buffer,
): Promise<string | null> {
  if (!env.jinaApiKey) return null;

  let input: { image: string } | { url: string };

  if (Buffer.isBuffer(imageInput)) {
    input = { image: imageInput.toString("base64") };
  } else if (imageInput.startsWith("data:")) {
    const base64 = imageInput.split(",")[1];
    if (!base64) return null;
    input = { image: base64 };
  } else if (
    imageInput.startsWith("https://") ||
    imageInput.startsWith("http://")
  ) {
    input = { url: imageInput };
  } else {
    input = { image: imageInput };
  }

  const response = await fetch("https://api.jina.ai/v1/classify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.jinaApiKey}`,
    },
    body: JSON.stringify({
      model: "jina-clip-v2",
      input: [input],
      labels: PRINT_TYPE_LABELS,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Jina classify error ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as JinaClassifyResponse;
  const predictions = data.data[0]?.predictions;
  if (!predictions || predictions.length === 0) return null;

  const best = predictions.reduce((a, b) => (a.score > b.score ? a : b));
  return best.label;
}

type JinaEmbeddingResponse = {
  data: Array<{ embedding: number[] }>;
};

/**
 * Generate a 1024-dim visual embedding for an image using the Jina CLIP v2
 * model. Returns null when JINA_API_KEY is not configured so callers can
 * gracefully skip the visual lane without hard-failing.
 *
 * @param imageInput - Either a base64 string, a data URL (data:image/...;base64,...),
 *                     or a remote HTTPS URL.
 */
export async function generateVisualEmbedding(
  imageInput: string | Buffer,
): Promise<number[] | null> {
  if (!env.jinaApiKey) return null;

  let input: { image: string } | { url: string };

  if (Buffer.isBuffer(imageInput)) {
    input = { image: imageInput.toString("base64") };
  } else if (imageInput.startsWith("data:")) {
    const base64 = imageInput.split(",")[1];
    if (!base64) return null;
    input = { image: base64 };
  } else if (
    imageInput.startsWith("https://") ||
    imageInput.startsWith("http://")
  ) {
    input = { url: imageInput };
  } else {
    input = { image: imageInput };
  }

  const response = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.jinaApiKey}`,
    },
    body: JSON.stringify({
      model: "jina-clip-v2",
      input: [input],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jina API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as JinaEmbeddingResponse;
  return data.data[0]?.embedding ?? null;
}

/**
 * Compute the cosine similarity between two equal-length vectors. Returns a
 * value in [0, 1] where 1 is identical direction (same image appearance).
 */
export function cosineSimlarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
