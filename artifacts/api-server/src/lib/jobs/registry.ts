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

// ---------------------------------------------------------------------------
// Job registry
// ---------------------------------------------------------------------------

export const JOB_REGISTRY = [
  {
    type: "slack.turn",
    queue: "slack",
    payloadSchemaVersion: 1,
    payloadSchema: z.object({
      userId: z.number().int(),
      slackEventId: z.string(),
      inputText: z.string(),
      channelId: z.string().optional(),
      responseUrl: z.string().optional(),
    }),
    maxAttempts: 3,
    idempotencyStrategy:
      "Idempotency key is the Slack event_id (DMs) or a slash:userId:minuteBucket key (slash commands) — one job per unique event delivery.",
    handler: async (payload, _context) => {
      // Dynamic imports keep registry.ts import-free from heavy modules
      // (elaine, @workspace/db) so the module can be loaded in tests without
      // triggering real DB connections or pulling in the full Elaine engine
      // before mocks are applied.
      const { eq } = await import("drizzle-orm");
      const { db, pool, elaineSlackConversations } =
        await import("@workspace/db");
      const { runElaineSlackTurn } = await import("../../elaine");
      const { postSlackMessage, postSlashCommandResponse } =
        await import("../slack");
      const { logger } = await import("../logger");

      // Each stored message is tagged with the slackEventId of the turn that
      // created it.  On retry the handler checks for a pre-existing assistant
      // message with the same eventId and re-posts its content instead of
      // re-running the Elaine turn — avoiding duplicate/interleaved history
      // writes when postSlackMessage fails after history has been persisted.
      type ElaineSlackMsg = {
        role: "user" | "assistant";
        content: string;
        eventId?: string;
      };

      const { userId, slackEventId, inputText, channelId, responseUrl } =
        payload;

      // Serialise per-user turns with a PostgreSQL advisory lock.
      //
      // When multiple job workers run concurrently (or a single worker
      // processes rapid back-to-back messages) two jobs for the same userId
      // must never execute the history-read → Elaine-turn → history-write
      // cycle in parallel — that would produce interleaved/lost-update races
      // in elaineSlackConversations.messages.
      //
      // pg_advisory_lock(classid, objid) blocks until any other session that
      // holds the same (classid, objid) lock releases it, so the second job
      // for userId N waits until the first has finished and released.
      //
      // Class constant 42001 is a stable, arbitrary namespace for Slack turns.
      const SLACK_TURN_LOCK_CLASS = 42001;
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock($1, $2)", [
          SLACK_TURN_LOCK_CLASS,
          userId,
        ]);

        // Get or create the conversation row for this user.
        const [existing] = await db
          .select()
          .from(elaineSlackConversations)
          .where(eq(elaineSlackConversations.userId, userId));

        let conversation = existing;
        if (!conversation) {
          const [created] = await db
            .insert(elaineSlackConversations)
            .values({ userId, slackUserId: "", messages: [] })
            .onConflictDoNothing()
            .returning();
          if (created) {
            conversation = created;
          } else {
            const [row] = await db
              .select()
              .from(elaineSlackConversations)
              .where(eq(elaineSlackConversations.userId, userId));
            conversation = row;
          }
        }

        const history =
          (conversation.messages as ElaineSlackMsg[] | null) ?? [];

        // ── Idempotent-retry guard ────────────────────────────────────────
        // If a prior attempt for this slackEventId already ran the Elaine
        // turn and wrote history, re-use the cached reply rather than
        // re-invoking Elaine.  This happens when postSlackMessage/
        // postSlashCommandResponse threw after the DB write — the job is
        // retried by the worker but must not re-run the LLM call.
        const cachedReply = history
          .slice()
          .reverse()
          .find((m) => m.role === "assistant" && m.eventId === slackEventId);

        let replyText: string;

        if (cachedReply) {
          logger.info(
            { userId, slackEventId },
            "slack.turn: re-posting cached reply (idempotent retry)",
          );
          replyText = cachedReply.content;
        } else {
          // New event — run the Elaine turn.
          let updatedHistory: ElaineSlackMsg[];
          try {
            const result = await runElaineSlackTurn({
              userId,
              inputText,
              history,
            });
            replyText = result.replyText;
            updatedHistory = result.history;
          } catch (err) {
            logger.error({ err, userId }, "slack.turn: Elaine turn failed");
            // Re-throw so the worker marks the job for retry.
            throw err;
          }

          // Tag the newly appended user+assistant messages with the eventId
          // so any subsequent retry skips the LLM call and re-posts this reply.
          const priorLen = history.length;
          const taggedHistory = updatedHistory.map((m, i) =>
            i >= priorLen ? { ...m, eventId: slackEventId } : m,
          );

          await db
            .update(elaineSlackConversations)
            .set({ messages: taggedHistory, updatedAt: new Date() })
            .where(eq(elaineSlackConversations.id, conversation.id));
        }

        if (channelId) {
          await postSlackMessage(channelId, replyText);
        } else if (responseUrl) {
          await postSlashCommandResponse(responseUrl, replyText);
        } else {
          logger.warn({ userId }, "slack.turn: no channelId or responseUrl");
        }
      } finally {
        // Always release the advisory lock and return the client to the pool,
        // even when the Elaine turn throws (so the worker can retry without
        // leaving a dangling lock on the pool connection).
        await client
          .query("SELECT pg_advisory_unlock($1, $2)", [
            SLACK_TURN_LOCK_CLASS,
            userId,
          ])
          .catch((unlockErr: unknown) => {
            logger.error(
              { unlockErr, userId },
              "slack.turn: failed to release advisory lock",
            );
          });
        client.release();
      }
    },
  },
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
  {
    type: "travels.monitoring-check",
    queue: "provider.default",
    payloadSchemaVersion: 1,
    payloadSchema: z.object({ reservationId: z.number().int() }),
    maxAttempts: 3,
    idempotencyStrategy:
      "Key monitoring-check:<reservationId>:<timestamp-bucket> so rapid re-triggers within the same minute deduplicate.",
    handler: async (_payload, context) => {
      await context.updateProgress(
        100,
        "Monitoring check placeholder completed — live adapters added per provider.",
      );
    },
  },
] satisfies JobDefinition<z.ZodTypeAny>[];

export const JOB_REGISTRY_BY_TYPE = new Map(
  JOB_REGISTRY.map((definition) => [definition.type, definition]),
);
