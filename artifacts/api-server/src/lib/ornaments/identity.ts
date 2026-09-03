export interface OrnamentIdentityValues {
  name: string | null;
  seriesOrCollection: string | null;
  year: number | null;
  barcodeValue: string | null;
}

export type OrnamentMaintenanceField =
  | "embedding"
  | "seriesOrCollection"
  | "year";

/**
 * Limits evidence-refresh writes to fields Maintenance still considers missing.
 * Locked identity values are never changed by an AI evidence refresh.
 */
export function buildMissingOrnamentIdentityUpdate(
  missingFields: readonly OrnamentMaintenanceField[],
  lockedFields: readonly string[],
  candidate: Pick<OrnamentIdentityValues, "seriesOrCollection" | "year">,
  embedding: number[],
) {
  const missing = new Set(missingFields);
  const locked = new Set(lockedFields);
  return {
    ...(missing.has("seriesOrCollection") && !locked.has("seriesOrCollection")
      ? { seriesOrCollection: candidate.seriesOrCollection }
      : {}),
    ...(missing.has("year") && !locked.has("year")
      ? { year: candidate.year }
      : {}),
    ...(missing.has("embedding") ? { embedding } : {}),
  };
}

function isPlaceholderName(value: string | null | undefined): boolean {
  return (
    isMissingText(value) || value?.trim().toLowerCase() === "untitled ornament"
  );
}

/**
 * Identity refreshes are enrichment, not replacement. Existing saved facts are
 * retained unless they are clearly placeholders, and a locked field is never
 * changed even when a later pass finds a better candidate.
 */
export function mergeOrnamentIdentity(
  existing: OrnamentIdentityValues,
  candidate: Partial<OrnamentIdentityValues>,
  lockedFields: readonly string[],
): OrnamentIdentityValues {
  const lockedSet = new Set(lockedFields);
  return {
    name:
      lockedSet.has("name") || !isPlaceholderName(existing.name)
        ? existing.name
        : candidate.name?.trim() || existing.name,
    seriesOrCollection:
      lockedSet.has("seriesOrCollection") ||
      !isMissingText(existing.seriesOrCollection)
        ? existing.seriesOrCollection
        : candidate.seriesOrCollection?.trim() || null,
    year:
      lockedSet.has("year") || existing.year != null
        ? existing.year
        : (candidate.year ?? null),
    barcodeValue:
      lockedSet.has("barcodeValue") || !isMissingText(existing.barcodeValue)
        ? existing.barcodeValue
        : candidate.barcodeValue?.trim() || null,
  };
}

function isMissingText(value: string | null | undefined): boolean {
  return !value?.trim();
}
