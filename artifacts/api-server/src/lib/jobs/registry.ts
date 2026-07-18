import { z } from "zod";

export const JOB_STATUSES = [
  "queued",
  "scheduled",
  "running",
  "retry_wait",
  "succeeded",
  "failed",
  "cancelled",
  "dead_letter",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobHandlerContext = {
  jobId: number;
  attempt: number;
  signal: AbortSignal;
  updateProgress(progressPercent: number, message: string): Promise<void>;
};

export type JobDefinition<TPayload extends z.ZodTypeAny> = {
  type: string;
  queue: string;
  payloadSchemaVersion: number;
  payloadSchema: TPayload;
  maxAttempts: number;
  idempotencyStrategy: string;
  handler: (
    payload: z.infer<TPayload>,
    context: JobHandlerContext,
  ) => Promise<void>;
};

const emptyPayload = z.object({}).strict();

export const JOB_REGISTRY = [
  {
    type: "scheduler.trip-reminder-alerts",
    queue: "scheduler",
    payloadSchemaVersion: 1,
    payloadSchema: z.object({ scheduledWindow: z.string() }),
    maxAttempts: 3,
    idempotencyStrategy:
      "One row per deterministic scheduledWindow; reminder delivery uses existing alert ledgers.",
    handler: async (_payload, context) => {
      await context.updateProgress(
        100,
        "Reminder scheduler checkpoint recorded.",
      );
    },
  },
  {
    type: "travels.gmail-scan",
    queue: "provider.google",
    payloadSchemaVersion: 1,
    payloadSchema: z.object({ userId: z.number().int(), window: z.string() }),
    maxAttempts: 4,
    idempotencyStrategy:
      "Idempotency key gmail-scan:<userId>:<window>; message IDs remain the import ledger.",
    handler: async (_payload, context) => {
      await context.updateProgress(
        100,
        "Gmail scan job placeholder completed.",
      );
    },
  },
  {
    type: "ai.bulk-reanalysis",
    queue: "ai",
    payloadSchemaVersion: 1,
    payloadSchema: z.object({
      module: z.string(),
      recordIds: z.array(z.number().int()),
    }),
    maxAttempts: 2,
    idempotencyStrategy:
      "Parent job fans out deterministic child keys by module/record/model version.",
    handler: async (_payload, context) => {
      await context.updateProgress(
        100,
        "Bulk AI reanalysis fan-out placeholder completed.",
      );
    },
  },
  {
    type: "provider.apify-placeholder",
    queue: "provider.apify",
    payloadSchemaVersion: 1,
    payloadSchema: z.object({ actorId: z.string(), inputRef: z.string() }),
    maxAttempts: 3,
    idempotencyStrategy:
      "Future Apify runs key by actor/run/dataset identifiers and snapshot hash.",
    handler: async (_payload, context) => {
      await context.updateProgress(
        100,
        "Apify-compatible provider placeholder completed.",
      );
    },
  },
  {
    type: "embedding.generate",
    queue: "ai",
    payloadSchemaVersion: 1,
    payloadSchema: z.object({
      module: z.string(),
      recordType: z.string(),
      recordId: z.number().int(),
      modelVersion: z.string(),
    }),
    maxAttempts: 3,
    idempotencyStrategy:
      "Embeddings overwrite by module/record/modelVersion instead of appending duplicates.",
    handler: async (_payload, context) => {
      await context.updateProgress(
        100,
        "Embedding generation placeholder completed.",
      );
    },
  },
  {
    type: "operations.aggregate-retention",
    queue: "maintenance",
    payloadSchemaVersion: 1,
    payloadSchema: emptyPayload,
    maxAttempts: 3,
    idempotencyStrategy:
      "Daily singleton key operations-aggregate-retention:<yyyy-mm-dd>.",
    handler: async (_payload, context) => {
      await context.updateProgress(
        100,
        "Operations retention checkpoint recorded.",
      );
    },
  },
] satisfies JobDefinition<z.ZodTypeAny>[];

export const JOB_REGISTRY_BY_TYPE = new Map(
  JOB_REGISTRY.map((definition) => [definition.type, definition]),
);
