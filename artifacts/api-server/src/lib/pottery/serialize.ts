import { pathCacheBuster } from "../path-cache-buster";
import type { PotteryItemRow } from "@workspace/db";
import {
  potteryItemCategories as itemCategories,
  potteryCategories as categories,
  potteryImages,
} from "@workspace/db";
import {
  createCollectionSerializer,
  makeFetchRawCategories,
  makeFetchRawImages,
  type CategoryResult,
  type ImageResult,
} from "../collection-item-serializer";
import {
  getCompletePhotoScanStatus,
  type CompletePhotoScanStatus,
} from "../ai-scan-pipeline";

type ItemRowForSerialization = Omit<
  PotteryItemRow,
  "embedding" | "visualEmbedding" | "zoneEmbedding"
>;

export type { CategoryResult };

export interface PotteryImageResult extends ImageResult {}

export interface SerializedItem {
  id: number;
  name: string;
  quantity: number;
  lockedFields: string[];
  notes: string | null;
  dimensions: string | null;
  patternDescription: string | null;
  style: string | null;
  shape: string | null;
  maker: string | null;
  makerInfo: string | null;
  aiDescription: string | null;
  acquiredAt: string | null;
  dominantColors: string[];
  motifs: string[];
  glazeType: string | null;
  surfaceZones: unknown;
  categories: CategoryResult[];
  images: PotteryImageResult[];
  imageUrl: string;
  recognitionRefreshStatus: CompletePhotoScanStatus | null;
  createdAt: Date;
}

const { serializeItem, serializeItems } = createCollectionSerializer<
  ItemRowForSerialization,
  SerializedItem
>({
  fetchRawCategories: makeFetchRawCategories(itemCategories, categories),
  fetchRawImages: makeFetchRawImages(potteryImages, "pottery"),

  toItem(row, cats, imgs) {
    return {
      id: row.id,
      name: row.name,
      quantity: row.quantity,
      lockedFields: row.lockedFields ?? [],
      notes: row.notes,
      dimensions: row.dimensions,
      patternDescription: row.patternDescription,
      style: row.style,
      shape: row.shape,
      maker: row.maker,
      makerInfo: row.makerInfo,
      aiDescription: row.aiDescription,
      acquiredAt: row.acquiredAt,
      dominantColors: row.dominantColors ?? [],
      motifs: row.motifs ?? [],
      glazeType: row.glazeType ?? null,
      surfaceZones: row.surfaceZones ?? null,
      categories: cats,
      images: imgs,
      imageUrl: `/api/pottery/items/${row.id}/image?v=${pathCacheBuster(row.imagePath)}`,
      recognitionRefreshStatus:
        getCompletePhotoScanStatus(`pottery:${row.id}`) ?? null,
      createdAt: row.createdAt,
    };
  },
});

export { serializeItem, serializeItems };
