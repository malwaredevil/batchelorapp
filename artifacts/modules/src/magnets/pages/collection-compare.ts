import type { MagnetsMagnetItem } from "@workspace/api-client-react";
import type { CompareItem } from "@workspace/collection-ui";

/**
 * Builds comparison rows from snapshots captured when cards are selected.
 *
 * The collection API returns one page at a time, so resolving these IDs from
 * the currently visible page would drop selections made before pagination.
 */
export function buildMagnetCompareItems(
  selectedIds: readonly number[],
  selectedItems: ReadonlyMap<number, MagnetsMagnetItem>,
): CompareItem[] {
  return selectedIds.flatMap((id) => {
    const item = selectedItems.get(id);
    if (!item) return [];

    return [
      {
        id: item.id,
        name: item.name,
        imageUrl: item.imageUrl,
        href: `/magnets/item/${item.id}`,
        fields: [
          {
            label: "Description",
            value: item.description ?? undefined,
          },
          {
            label: "Categories",
            value: item.categories.map((c) => c.name).join(", ") || undefined,
          },
        ],
        colors: [],
      },
    ];
  });
}
