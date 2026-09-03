import type { MagnetsMagnetItem } from "@workspace/api-client-react";
import { describe, expect, it } from "vitest";
import { buildMagnetCompareItems } from "./collection-compare";

function magnet(
  id: number,
  name: string,
  categoryName: string,
): MagnetsMagnetItem {
  return {
    id,
    name,
    description: `${name} description`,
    imageUrl: null,
    categories: [{ id, name: categoryName, bgColor: null, textColor: null }],
  } as MagnetsMagnetItem;
}

describe("buildMagnetCompareItems", () => {
  it("keeps snapshots selected on different result pages in comparison order", () => {
    const firstPageMagnet = magnet(1, "Alpine magnet", "Travel");
    const secondPageMagnet = magnet(42, "Zephyr magnet", "Vintage");

    const items = buildMagnetCompareItems(
      [firstPageMagnet.id, secondPageMagnet.id],
      new Map([
        [firstPageMagnet.id, firstPageMagnet],
        [secondPageMagnet.id, secondPageMagnet],
      ]),
    );

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.name)).toEqual([
      "Alpine magnet",
      "Zephyr magnet",
    ]);
    expect(items[0]?.fields?.[1]?.value).toBe("Travel");
    expect(items[1]?.fields?.[1]?.value).toBe("Vintage");
  });
});
