import { and, eq, isNull } from "drizzle-orm";
import { db, potteryItems } from "@workspace/db";
import {
  createCollectionReviewReader,
  collectionReviewEvidence,
  type CollectionReviewRow,
} from "./collection-review-reader";
import {
  listPotteryQueryPageSizeDefault,
  listPotteryQueryPageSizeMax,
} from "@workspace/api-zod";

export const BROWSE_POTTERY_COLLECTION_TOOL_NAME = "browse_pottery_collection";

// No embeddings, storage paths, image bytes, or per-uploader ownership filters.
export const potteryReviewColumns = {
  id: potteryItems.id,
  name: potteryItems.name,
  maker: potteryItems.maker,
  style: potteryItems.style,
  shape: potteryItems.shape,
  dimensions: potteryItems.dimensions,
  patternDescription: potteryItems.patternDescription,
  aiDescription: potteryItems.aiDescription,
  dominantColors: potteryItems.dominantColors,
  motifs: potteryItems.motifs,
  glazeType: potteryItems.glazeType,
  surfaceZones: potteryItems.surfaceZones,
  notes: potteryItems.notes,
};

export const POTTERY_CATALOG_EVIDENCE_POLICY =
  "Saved catalog metadata only; photosInspected=0. A displayed photo or signed image URL is not image inspection. Saved AI descriptions may be incomplete or wrong. Missing fields are unknown, not evidence of no decoration. Only describe direct visual findings after an authorized vision tool has actually inspected image pixels; analyze_pottery_photo inspects only photos attached to the current message.";

export function potteryReviewEvidence(row: CollectionReviewRow) {
  return collectionReviewEvidence(
    row,
    "itemId",
    !row.patternDescription && !row.aiDescription,
  );
}

export async function readPotteryReviewItem(itemId: number) {
  const [row] = await db
    .select({
      ...potteryReviewColumns,
      imagePath: potteryItems.imagePath,
    })
    .from(potteryItems)
    .where(and(eq(potteryItems.id, itemId), isNull(potteryItems.deletedAt)));
  return row;
}

const potteryReader = createCollectionReviewReader({
  domain: "pottery",
  name: BROWSE_POTTERY_COLLECTION_TOOL_NAME,
  table: potteryItems,
  id: potteryItems.id,
  deletedAt: potteryItems.deletedAt,
  columns: potteryReviewColumns,
  pageSizeDefault: listPotteryQueryPageSizeDefault,
  pageSizeMax: listPotteryQueryPageSizeMax,
  evidencePolicy: POTTERY_CATALOG_EVIDENCE_POLICY,
  idKey: "itemId",
  missingDescription: (row) => !row.patternDescription && !row.aiDescription,
});

export const BrowsePotteryPayload = potteryReader.payload;
export const potteryCollectionReadTools = potteryReader.tools;
export const browsePotteryCollection = potteryReader.browse;
