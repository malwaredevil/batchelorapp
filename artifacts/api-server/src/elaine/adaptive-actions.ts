import type OpenAI from "openai";
import { z } from "zod/v4";
import { correctElaineMemory, forgetElaineMemory } from "../lib/elaine-memory";
import {
  cancelElaineTaskForUser,
  enqueueElaineResearchTask,
} from "../lib/elaine-tasks";

const CorrectMemoryPayload = z.object({
  memoryId: z.number().int().positive(),
  correctedContent: z.string().trim().min(1).max(2_000),
});

const ForgetMemoryPayload = z.object({
  memoryId: z.number().int().positive(),
});

const QueueResearchTaskPayload = z.object({
  goal: z.string().trim().min(1).max(500),
  queries: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
});

const CancelElaineTaskPayload = z.object({
  taskId: z.number().int().positive(),
});

export const adaptiveActionSchemas = [
  z.object({
    type: z.literal("correct_memory"),
    payload: CorrectMemoryPayload,
  }),
  z.object({
    type: z.literal("forget_memory"),
    payload: ForgetMemoryPayload,
  }),
  z.object({
    type: z.literal("queue_research_task"),
    payload: QueueResearchTaskPayload,
  }),
  z.object({
    type: z.literal("cancel_elaine_task"),
    payload: CancelElaineTaskPayload,
  }),
] as const;

export const ADAPTIVE_ACTION_TYPES = [
  "correct_memory",
  "forget_memory",
  "queue_research_task",
  "cancel_elaine_task",
] as const;

export type AdaptiveActionType = (typeof ADAPTIVE_ACTION_TYPES)[number];

type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

export const adaptiveActionExecutors: Record<
  AdaptiveActionType,
  ActionExecutor
> = {
  correct_memory: (async (
    payload: z.infer<typeof CorrectMemoryPayload>,
    userId: number,
  ) => {
    const result = await correctElaineMemory({
      userId,
      memoryId: payload.memoryId,
      correctedContent: payload.correctedContent,
    });
    if (result === "forbidden") {
      return { status: 403, body: { error: "Memory is not accessible" } };
    }
    if (!result) {
      return { status: 404, body: { error: "Memory not found" } };
    }
    return {
      status: 200,
      body: { type: "correct_memory", result },
    };
  }) as ActionExecutor,
  forget_memory: (async (
    payload: z.infer<typeof ForgetMemoryPayload>,
    userId: number,
  ) => {
    const result = await forgetElaineMemory({
      userId,
      memoryId: payload.memoryId,
    });
    if (result === "forbidden") {
      return { status: 403, body: { error: "Memory is not accessible" } };
    }
    if (!result) {
      return { status: 404, body: { error: "Memory not found" } };
    }
    return {
      status: 200,
      body: { type: "forget_memory", result: { forgotten: true } },
    };
  }) as ActionExecutor,
  queue_research_task: (async (
    payload: z.infer<typeof QueueResearchTaskPayload>,
    userId: number,
  ) => {
    const taskId = await enqueueElaineResearchTask({
      userId,
      goal: payload.goal,
      queries: payload.queries,
      confirmationGrantedAt: new Date(),
    });
    return {
      status: 202,
      body: {
        type: "queue_research_task",
        result: { taskId, state: "queued" },
      },
    };
  }) as ActionExecutor,
  cancel_elaine_task: (async (
    payload: z.infer<typeof CancelElaineTaskPayload>,
    userId: number,
  ) => {
    const cancelled = await cancelElaineTaskForUser(userId, payload.taskId);
    return cancelled
      ? {
          status: 200,
          body: {
            type: "cancel_elaine_task",
            result: { taskId: payload.taskId, state: "cancelled" },
          },
        }
      : {
          status: 409,
          body: {
            error:
              "Task was not found, already finished, or already cancelled.",
          },
        };
  }) as ActionExecutor,
};

export function buildAdaptiveActionLabel(action: {
  type: AdaptiveActionType;
  payload: unknown;
}): string {
  switch (action.type) {
    case "correct_memory": {
      const payload = CorrectMemoryPayload.parse(action.payload);
      return `Correct memory ${payload.memoryId} to "${payload.correctedContent}"`;
    }
    case "forget_memory": {
      const payload = ForgetMemoryPayload.parse(action.payload);
      return `Forget memory ${payload.memoryId}`;
    }
    case "queue_research_task": {
      const payload = QueueResearchTaskPayload.parse(action.payload);
      return `Start a background research task: "${payload.goal}"`;
    }
    case "cancel_elaine_task": {
      const payload = CancelElaineTaskPayload.parse(action.payload);
      return `Cancel Elaine task ${payload.taskId}`;
    }
  }
}

export const adaptiveActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "correct_memory",
        description:
          "Propose correcting an existing Elaine memory. First call list_memories and use an exact memoryId returned in this conversation. Explain the old and corrected fact before requesting confirmation.",
        parameters: {
          type: "object",
          properties: {
            memoryId: { type: "integer" },
            correctedContent: { type: "string" },
          },
          required: ["memoryId", "correctedContent"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "forget_memory",
        description:
          "Propose forgetting an existing Elaine memory. First call list_memories and use an exact memoryId returned in this conversation. Explain which fact will be forgotten before requesting confirmation.",
        parameters: {
          type: "object",
          properties: { memoryId: { type: "integer" } },
          required: ["memoryId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "queue_research_task",
        description:
          "Propose a durable background research task only when the work needs multiple searches or may outlast this chat request. Provide a concise goal and 1-5 independent, non-duplicative search queries. This uses paid providers and therefore requires visible confirmation.",
        parameters: {
          type: "object",
          properties: {
            goal: { type: "string" },
            queries: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 5,
            },
          },
          required: ["goal", "queries"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "cancel_elaine_task",
        description:
          "Propose cancelling a queued or running Elaine task. First call list_elaine_tasks and use an exact taskId returned for the current user.",
        parameters: {
          type: "object",
          properties: { taskId: { type: "integer" } },
          required: ["taskId"],
        },
      },
    },
  ];
