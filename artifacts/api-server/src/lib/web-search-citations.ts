const MAX_WEB_SEARCH_CITATIONS = 20;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * OpenRouter standardizes current web-search sources as message
 * `url_citation` annotations. Keep the older top-level string array as a
 * compatibility fallback for providers that still return that extension.
 */
export function extractWebSearchCitations(raw: unknown): string[] {
  const root = asRecord(raw);
  if (!root) return [];

  const candidates: unknown[] = [];
  if (Array.isArray(root.choices)) {
    for (const choice of root.choices) {
      const message = asRecord(asRecord(choice)?.message);
      if (!Array.isArray(message?.annotations)) continue;
      for (const annotationValue of message.annotations) {
        const annotation = asRecord(annotationValue);
        if (annotation?.type !== "url_citation") continue;
        candidates.push(asRecord(annotation.url_citation)?.url);
      }
    }
  }
  if (Array.isArray(root.citations)) candidates.push(...root.citations);

  const citations: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const url = normalizedHttpUrl(candidate);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push(url);
    if (citations.length === MAX_WEB_SEARCH_CITATIONS) break;
  }
  return citations;
}
