import { fabrics, ornamentsItems } from "@workspace/db";
import {
  listFabricsQueryPageSizeDefault,
  listFabricsQueryPageSizeMax,
  listOrnamentsQueryPageSizeDefault,
  listOrnamentsQueryPageSizeMax,
} from "@workspace/api-zod";
import {
  createCollectionReviewReader,
  type CollectionReviewRow,
} from "./collection-review-reader";

export const BROWSE_FABRIC_COLLECTION_TOOL_NAME = "browse_fabric_collection";
export const BROWSE_ORNAMENT_COLLECTION_TOOL_NAME =
  "browse_ornament_collection";

export const HOUSEHOLD_CATALOG_EVIDENCE_POLICY =
  "Saved catalog metadata only; photosInspected=0. A displayed photo or signed image URL is not image inspection. Saved AI descriptions may be incomplete or wrong. Missing descriptions are unknown, not absent features. Say 'based on saved descriptions', not 'I looked at every photo'. Direct visual findings require an authorized vision tool actually inspecting pixels; analyze_fabric_photo and analyze_ornament_photo inspect only current-message attachments. Never reanalyze or modify records merely to review them.";

const fabricColumns = {
  id: fabrics.id,
  name: fabrics.name,
  lineName: fabrics.lineName,
  designer: fabrics.designer,
  manufacturer: fabrics.manufacturer,
  colorway: fabrics.colorway,
  printType: fabrics.printType,
  fiberContent: fabrics.fiberContent,
  widthInches: fabrics.widthInches,
  quantity: fabrics.quantity,
  quantityUnit: fabrics.quantityUnit,
  sku: fabrics.sku,
  notes: fabrics.notes,
  aiDescription: fabrics.aiDescription,
  dominantColors: fabrics.dominantColors,
  motifs: fabrics.motifs,
  styleDescriptors: fabrics.styleDescriptors,
};

const ornamentColumns = {
  id: ornamentsItems.id,
  name: ornamentsItems.name,
  brand: ornamentsItems.brand,
  seriesOrCollection: ornamentsItems.seriesOrCollection,
  year: ornamentsItems.year,
  quantity: ornamentsItems.quantity,
  notes: ornamentsItems.notes,
  dimensions: ornamentsItems.dimensions,
  origin: ornamentsItems.origin,
  description: ornamentsItems.description,
  descriptionGenerated: ornamentsItems.descriptionGenerated,
  aiDescription: ornamentsItems.aiDescription,
  dominantColors: ornamentsItems.dominantColors,
  motifs: ornamentsItems.motifs,
};

const missingFabricDescription = (row: CollectionReviewRow) =>
  !row.aiDescription;
const missingOrnamentDescription = (row: CollectionReviewRow) =>
  !row.description && !row.aiDescription;

const fabricReader = createCollectionReviewReader({
  domain: "fabrics",
  name: BROWSE_FABRIC_COLLECTION_TOOL_NAME,
  table: fabrics,
  id: fabrics.id,
  deletedAt: fabrics.deletedAt,
  columns: fabricColumns,
  // Match GET /quilting/fabrics; do not broaden its existing limits.
  pageSizeDefault: listFabricsQueryPageSizeDefault,
  pageSizeMax: listFabricsQueryPageSizeMax,
  evidencePolicy: HOUSEHOLD_CATALOG_EVIDENCE_POLICY,
  idKey: "fabricId",
  missingDescription: missingFabricDescription,
});
const ornamentReader = createCollectionReviewReader({
  domain: "ornaments",
  name: BROWSE_ORNAMENT_COLLECTION_TOOL_NAME,
  table: ornamentsItems,
  id: ornamentsItems.id,
  deletedAt: ornamentsItems.deletedAt,
  columns: ornamentColumns,
  pageSizeDefault: listOrnamentsQueryPageSizeDefault,
  pageSizeMax: listOrnamentsQueryPageSizeMax,
  evidencePolicy: HOUSEHOLD_CATALOG_EVIDENCE_POLICY,
  idKey: "itemId",
  missingDescription: missingOrnamentDescription,
});

export const BrowseFabricPayload = fabricReader.payload;
export const BrowseOrnamentPayload = ornamentReader.payload;
export const browseFabricCollection = fabricReader.browse;
export const browseOrnamentCollection = ornamentReader.browse;
export const householdCollectionReadTools = [
  ...fabricReader.tools,
  ...ornamentReader.tools,
];
