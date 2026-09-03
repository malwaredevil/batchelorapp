import { pathCacheBuster } from "../path-cache-buster";
import type { OrnamentItemRow } from "@workspace/db";
import {
  ornamentsItemCategories as itemCategories,
  ornamentsCategories as categories,
  ornamentsImages,
} from "@workspace/db";
import {
  createCollectionSerializer,
  makeFetchRawCategories,
  makeFetchRawImages,
  type CategoryResult,
  type ImageResult,
} from "../collection-item-serializer";

type ItemRowForSerialization = Omit<
  OrnamentItemRow,
  "embedding" | "visualEmbedding"
>;

export type { CategoryResult };

export interface OrnamentImageResult extends ImageResult {}

export interface SerializedItem {
  id: number;
  name: string;
  brand: string;
  seriesOrCollection: string | null;
  year: number | null;
  barcodeValue: string | null;
  quantity: number;
  lockedFields: string[];
  notes: string | null;
  dimensions: string | null;
  origin: string | null;
  aiDescription: string | null;
  description: string | null;
  descriptionGenerated: boolean;
  acquiredAt: string | null;
  dominantColors: string[];
  motifs: string[];
  bookValue: number | null;
  bookValueSource: string | null;
  bookValueUpdatedAt: Date | null;
  retailValueUsd: number | null;
  retailValueProductUrl: string | null;
  retailValueSource: string | null;
  retailValueUpdatedAt: Date | null;
  ebayPriceMinUsd: number | null;
  ebayPriceMaxUsd: number | null;
  ebayLastSoldPriceUsd: number | null;
  ebayLastSoldDate: Date | null;
  ebayPriceCachedAt: Date | null;
  aiAppraisal: string | null;
  aiAppraisalUpdatedAt: Date | null;
  categories: CategoryResult[];
  images: OrnamentImageResult[];
  imageUrl: string;
  createdAt: Date;
}

const { serializeItem, serializeItems } = createCollectionSerializer<
  ItemRowForSerialization,
  SerializedItem
>({
  fetchRawCategories: makeFetchRawCategories(itemCategories, categories),
  fetchRawImages: makeFetchRawImages(ornamentsImages, "ornaments"),

  toItem(row, cats, imgs) {
    return {
      id: row.id,
      name: row.name,
      brand: row.brand,
      seriesOrCollection: row.seriesOrCollection,
      year: row.year,
      barcodeValue: row.barcodeValue,
      quantity: row.quantity,
      lockedFields: row.lockedFields ?? [],
      notes: row.notes,
      dimensions: row.dimensions,
      origin: row.origin,
      aiDescription: row.aiDescription,
      description: row.description,
      descriptionGenerated: row.descriptionGenerated ?? false,
      acquiredAt: row.acquiredAt,
      dominantColors: row.dominantColors ?? [],
      motifs: row.motifs ?? [],
      bookValue: row.bookValue != null ? parseFloat(row.bookValue) : null,
      bookValueSource: row.bookValueSource,
      bookValueUpdatedAt: row.bookValueUpdatedAt,
      retailValueUsd:
        row.retailValueUsd != null ? parseFloat(row.retailValueUsd) : null,
      retailValueProductUrl: row.retailValueProductUrl,
      retailValueSource: row.retailValueSource,
      retailValueUpdatedAt: row.retailValueUpdatedAt,
      ebayPriceMinUsd:
        row.ebayPriceMinUsd != null ? parseFloat(row.ebayPriceMinUsd) : null,
      ebayPriceMaxUsd:
        row.ebayPriceMaxUsd != null ? parseFloat(row.ebayPriceMaxUsd) : null,
      ebayLastSoldPriceUsd:
        row.ebayLastSoldPriceUsd != null
          ? parseFloat(row.ebayLastSoldPriceUsd)
          : null,
      ebayLastSoldDate: row.ebayLastSoldDate,
      ebayPriceCachedAt: row.ebayPriceCachedAt,
      aiAppraisal: row.aiAppraisal,
      aiAppraisalUpdatedAt: row.aiAppraisalUpdatedAt,
      categories: cats,
      images: imgs,
      imageUrl: `/api/ornaments/items/${row.id}/image?v=${pathCacheBuster(row.imagePath)}`,
      createdAt: row.createdAt,
    };
  },
});

export { serializeItem, serializeItems };
