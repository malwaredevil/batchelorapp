/**
 * activity-photo-refs.ts
 *
 * Shared helpers for clearing photo and document references from itinerary
 * activities when a trip photo or document is removed (soft-delete route or
 * purge job).
 */

type LooseItineraryActivity = Record<string, unknown> & {
  photoId?: number;
  photoIds?: number[];
};
type LooseItineraryDay = { activities?: LooseItineraryActivity[] } & Record<
  string,
  unknown
>;
type LooseItinerary = { days?: LooseItineraryDay[] } & Record<string, unknown>;

/**
 * Strips any itinerary activity's reference to a deleted trip photo, so a
 * removed gallery photo never leaves a dangling/broken thumbnail on an
 * itinerary activity.  Handles both the legacy scalar `photoId` field and
 * the new `photoIds` array — for the array case, the deleted id is filtered
 * out rather than clearing the whole list.  Returns the updated itinerary
 * object to persist, or null if nothing referenced this photo (no write
 * needed).
 */
export function clearActivityPhotoReferences(
  itinerary: unknown,
  photoId: number,
): LooseItinerary | null {
  if (
    !itinerary ||
    typeof itinerary !== "object" ||
    !Array.isArray((itinerary as LooseItinerary).days)
  ) {
    return null;
  }
  const typed = itinerary as LooseItinerary;
  let changed = false;
  const days = (typed.days ?? []).map((day) => {
    if (!Array.isArray(day.activities)) return day;
    const activities = day.activities.map((activity) => {
      let updated = { ...activity };

      // Legacy scalar field
      if (updated.photoId === photoId) {
        changed = true;
        const { photoId: _removed, ...rest } = updated;
        updated = rest as LooseItineraryActivity;
      }

      // New array field — filter out just this id
      if (
        Array.isArray(updated.photoIds) &&
        updated.photoIds.includes(photoId)
      ) {
        changed = true;
        const filtered = updated.photoIds.filter((id) => id !== photoId);
        if (filtered.length === 0) {
          const { photoIds: _removed, ...rest } = updated;
          updated = rest as LooseItineraryActivity;
        } else {
          updated = { ...updated, photoIds: filtered };
        }
      }

      return updated;
    });
    return { ...day, activities };
  });
  if (!changed) return null;
  return { ...typed, days };
}

/**
 * Strips any itinerary activity's `sourceDocumentId` (and the paired
 * `sourceField`) reference to a deleted trip document.  Returns the updated
 * itinerary object to persist, or null if nothing referenced this document
 * (no write needed).
 *
 * This is called both by the purge job (universal fallback that handles any
 * document regardless of which delete route was used) and by the
 * trip-scoped soft-delete route as an early-clearing optimisation.
 */
export function clearActivityDocumentReferences(
  itinerary: unknown,
  docId: number,
): LooseItinerary | null {
  if (
    !itinerary ||
    typeof itinerary !== "object" ||
    !Array.isArray((itinerary as LooseItinerary).days)
  ) {
    return null;
  }
  const typed = itinerary as LooseItinerary;
  let changed = false;
  const days = (typed.days ?? []).map((day) => {
    if (!Array.isArray(day.activities)) return day;
    const activities = day.activities.map((activity) => {
      const act = activity as Record<string, unknown>;
      if (act.sourceDocumentId !== docId) return activity;
      changed = true;
      // Remove both sourceDocumentId and its paired sourceField.
      const { sourceDocumentId: _sd, sourceField: _sf, ...rest } = act;
      return rest as LooseItineraryActivity;
    });
    return { ...day, activities };
  });
  if (!changed) return null;
  return { ...typed, days };
}
