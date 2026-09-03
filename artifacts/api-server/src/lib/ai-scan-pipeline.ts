import { createHash } from "node:crypto";

export type ScanStageName =
  | "vision"
  | "barcode"
  | "identity"
  | "research"
  | "text_embedding"
  | "visual_embedding"
  | "apply";

export interface ScanStageOutcome {
  stage: ScanStageName;
  status: "completed" | "skipped" | "failed" | "stale";
  detail?: string;
}

export interface ScanFingerprintInput {
  photos: ReadonlyArray<{
    order: number;
    sourceId?: string | number | null;
    content: string;
  }>;
  facts: object;
  lockedFields: readonly string[];
  model: string;
  promptVersion: string;
}

export interface ScanRunResult<T> {
  result: T;
  fingerprint: string;
  deduped: boolean;
}

export interface CompletePhotoScanSnapshot<T> {
  fingerprint: string;
  value: T;
}

export interface CompletePhotoScanResult<TSnapshot, TResult> {
  snapshot: TSnapshot;
  result: TResult;
  fingerprint: string;
  deduped: boolean;
  stale: boolean;
}

export type CompletePhotoScanStatus = "pending" | "complete";

const activeRuns = new Map<string, Promise<unknown>>();
const completedRuns = new Map<string, { expiresAt: number; result: unknown }>();
const COMPLETED_RESULT_TTL_MS = 5 * 60 * 1000;
const COMPLETED_STATUS_TTL_MS = 30 * 1000;
const scanStatuses = new Map<
  string,
  { status: CompletePhotoScanStatus; expiresAt?: number }
>();
const scanGenerations = new Map<string, number>();
const completedStatusExpiryTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();
let nextScanGeneration = 0;

/**
 * Hash the ordered evidence and the inputs that affect merge decisions.
 * Content is hashed before inclusion so fingerprints stay small even when
 * several large data URLs are supplied.
 */
export function createScanFingerprint(input: ScanFingerprintInput): string {
  const photoHashes = input.photos
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((photo) => ({
      order: photo.order,
      sourceId: photo.sourceId ?? null,
      contentHash: createHash("sha256").update(photo.content).digest("hex"),
    }));
  return createHash("sha256")
    .update(
      JSON.stringify({
        photos: photoHashes,
        facts: input.facts,
        lockedFields: [...input.lockedFields].sort(),
        model: input.model,
        promptVersion: input.promptVersion,
      }),
    )
    .digest("hex");
}

/**
 * Coalesce identical work and briefly retain completed results. The caller
 * still owns stale-result protection when applying a result to mutable data.
 */
export async function runAiScanPipeline<T>(
  fingerprint: string,
  execute: () => Promise<T>,
): Promise<ScanRunResult<T>> {
  const now = Date.now();
  const completed = completedRuns.get(fingerprint);
  if (completed && completed.expiresAt > now) {
    return {
      result: completed.result as T,
      fingerprint,
      deduped: true,
    };
  }
  if (completed) completedRuns.delete(fingerprint);

  const active = activeRuns.get(fingerprint);
  if (active) {
    return {
      result: (await active) as T,
      fingerprint,
      deduped: true,
    };
  }

  const promise = execute();
  activeRuns.set(fingerprint, promise);
  try {
    const result = await promise;
    completedRuns.set(fingerprint, {
      result,
      expiresAt: Date.now() + COMPLETED_RESULT_TTL_MS,
    });
    return { result, fingerprint, deduped: false };
  } finally {
    activeRuns.delete(fingerprint);
  }
}

/**
 * Run providers against an immutable complete-photo snapshot, then reload the
 * snapshot before the caller applies any result. A changed fingerprint means a
 * newer photo set or a manual fact edit won, so the caller must not write its
 * older result.
 */
export async function runCompletePhotoScan<TSnapshot, TResult>(options: {
  loadSnapshot: () => Promise<CompletePhotoScanSnapshot<TSnapshot>>;
  execute: (snapshot: TSnapshot) => Promise<TResult>;
}): Promise<CompletePhotoScanResult<TSnapshot, TResult>> {
  const snapshot = await options.loadSnapshot();
  const run = await runAiScanPipeline(snapshot.fingerprint, () =>
    options.execute(snapshot.value),
  );
  const current = await options.loadSnapshot();
  return {
    snapshot: snapshot.value,
    result: run.result,
    fingerprint: run.fingerprint,
    deduped: run.deduped,
    stale: current.fingerprint !== snapshot.fingerprint,
  };
}

export function averageVectors(vectors: readonly number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dimensions = vectors[0]?.length ?? 0;
  if (!dimensions || vectors.some((vector) => vector.length !== dimensions)) {
    return null;
  }
  const average = Array.from({ length: dimensions }, () => 0);
  for (const vector of vectors) {
    for (let index = 0; index < dimensions; index += 1) {
      average[index] += vector[index]! / vectors.length;
    }
  }
  return average;
}

/**
 * Generate one semantic visual vector from every ordered photo. Individual
 * provider failures degrade gracefully; an available subset is still useful.
 */
export async function generateMultiPhotoVisualEmbedding<T>(
  photos: readonly T[],
  generate: (photo: T) => Promise<number[] | null>,
): Promise<{ value: number[] | null; failed: boolean }> {
  const results = await Promise.allSettled(photos.map(generate));
  const vectors = results.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  return {
    value: averageVectors(vectors),
    failed: results.some((result) => result.status === "rejected"),
  };
}

const scheduledScans = new Map<string, ReturnType<typeof setTimeout>>();

function clearCompletedStatusExpiry(key: string): void {
  const expiryTimer = completedStatusExpiryTimers.get(key);
  if (expiryTimer) clearTimeout(expiryTimer);
  completedStatusExpiryTimers.delete(key);
}

function clearScanStatus(key: string): void {
  clearCompletedStatusExpiry(key);
  scanStatuses.delete(key);
  scanGenerations.delete(key);
}

function markScanComplete(key: string, generation: number): void {
  const expiresAt = Date.now() + COMPLETED_STATUS_TTL_MS;
  clearCompletedStatusExpiry(key);
  scanStatuses.set(key, { status: "complete", expiresAt });
  const expiryTimer = setTimeout(() => {
    const status = scanStatuses.get(key);
    if (
      status?.status === "complete" &&
      status.expiresAt === expiresAt &&
      scanGenerations.get(key) === generation
    ) {
      scanStatuses.delete(key);
      scanGenerations.delete(key);
    }
    completedStatusExpiryTimers.delete(key);
  }, COMPLETED_STATUS_TTL_MS);
  completedStatusExpiryTimers.set(key, expiryTimer);
}

/**
 * Coalesce a burst of photo mutations into one scan over the final ordered
 * evidence set instead of invoking providers once per upload. A successful
 * completion acknowledgement expires shortly afterward so it remains useful
 * feedback without becoming permanent, process-local record state.
 */
export function scheduleCompletePhotoScan(
  key: string,
  run: () => Promise<unknown>,
  onError: (error: unknown) => void,
  delayMs = 350,
): void {
  const previous = scheduledScans.get(key);
  if (previous) clearTimeout(previous);
  clearCompletedStatusExpiry(key);
  const generation = ++nextScanGeneration;
  scanGenerations.set(key, generation);
  scanStatuses.set(key, { status: "pending" });

  let timer: ReturnType<typeof setTimeout>;
  timer = setTimeout(() => {
    // A newer photo mutation replaced this timer. Its generation owns the
    // status, so this callback must not clear or complete it.
    if (scheduledScans.get(key) !== timer) return;
    scheduledScans.delete(key);
    void run()
      .then(() => {
        // If another mutation happened while providers were running, leave
        // the newer request pending rather than showing a stale completion.
        if (scanGenerations.get(key) === generation) {
          markScanComplete(key, generation);
        }
      })
      .catch((error) => {
        if (scanGenerations.get(key) === generation) {
          clearScanStatus(key);
        }
        onError(error);
      });
  }, delayMs);
  scheduledScans.set(key, timer);
}

export function getCompletePhotoScanStatus(
  key: string,
): CompletePhotoScanStatus | undefined {
  const status = scanStatuses.get(key);
  if (
    status?.status === "complete" &&
    status.expiresAt !== undefined &&
    status.expiresAt <= Date.now()
  ) {
    clearScanStatus(key);
    return undefined;
  }
  return status?.status;
}

export function clearAiScanPipelineCache(): void {
  activeRuns.clear();
  completedRuns.clear();
  for (const timer of scheduledScans.values()) clearTimeout(timer);
  scheduledScans.clear();
  for (const timer of completedStatusExpiryTimers.values()) clearTimeout(timer);
  completedStatusExpiryTimers.clear();
  scanStatuses.clear();
  scanGenerations.clear();
  nextScanGeneration = 0;
}
