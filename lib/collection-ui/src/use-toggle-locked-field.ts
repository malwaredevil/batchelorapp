import { useCallback } from "react";
import { toast } from "sonner";

/**
 * Shared implementation of the "per-field locked_fields" convention used
 * across pottery/quilting/ornaments/travels detail pages: a `text[]` column
 * on the record tracks which fields the user has manually locked so the AI
 * merge skips them. Every detail page independently reimplemented the same
 * toggle-and-toast logic (see .agents/memory/locked-fields-pattern.md) —
 * this hook is the single source of truth so new detail pages don't have to
 * copy it again.
 */
export function toggleLockedField(
  current: readonly string[] | null | undefined,
  field: string,
): string[] {
  const list = current ?? [];
  return list.includes(field)
    ? list.filter((existing) => existing !== field)
    : [...list, field];
}

/**
 * Resolves the final list of category names to save from a detail page's
 * "edit categories" panel: the checked subset of `allCategories` plus any
 * newly-created categories not yet in that list, filtered down to the
 * checked ids. Every collection detail page (pattern/quilt/fabric/…)
 * reimplemented this same merge-then-filter-then-map before persisting.
 */
export function mergeSelectedCategoryNames<
  TCategory extends { id: number; name: string },
>(
  allCategories: readonly TCategory[] | null | undefined,
  localNewCategories: readonly TCategory[],
  selectedCategoryIds: readonly number[],
): string[] {
  const base = allCategories ?? [];
  const merged = [
    ...base,
    ...localNewCategories.filter(
      (nc) => !base.some((existing) => existing.id === nc.id),
    ),
  ];
  return merged
    .filter((c) => selectedCategoryIds.includes(c.id))
    .map((c) => c.name);
}

export type ToggleLockedFieldMessages = {
  locked?: (field: string) => string;
  unlocked?: (field: string) => string;
};

/**
 * Returns a `toggleLock(field)` callback that flips `field`'s locked state
 * on `record`, persists the new locked-fields array via `onToggle`, and
 * shows a locked/unlocked toast. Pass `messages` to customize the toast copy
 * (e.g. a page-specific hint like "AI won't change this"); it defaults to
 * the plain `"field" locked` / `"field" unlocked` wording.
 *
 * `record` may be `null`/`undefined` while the detail page is still loading;
 * the returned callback is then a no-op, matching every existing call site's
 * `if (!record) return;` guard.
 */
export function useToggleLockedField<T>(
  record: T | null | undefined,
  getLockedFields: (record: T) => readonly string[] | null | undefined,
  onToggle: (nextLockedFields: string[], field: string) => void,
  messages?: ToggleLockedFieldMessages,
): (field: string) => void {
  return useCallback(
    (field: string) => {
      if (!record) return;
      const next = toggleLockedField(getLockedFields(record), field);
      onToggle(next, field);
      const isLocked = next.includes(field);
      toast.success(
        isLocked
          ? (messages?.locked ?? ((f) => `"${f}" locked`))(field)
          : (messages?.unlocked ?? ((f) => `"${f}" unlocked`))(field),
      );
    },
    [record, getLockedFields, onToggle, messages],
  );
}
