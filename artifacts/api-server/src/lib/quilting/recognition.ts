import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  fabrics,
  finishedQuilts,
  quiltingImages,
  quiltPatterns,
  type FabricRow,
  type FinishedQuiltRow,
  type QuiltPatternRow,
} from "@workspace/db";
import {
  analyzeImage,
  analyzePatternImage,
  analyzeQuiltImage,
  buildEmbeddingText,
  embedText,
  type AnalysisContext,
} from "../openai";
import { downloadImageAsDataUrl } from "../storage";
import { generateVisualEmbedding } from "../visual-embed";
import { getModels } from "../ai-client";
import { runAnalysisWithEvidence } from "../ai-provenance";
import {
  createScanFingerprint,
  type CompletePhotoScanSnapshot,
  generateMultiPhotoVisualEmbedding,
  runCompletePhotoScan,
  scheduleCompletePhotoScan,
} from "../ai-scan-pipeline";
import { logger } from "../logger";

type QuiltingEntityType = "fabric" | "pattern" | "quilt";
type PatternOrQuiltTable = typeof quiltPatterns | typeof finishedQuilts;

type RecognitionSnapshot<T> = {
  row: T;
  dataUrls: string[];
  model: string;
};

type RecognitionEntityConfig<
  T extends {
    id: number;
    imagePath: string | null;
    lockedFields: string[] | null;
  },
> = {
  entityType: QuiltingEntityType;
  table: PatternOrQuiltTable;
  missingMessage: string;
  facts: (row: T) => object;
  promptVersion: string;
};

type LockedAnalysisField<Analysis> = readonly [string, keyof Analysis];

async function loadEvidence<
  T extends {
    id: number;
    imagePath: string | null;
    lockedFields: string[] | null;
  },
>(
  entityType: QuiltingEntityType,
  row: T,
  facts: object,
  promptVersion: string,
): Promise<{ fingerprint: string; value: RecognitionSnapshot<T> }> {
  const supplemental = await db
    .select({
      id: quiltingImages.id,
      storagePath: quiltingImages.storagePath,
      position: quiltingImages.position,
    })
    .from(quiltingImages)
    .where(
      and(
        eq(quiltingImages.entityType, entityType),
        eq(quiltingImages.entityId, row.id),
        isNull(quiltingImages.deletedAt),
      ),
    )
    .orderBy(asc(quiltingImages.position), asc(quiltingImages.id));
  const ordered = [
    ...(row.imagePath
      ? [
          {
            order: 0,
            sourceId: `primary:${row.id}`,
            storagePath: row.imagePath,
          },
        ]
      : []),
    ...supplemental.map((photo, index) => ({
      order: index + (row.imagePath ? 1 : 0),
      sourceId: photo.id,
      storagePath: photo.storagePath,
    })),
  ];
  if (ordered.length === 0) {
    throw Object.assign(
      new Error(`This ${entityType} has no image to analyse.`),
      {
        status: 422,
      },
    );
  }
  const photos = await Promise.all(
    ordered.map(async (photo) => ({
      ...photo,
      dataUrl: await downloadImageAsDataUrl(photo.storagePath),
    })),
  );
  const model = (await getModels()).fastVision;
  return {
    fingerprint: createScanFingerprint({
      photos: photos.map((photo) => ({
        order: photo.order,
        sourceId: photo.sourceId,
        content: photo.dataUrl,
      })),
      facts,
      lockedFields: row.lockedFields ?? [],
      model,
      promptVersion,
    }),
    value: { row, dataUrls: photos.map((photo) => photo.dataUrl), model },
  };
}

async function loadRecognitionSnapshot<
  T extends {
    id: number;
    imagePath: string | null;
    lockedFields: string[] | null;
  },
>(
  id: number,
  config: RecognitionEntityConfig<T>,
): Promise<CompletePhotoScanSnapshot<RecognitionSnapshot<T>>> {
  const row = await findActiveRecognitionRow<T>(config.table, id);
  if (!row)
    throw Object.assign(new Error(config.missingMessage), { status: 404 });
  return loadEvidence(
    config.entityType,
    row,
    config.facts(row),
    config.promptVersion,
  );
}

async function findActiveRecognitionRow<T>(
  table: PatternOrQuiltTable,
  id: number,
): Promise<T | undefined> {
  const [row] = await db
    .select()
    .from(table)
    .where(and(eq(table.id, id), isNull(table.deletedAt)))
    .limit(1);
  return row as T | undefined;
}

function unlockedAnalysisFields<Analysis>(
  lockedFields: string[] | null,
  analysis: Analysis,
  fields: readonly LockedAnalysisField<Analysis>[],
): Record<string, unknown> {
  const locked = new Set(lockedFields ?? []);
  return Object.fromEntries(
    fields
      .filter(([field]) => !locked.has(field))
      .map(([field, analysisField]) => [field, analysis[analysisField]]),
  );
}

async function persistRecognitionAnalysis<T, Analysis>(
  table: PatternOrQuiltTable,
  id: number,
  row: { lockedFields: string[] | null },
  analysis: Analysis,
  fields: readonly LockedAnalysisField<Analysis>[],
): Promise<T | undefined> {
  const [updated] = await db
    .update(table)
    .set(unlockedAnalysisFields(row.lockedFields, analysis, fields))
    .where(and(eq(table.id, id), isNull(table.deletedAt)))
    .returning();
  return updated as T | undefined;
}

async function runPatternOrQuiltRecognition<
  T extends {
    id: number;
    imagePath: string | null;
    lockedFields: string[] | null;
  },
  Analysis,
>(options: {
  id: number;
  loadSnapshot: () => Promise<
    CompletePhotoScanSnapshot<RecognitionSnapshot<T>>
  >;
  config: Pick<RecognitionEntityConfig<T>, "table" | "missingMessage">;
  missingMessage: string;
  execute: (snapshot: RecognitionSnapshot<T>) => Promise<Analysis>;
  fields: readonly LockedAnalysisField<Analysis>[];
}): Promise<T> {
  const scan = await runCompletePhotoScan({
    loadSnapshot: options.loadSnapshot,
    execute: options.execute,
  });
  if (scan.stale) {
    const current = await findActiveRecognitionRow<T>(
      options.config.table,
      options.id,
    );
    if (!current)
      throw Object.assign(new Error(options.missingMessage), { status: 404 });
    return current;
  }

  const updated = await persistRecognitionAnalysis<T, Analysis>(
    options.config.table,
    options.id,
    scan.snapshot.row,
    scan.result,
    options.fields,
  );
  if (!updated)
    throw Object.assign(new Error(options.missingMessage), { status: 404 });
  return updated;
}

async function loadFabricSnapshot(
  id: number,
): Promise<CompletePhotoScanSnapshot<RecognitionSnapshot<FabricRow>>> {
  const [row] = await db
    .select()
    .from(fabrics)
    .where(and(eq(fabrics.id, id), isNull(fabrics.deletedAt)))
    .limit(1);
  if (!row)
    throw Object.assign(new Error("Fabric not found."), { status: 404 });
  const context: AnalysisContext = {
    lockedFields: row.lockedFields ?? [],
    name: row.name,
    lineName: row.lineName,
    designer: row.designer,
    manufacturer: row.manufacturer,
    colorway: row.colorway,
    printType: row.printType,
    fiberContent: row.fiberContent,
    dominantColors: row.dominantColors,
    motifs: row.motifs,
    styleDescriptors: row.styleDescriptors,
  };
  return loadEvidence("fabric", row, context, "quilting-fabric-recognition-v2");
}

export async function runFabricRecognition(
  id: number,
  feature = "reanalyze-fabric",
) {
  const scan = await runCompletePhotoScan({
    loadSnapshot: (): Promise<
      CompletePhotoScanSnapshot<RecognitionSnapshot<FabricRow>>
    > => loadFabricSnapshot(id),
    execute: async (snapshot) => {
      const lockedFields = snapshot.row.lockedFields ?? [];
      const context: AnalysisContext = {
        lockedFields,
        name: snapshot.row.name,
        lineName: snapshot.row.lineName,
        designer: snapshot.row.designer,
        manufacturer: snapshot.row.manufacturer,
        colorway: snapshot.row.colorway,
        printType: snapshot.row.printType,
        fiberContent: snapshot.row.fiberContent,
        dominantColors: snapshot.row.dominantColors,
        motifs: snapshot.row.motifs,
        styleDescriptors: snapshot.row.styleDescriptors,
      };
      const [analysis, visual] = await Promise.all([
        runAnalysisWithEvidence(
          {
            module: "quilting",
            feature,
            targetType: "quilting_fabric",
            targetId: id,
            userId: snapshot.row.userId ?? undefined,
            model: snapshot.model,
          },
          () => analyzeImage(snapshot.dataUrls, context),
        ),
        generateMultiPhotoVisualEmbedding(
          snapshot.dataUrls,
          generateVisualEmbedding,
        ),
      ]);
      return {
        analysis,
        embedding: await embedText(buildEmbeddingText(analysis)),
        visual,
      };
    },
  });
  if (scan.stale) {
    const [current] = await db
      .select()
      .from(fabrics)
      .where(and(eq(fabrics.id, id), isNull(fabrics.deletedAt)))
      .limit(1);
    if (!current)
      throw Object.assign(new Error("Fabric not found."), { status: 404 });
    return current;
  }

  const { row } = scan.snapshot;
  const { analysis, embedding, visual } = scan.result;
  const locked = new Set(row.lockedFields ?? []);
  const [updated] = await db
    .update(fabrics)
    .set({
      ...(locked.has("name") ? {} : { name: analysis.name }),
      ...(locked.has("lineName") ? {} : { lineName: analysis.lineName }),
      ...(locked.has("designer") ? {} : { designer: analysis.designer }),
      ...(locked.has("manufacturer")
        ? {}
        : { manufacturer: analysis.manufacturer }),
      ...(locked.has("colorway") ? {} : { colorway: analysis.colorway }),
      ...(locked.has("printType") ? {} : { printType: analysis.printType }),
      ...(locked.has("fiberContent")
        ? {}
        : { fiberContent: analysis.fiberContent }),
      ...(locked.has("aiDescription")
        ? {}
        : { aiDescription: analysis.aiDescription }),
      ...(locked.has("dominantColors")
        ? {}
        : { dominantColors: analysis.dominantColors }),
      ...(locked.has("motifs") ? {} : { motifs: analysis.motifs }),
      ...(locked.has("styleDescriptors")
        ? {}
        : { styleDescriptors: analysis.styleDescriptors }),
      embedding: sql`${`[${embedding.join(",")}]`}::vector`,
      ...(visual.value
        ? { visualEmbedding: sql`${`[${visual.value.join(",")}]`}::vector` }
        : {}),
    })
    .where(and(eq(fabrics.id, id), isNull(fabrics.deletedAt)))
    .returning();
  if (!updated)
    throw Object.assign(new Error("Fabric not found."), { status: 404 });
  return updated;
}

const patternRecognitionConfig: RecognitionEntityConfig<QuiltPatternRow> = {
  entityType: "pattern",
  table: quiltPatterns,
  missingMessage: "Pattern not found.",
  facts: (row) => ({
    name: row.name,
    designer: row.designer,
    blockSize: row.blockSize,
    difficulty: row.difficulty,
  }),
  promptVersion: "quilting-pattern-recognition-v2",
};

async function loadPatternSnapshot(
  id: number,
): Promise<CompletePhotoScanSnapshot<RecognitionSnapshot<QuiltPatternRow>>> {
  return loadRecognitionSnapshot(id, patternRecognitionConfig);
}

export async function runPatternRecognition(id: number) {
  return runPatternOrQuiltRecognition({
    id,
    loadSnapshot: () => loadPatternSnapshot(id),
    config: patternRecognitionConfig,
    missingMessage: "Pattern not found.",
    execute: (snapshot) =>
      analyzePatternImage(snapshot.dataUrls, snapshot.row.lockedFields ?? [], {
        name: snapshot.row.name,
        designer: snapshot.row.designer,
        blockSize: snapshot.row.blockSize,
        difficulty: snapshot.row.difficulty,
      }),
    fields: [
      ["name", "name"],
      ["designer", "designer"],
      ["blockSize", "blockSize"],
      ["difficulty", "difficulty"],
      ["notes", "notes"],
      ["dominantColors", "dominantColors"],
    ],
  });
}

const quiltRecognitionConfig: RecognitionEntityConfig<FinishedQuiltRow> = {
  entityType: "quilt",
  table: finishedQuilts,
  missingMessage: "Quilt not found.",
  facts: (row) => ({
    name: row.name,
    notes: row.notes,
    dominantColors: row.dominantColors,
  }),
  promptVersion: "quilting-finished-quilt-recognition-v2",
};

async function loadQuiltSnapshot(
  id: number,
): Promise<CompletePhotoScanSnapshot<RecognitionSnapshot<FinishedQuiltRow>>> {
  return loadRecognitionSnapshot(id, quiltRecognitionConfig);
}

export async function runQuiltRecognition(id: number) {
  return runPatternOrQuiltRecognition({
    id,
    loadSnapshot: () => loadQuiltSnapshot(id),
    config: quiltRecognitionConfig,
    missingMessage: "Quilt not found.",
    execute: (snapshot) =>
      analyzeQuiltImage(snapshot.dataUrls, snapshot.row.lockedFields ?? [], {
        name: snapshot.row.name,
      }),
    fields: [
      ["name", "name"],
      ["notes", "notes"],
      ["dominantColors", "dominantColors"],
    ],
  });
}

export function scheduleQuiltingRecognition(
  entityType: QuiltingEntityType,
  id: number,
): void {
  const run =
    entityType === "fabric"
      ? () => runFabricRecognition(id, "automatic-photo-intake")
      : entityType === "pattern"
        ? () => runPatternRecognition(id)
        : () => runQuiltRecognition(id);
  scheduleCompletePhotoScan(`quilting:${entityType}:${id}`, run, (error) =>
    logger.warn(
      { error, entityType, entityId: id },
      "quilting automatic recognition failed",
    ),
  );
}
