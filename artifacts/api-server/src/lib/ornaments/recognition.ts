import { asc, and, eq, isNull } from "drizzle-orm";
import {
  db,
  ornamentsImages,
  ornamentsItems,
  type OrnamentItemRow,
} from "@workspace/db";
import {
  analyzeOrnamentImage,
  buildEmbeddingText,
  embedText,
  enrichOrnamentIdentity,
  type OrnamentAnalysis,
  type OrnamentIdentityEnrichment,
} from "./openai";
import { lookupBarcode, type BarcodeLookupResult } from "./barcode";
import {
  hasResearchableOrnamentIdentity,
  researchOrnament,
  type OrnamentResearchResult,
} from "./research";
import { downloadImageBuffer } from "./storage";
import { toDataUrl } from "./image";
import { sniffImageType } from "@workspace/upload-validation";
import { generateVisualEmbedding } from "../visual-embed";
import { getModels } from "../ai-client";
import {
  runAnalysisWithEvidenceTrace,
  type FieldCandidateInput,
} from "../ai-provenance";
import {
  createScanFingerprint,
  runAiScanPipeline,
  type ScanStageOutcome,
} from "../ai-scan-pipeline";
import {
  buildMissingOrnamentIdentityUpdate,
  mergeOrnamentIdentity,
} from "./identity";
import {
  getMissingOrnamentMaintenanceFields,
  getOrnamentMaintenanceRecommendation,
  type OrnamentMaintenanceReason,
} from "./maintenance";
import { applyExistingOrnamentCategories } from "./category-assignment";
import { logger } from "../logger";
import { getTableColumns } from "drizzle-orm";

export const ORNAMENT_RECOGNITION_PROMPT_VERSION = "ornament-recognition-v2";

export interface OrnamentRecognitionPhoto {
  order: number;
  sourceId?: string | number | null;
  dataUrl: string;
}

export interface OrnamentRecognitionExistingFacts {
  name: string | null;
  brand: string | null;
  seriesOrCollection: string | null;
  year: number | null;
  barcodeValue: string | null;
  dimensions: string | null;
  description: string | null;
  descriptionGenerated: boolean;
  aiDescription: string | null;
  dominantColors: string[];
  motifs: string[];
  notes: string | null;
}

export interface OrnamentRecognitionOptions {
  itemId?: number;
  userId?: number;
  feature?: string;
  identityOnly?: boolean;
  force?: boolean;
}

export interface OrnamentRecognitionResult {
  analysis: OrnamentAnalysis;
  identity: OrnamentRecognitionExistingFacts;
  barcodeLookup: BarcodeLookupResult | null;
  research: OrnamentResearchResult | null;
  embedding: number[];
  visualEmbedding: number[] | null;
  stages: ScanStageOutcome[];
  unresolvedFields: OrnamentMaintenanceReason[];
  recommendation: string | null;
  generationRunId: number;
  fingerprint: string;
  stale: boolean;
}

type RecognitionItem = Omit<
  OrnamentItemRow,
  "embedding" | "visualEmbedding"
> & {
  embedding: number[] | null;
  visualEmbedding: number[] | null;
};

const {
  embedding: _embedding,
  visualEmbedding: _visualEmbedding,
  ...recognitionItemColumns
} = getTableColumns(ornamentsItems);

function factsFromItem(
  item: RecognitionItem,
): OrnamentRecognitionExistingFacts {
  return {
    name: item.name,
    brand: item.brand,
    seriesOrCollection: item.seriesOrCollection,
    year: item.year,
    barcodeValue: item.barcodeValue,
    dimensions: item.dimensions,
    description: item.description,
    descriptionGenerated: item.descriptionGenerated ?? false,
    aiDescription: item.aiDescription,
    dominantColors: item.dominantColors ?? [],
    motifs: item.motifs ?? [],
    notes: item.notes,
  };
}

function averageVectors(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dimensions = vectors[0].length;
  if (!dimensions || vectors.some((vector) => vector.length !== dimensions)) {
    return null;
  }
  const average = Array.from({ length: dimensions }, () => 0);
  for (const vector of vectors) {
    for (let index = 0; index < dimensions; index += 1) {
      average[index] += vector[index] / vectors.length;
    }
  }
  return average;
}

async function generateMultiPhotoVisualEmbedding(
  photos: readonly OrnamentRecognitionPhoto[],
): Promise<{ value: number[] | null; failed: boolean }> {
  const results = await Promise.allSettled(
    photos.map((photo) => generateVisualEmbedding(photo.dataUrl)),
  );
  const vectors = results.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  return {
    value: averageVectors(vectors),
    failed: results.some((result) => result.status === "rejected"),
  };
}

function candidateFromResearch(
  research: OrnamentResearchResult | null,
): FieldCandidateInput[] {
  if (!research) return [];
  return [
    {
      fieldPath: "research",
      value: research.answer,
      confidenceScore: 0.75,
      confidenceMethod: "multi_source_agreement",
      authorityClass: "official_api",
      sourceReferences: research.citations.map((url) => ({
        url,
        domain: research.citationDomains.has(url) ? url : undefined,
      })),
    },
  ];
}

async function executeRecognition(
  photos: readonly OrnamentRecognitionPhoto[],
  existing: OrnamentRecognitionExistingFacts,
  lockedFields: readonly string[],
  options: OrnamentRecognitionOptions,
): Promise<Omit<OrnamentRecognitionResult, "fingerprint" | "stale">> {
  const stages: ScanStageOutcome[] = [];
  const locked = new Set(lockedFields);
  const models = await getModels();

  const analysisWithRun = await runAnalysisWithEvidenceTrace(
    {
      module: "ornaments",
      feature: options.feature ?? "recognition",
      targetType: "ornament_item",
      targetId: options.itemId,
      userId: options.userId,
      model: models.fastVision,
      promptTemplateId: ORNAMENT_RECOGNITION_PROMPT_VERSION,
      inputArtifactHashes: photos.map((photo) => photo.dataUrl),
    },
    () =>
      analyzeOrnamentImage(
        photos.map((photo) => photo.dataUrl),
        {
          resolveDimensions: !locked.has("dimensions"),
          existingContext: {
            name: existing.name,
            brand: existing.brand,
            seriesOrCollection: existing.seriesOrCollection,
            year: existing.year,
            barcodeValue: existing.barcodeValue,
            lockedFields,
          },
        },
      ),
  );
  const analysis = analysisWithRun.result;
  stages.push({
    stage: "vision",
    status: "completed",
    detail: `${photos.length} ordered photo${photos.length === 1 ? "" : "s"} processed`,
  });

  let barcodeLookup: BarcodeLookupResult | null = null;
  const barcodeValue = existing.barcodeValue ?? analysis.upc;
  if (barcodeValue) {
    try {
      const lookup = await lookupBarcode(barcodeValue);
      barcodeLookup = lookup.found ? lookup : null;
      stages.push({
        stage: "barcode",
        status: lookup.found ? "completed" : "skipped",
        detail: lookup.found
          ? "Exact barcode/catalog evidence found"
          : "Barcode was not found in the catalog",
      });
    } catch (error) {
      stages.push({
        stage: "barcode",
        status: "failed",
        detail:
          error instanceof Error ? error.message : "Barcode lookup failed",
      });
      logger.warn(
        { error, itemId: options.itemId },
        "ornament barcode stage failed",
      );
    }
  } else {
    stages.push({
      stage: "barcode",
      status: "skipped",
      detail: "No barcode was available",
    });
  }

  const analysisIdentity = mergeOrnamentIdentity(
    existing,
    {
      name: analysis.name,
      seriesOrCollection: analysis.seriesOrCollection,
      year: analysis.year,
      barcodeValue: analysis.upc,
    },
    lockedFields,
  );
  const identityNeedsWork =
    (!locked.has("seriesOrCollection") &&
      !analysisIdentity.seriesOrCollection) ||
    (!locked.has("year") && analysisIdentity.year == null);

  let visualIdentity: OrnamentIdentityEnrichment | null = null;
  if (identityNeedsWork) {
    try {
      visualIdentity = await enrichOrnamentIdentity(
        photos.map((photo) => photo.dataUrl),
        {
          name: analysisIdentity.name,
          barcodeValue: analysisIdentity.barcodeValue,
          seriesOrCollection: analysisIdentity.seriesOrCollection,
          year: analysisIdentity.year,
        },
      );
      stages.push({ stage: "identity", status: "completed" });
    } catch (error) {
      stages.push({
        stage: "identity",
        status: "failed",
        detail:
          error instanceof Error ? error.message : "Identity stage failed",
      });
      logger.warn(
        { error, itemId: options.itemId },
        "ornament identity stage failed",
      );
    }
  } else {
    stages.push({
      stage: "identity",
      status: "skipped",
      detail: "Identity fields are already known or locked",
    });
  }

  const resolvedIdentity = mergeOrnamentIdentity(
    existing,
    {
      name: barcodeLookup?.name ?? analysisIdentity.name,
      seriesOrCollection:
        barcodeLookup?.seriesOrCollection ??
        visualIdentity?.seriesOrCollection ??
        analysisIdentity.seriesOrCollection,
      year:
        barcodeLookup?.year ?? visualIdentity?.year ?? analysisIdentity.year,
      barcodeValue: existing.barcodeValue ?? analysis.upc,
    },
    lockedFields,
  );
  const identity: OrnamentRecognitionExistingFacts = {
    ...existing,
    ...resolvedIdentity,
    // Exact barcode/catalog evidence is stronger than an earlier unlocked
    // visual inference. A lock is the explicit promise that a saved value
    // must never change.
    name: lockedFields.includes("name")
      ? existing.name
      : (barcodeLookup?.name ?? resolvedIdentity.name),
    seriesOrCollection: lockedFields.includes("seriesOrCollection")
      ? existing.seriesOrCollection
      : (barcodeLookup?.seriesOrCollection ??
        resolvedIdentity.seriesOrCollection),
    year: lockedFields.includes("year")
      ? existing.year
      : (barcodeLookup?.year ?? resolvedIdentity.year),
  };

  let research: OrnamentResearchResult | null = null;
  if (
    identityNeedsWork &&
    hasResearchableOrnamentIdentity({
      name: identity.name ?? "",
      seriesOrCollection: identity.seriesOrCollection,
      year: identity.year,
    })
  ) {
    research = await researchOrnament(
      {
        name: identity.name ?? "",
        seriesOrCollection: identity.seriesOrCollection,
        year: identity.year,
      },
      "verify the ornament's series, release year, and identifying catalog details",
    );
    stages.push({
      stage: "research",
      status: research ? "completed" : "skipped",
      detail: research
        ? `Grounded research returned ${research.citations.length} citation(s)`
        : "No citable research result was available",
    });
  } else {
    stages.push({
      stage: "research",
      status: "skipped",
      detail: "Not enough safe identity evidence for a web query",
    });
  }

  // Record cited research without allowing prose from a web answer to become
  // an unverified field value.
  const researchCandidates = candidateFromResearch(research);
  if (researchCandidates.length > 0 && analysisWithRun.runId >= 0) {
    // The vision run already owns the primary candidates. The research result
    // is exposed in its provenance via a separate lightweight candidate call
    // only when the provenance tables are available.
    const { recordFieldCandidates } = await import("../ai-provenance");
    await recordFieldCandidates(
      analysisWithRun.runId,
      "ornament_item",
      options.itemId,
      researchCandidates,
    );
  }

  const embedding = await embedText(
    buildEmbeddingText({
      ...analysis,
      name: identity.name ?? analysis.name,
      seriesOrCollection: identity.seriesOrCollection,
      year: identity.year,
      upc: identity.barcodeValue,
    }),
  );
  stages.push({
    stage: "text_embedding",
    status: embedding.length > 0 ? "completed" : "failed",
    detail:
      embedding.length > 0
        ? undefined
        : "Text embedding provider returned no vector",
  });

  const visual = await generateMultiPhotoVisualEmbedding(photos);
  stages.push({
    stage: "visual_embedding",
    status: visual.value ? "completed" : visual.failed ? "failed" : "skipped",
    detail: visual.value
      ? `Averaged ${photos.length} photo vector${photos.length === 1 ? "" : "s"}`
      : "Visual embedding provider was unavailable",
  });

  const unresolvedFields = getMissingOrnamentMaintenanceFields({
    embedding,
    seriesOrCollection: identity.seriesOrCollection,
    year: identity.year,
  });

  return {
    analysis,
    identity,
    barcodeLookup,
    research,
    embedding,
    visualEmbedding: visual.value,
    stages,
    unresolvedFields,
    recommendation:
      unresolvedFields.length > 0
        ? getOrnamentMaintenanceRecommendation(unresolvedFields)
        : null,
    generationRunId: analysisWithRun.runId,
  };
}

export async function recognizeOrnamentPhotos(
  photos: readonly OrnamentRecognitionPhoto[],
  existing: OrnamentRecognitionExistingFacts,
  lockedFields: readonly string[] = [],
  options: OrnamentRecognitionOptions = {},
): Promise<OrnamentRecognitionResult> {
  const models = await getModels();
  const fingerprint = createScanFingerprint({
    photos: photos.map((photo) => ({
      order: photo.order,
      sourceId: photo.sourceId,
      content: photo.dataUrl,
    })),
    facts: existing,
    lockedFields,
    model: models.fastVision,
    promptVersion: ORNAMENT_RECOGNITION_PROMPT_VERSION,
  });
  const result = await runAiScanPipeline(fingerprint, () =>
    executeRecognition(photos, existing, lockedFields, options),
  );
  return {
    ...result.result,
    fingerprint,
    stale: false,
  };
}

async function loadRecognitionItem(itemId: number): Promise<RecognitionItem> {
  const [item] = await db
    .select({
      ...recognitionItemColumns,
      embedding: ornamentsItems.embedding,
      visualEmbedding: ornamentsItems.visualEmbedding,
    })
    .from(ornamentsItems)
    .where(and(eq(ornamentsItems.id, itemId), isNull(ornamentsItems.deletedAt)))
    .limit(1);
  if (!item) {
    throw Object.assign(new Error("Ornament not found."), { status: 404 });
  }
  return item as RecognitionItem;
}

export async function loadOrnamentRecognitionPhotos(itemId: number): Promise<{
  item: RecognitionItem;
  photos: OrnamentRecognitionPhoto[];
  fingerprint: string;
}> {
  const item = await loadRecognitionItem(itemId);
  const supplemental = await db
    .select({
      id: ornamentsImages.id,
      storagePath: ornamentsImages.storagePath,
      position: ornamentsImages.position,
    })
    .from(ornamentsImages)
    .where(
      and(
        eq(ornamentsImages.itemId, itemId),
        isNull(ornamentsImages.deletedAt),
      ),
    )
    .orderBy(asc(ornamentsImages.position), asc(ornamentsImages.id));

  const orderedPaths = [
    { sourceId: `primary:${itemId}`, storagePath: item.imagePath, order: 0 },
    ...supplemental.map((photo, index) => ({
      sourceId: photo.id,
      storagePath: photo.storagePath,
      order: index + 1,
    })),
  ];
  const downloaded = await Promise.all(
    orderedPaths.map(async (photo) => {
      const result = await downloadImageBuffer(photo.storagePath);
      return {
        order: photo.order,
        sourceId: photo.sourceId,
        dataUrl: toDataUrl(
          result.buffer,
          sniffImageType(result.buffer) ?? "image/jpeg",
        ),
      };
    }),
  );
  const models = await getModels();
  const fingerprint = createScanFingerprint({
    photos: downloaded.map((photo) => ({
      order: photo.order,
      sourceId: photo.sourceId,
      content: photo.dataUrl,
    })),
    facts: factsFromItem(item),
    lockedFields: item.lockedFields ?? [],
    model: models.fastVision,
    promptVersion: ORNAMENT_RECOGNITION_PROMPT_VERSION,
  });
  return { item, photos: downloaded, fingerprint };
}

async function currentFingerprint(itemId: number): Promise<string> {
  const loaded = await loadOrnamentRecognitionPhotos(itemId);
  return loaded.fingerprint;
}

/**
 * Run the one Ornament recognition lifecycle against the complete ordered
 * photo set. Applying is guarded by the fingerprint captured before provider
 * calls, so a manual edit or newer photo set wins over an older result.
 */
export async function runOrnamentRecognition(
  itemId: number,
  options: OrnamentRecognitionOptions = {},
): Promise<{
  item: unknown;
  maintenance: {
    unresolvedFields: OrnamentMaintenanceReason[];
    recommendation: string | null;
  };
  stages: ScanStageOutcome[];
  deduped: boolean;
  stale: boolean;
}> {
  const loaded = await loadOrnamentRecognitionPhotos(itemId);
  const result = await runAiScanPipeline(loaded.fingerprint, () =>
    executeRecognition(
      loaded.photos,
      factsFromItem(loaded.item),
      loaded.item.lockedFields ?? [],
      { ...options, itemId, userId: loaded.item.userId ?? undefined },
    ),
  );
  const recognized = result.result;

  if ((await currentFingerprint(itemId)) !== loaded.fingerprint) {
    return {
      item: loaded.item,
      maintenance: {
        unresolvedFields: getMissingOrnamentMaintenanceFields(loaded.item),
        recommendation: null,
      },
      stages: [
        ...recognized.stages,
        {
          stage: "apply",
          status: "stale",
          detail:
            "A newer photo set or manual edit won; no AI result was applied",
        },
      ],
      deduped: result.deduped,
      stale: true,
    };
  }

  const locked = new Set(loaded.item.lockedFields ?? []);
  const merged = {
    name: recognized.identity.name ?? loaded.item.name,
    seriesOrCollection: recognized.identity.seriesOrCollection,
    year: recognized.identity.year,
    dimensions: locked.has("dimensions")
      ? loaded.item.dimensions
      : (recognized.analysis.dimensions ?? loaded.item.dimensions),
    dominantColors: locked.has("dominantColors")
      ? loaded.item.dominantColors
      : recognized.analysis.dominantColors.length
        ? recognized.analysis.dominantColors
        : loaded.item.dominantColors,
    motifs: locked.has("motifs")
      ? loaded.item.motifs
      : recognized.analysis.motifs.length
        ? recognized.analysis.motifs
        : loaded.item.motifs,
    aiDescription: locked.has("aiDescription")
      ? loaded.item.aiDescription
      : (recognized.analysis.aiDescription ?? loaded.item.aiDescription),
    description: locked.has("description")
      ? loaded.item.description
      : (recognized.analysis.boxDescription ?? loaded.item.description),
    descriptionGenerated: locked.has("description")
      ? loaded.item.descriptionGenerated
      : recognized.analysis.boxDescription != null
        ? recognized.analysis.boxDescriptionGenerated
        : loaded.item.descriptionGenerated,
    barcodeValue: locked.has("barcodeValue")
      ? loaded.item.barcodeValue
      : recognized.identity.barcodeValue,
    embedding:
      recognized.embedding.length > 0
        ? recognized.embedding
        : loaded.item.embedding,
    visualEmbedding: recognized.visualEmbedding ?? loaded.item.visualEmbedding,
  };

  const safeIdentity = options.identityOnly
    ? buildMissingOrnamentIdentityUpdate(
        getMissingOrnamentMaintenanceFields(loaded.item),
        loaded.item.lockedFields ?? [],
        recognized.identity,
        recognized.embedding,
      )
    : merged;
  const updateValues = {
    ...safeIdentity,
    ...(options.identityOnly
      ? {
          visualEmbedding:
            recognized.visualEmbedding ?? loaded.item.visualEmbedding,
        }
      : {}),
  };
  const [updated] = await db
    .update(ornamentsItems)
    .set(updateValues)
    .where(and(eq(ornamentsItems.id, itemId), isNull(ornamentsItems.deletedAt)))
    .returning({
      ...recognitionItemColumns,
      embedding: ornamentsItems.embedding,
      visualEmbedding: ornamentsItems.visualEmbedding,
    });
  if (!updated) {
    throw Object.assign(new Error("Ornament not found."), { status: 404 });
  }
  const categoryAssignment = await applyExistingOrnamentCategories([itemId]);
  if (categoryAssignment.failed > 0) {
    logger.warn(
      { itemId, failed: categoryAssignment.failed },
      "ornament category assignment partially failed after recognition",
    );
  }

  return {
    item: updated,
    maintenance: {
      unresolvedFields: getMissingOrnamentMaintenanceFields(updated),
      recommendation:
        getMissingOrnamentMaintenanceFields(updated).length > 0
          ? getOrnamentMaintenanceRecommendation(
              getMissingOrnamentMaintenanceFields(updated),
            )
          : null,
    },
    stages: [
      ...recognized.stages,
      {
        stage: "apply",
        status: categoryAssignment.failed > 0 ? "failed" : "completed",
        detail:
          categoryAssignment.failed > 0
            ? `${categoryAssignment.failed} category assignment failed`
            : categoryAssignment.assignmentsCreated > 0
              ? `${categoryAssignment.assignmentsCreated} existing category assignment${categoryAssignment.assignmentsCreated === 1 ? "" : "s"} added`
              : "No new matching categories",
      },
    ],
    deduped: result.deduped,
    stale: false,
  };
}

const scheduledScans = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Debounce photo-intake triggers so a burst of camera uploads scans one
 * complete photo set instead of paying once per uploaded image.
 */
export function scheduleOrnamentRecognition(
  itemId: number,
  options: OrnamentRecognitionOptions = {},
): void {
  const previous = scheduledScans.get(itemId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    scheduledScans.delete(itemId);
    void runOrnamentRecognition(itemId, {
      ...options,
      feature: options.feature ?? "automatic-photo-intake",
    }).catch((error) => {
      logger.warn({ error, itemId }, "ornament automatic recognition failed");
    });
  }, 350);
  scheduledScans.set(itemId, timer);
}
