// ---------------------------------------------------------------------------
// Motif normalisation + tally
//
// The AI describes the same decoration with slightly different words across
// pieces ("flowers" vs "floral", "vine borders" vs "vine border"). Without
// grouping, those count as separate motifs and the "Common motifs" tally is
// fragmented. We normalise each motif phrase word-by-word — singularising
// plurals and folding a small set of known synonyms onto a canonical token —
// then count pieces under the normalised key while remembering the actual
// spellings so we can show the most common one as the label.
//
// This runs in the browser over the already-loaded collection list, so it can
// reflect the current search/filter for free (no extra network request).
// ---------------------------------------------------------------------------

/** Canonical token for individual words that mean the same decoration. */
const MOTIF_WORD_SYNONYMS: Record<string, string> = {
  flower: "floral",
  floral: "floral",
  flora: "floral",
  blossom: "floral",
  leaf: "foliage",
  leaves: "foliage",
  leave: "foliage",
  leafy: "foliage",
  foliage: "foliage",
  vine: "vine",
  stripe: "stripe",
  striped: "stripe",
  band: "band",
  banding: "band",
  dot: "dot",
  dotted: "dot",
  polkadot: "dot",
  spot: "dot",
  spotted: "dot",
  geometrical: "geometric",
  geometric: "geometric",
  swirl: "swirl",
  swirled: "swirl",
  scroll: "scroll",
  scrolled: "scroll",
  scrollwork: "scroll",
  checker: "checked",
  checkered: "checked",
  checked: "checked",
  abstract: "abstract",
};

/** Very light English singulariser — enough to fold motif plurals. */
function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (
    word.endsWith("sses") ||
    word.endsWith("shes") ||
    word.endsWith("ches") ||
    word.endsWith("xes")
  ) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Normalise a motif phrase to a canonical key for grouping. */
export function normalizeMotif(raw: string): string {
  const words = raw
    .toLowerCase()
    .trim()
    .replace(/[.,;:]+$/g, "")
    .replace(/[-_]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  return words
    .map((word) => {
      const direct = MOTIF_WORD_SYNONYMS[word];
      if (direct) return direct;
      const singular = singularize(word);
      return MOTIF_WORD_SYNONYMS[singular] ?? singular;
    })
    .join(" ");
}

type MotifBucket = { count: number; variants: Map<string, number> };

/** Pick the most frequently used original spelling as the display label. */
function bucketLabel(variants: Map<string, number>): string {
  return [...variants.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0][0];
}

/**
 * Count motifs across the given items, grouping near-duplicates, and return the
 * most common ones (label = most-used original spelling, count = pieces).
 */
export function topMotifs(
  items: { motifs?: string[] }[],
  limit = 8,
): { label: string; count: number }[] {
  const buckets = new Map<string, MotifBucket>();

  for (const item of items) {
    for (const motif of item.motifs ?? []) {
      const display = motif.trim();
      if (!display) continue;
      const key = normalizeMotif(display);
      if (!key) continue;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { count: 0, variants: new Map() };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      const variant = display.toLowerCase();
      bucket.variants.set(variant, (bucket.variants.get(variant) ?? 0) + 1);
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((bucket) => ({ label: bucketLabel(bucket.variants), count: bucket.count }));
}
