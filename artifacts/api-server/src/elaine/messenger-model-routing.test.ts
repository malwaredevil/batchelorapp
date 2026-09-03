/**
 * Direct unit test for runMessengerElaineTurn — model tier assertion.
 *
 * Unlike the route-level tests in routes/messenger/conversations.test.ts
 * (which mock runMessengerElaineTurn entirely and only verify the route calls
 * it), this file lets runMessengerElaineTurn and its internal engine run for
 * real, mocking only at the callModel boundary.
 *
 * The goal: assert that callModel is invoked with
 * config.models.restrictedTextModel — NOT config.chatModel — confirming the
 * messenger channel uses the smart model tier, not the fast one.
 *
 * Voice is the ONLY restricted channel that passes useFastModel:true to
 * runRestrictedElaineTurn. Messenger, SMS, Slack, and email all use the smart
 * tier. This test would fail if someone erroneously added useFastModel:true
 * to runMessengerElaineTurn's call site.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  elaineLessonsMockFactory,
  loggerMockFactory,
  sentryMockFactory,
  rateLimitMockFactory,
} from "./test-helpers/standard-mock-scaffold";

// ---------------------------------------------------------------------------
// Hoisted shared state — must exist before vi.mock factories run.
// ---------------------------------------------------------------------------
const { dbMock, callModelSpy, selectQueue } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];

  /**
   * A minimal Drizzle-style query builder whose result is the next entry from
   * selectQueue (or [] when the queue is empty). Handles the four main query
   * termination styles used in runMessengerElaineTurn / buildUserContext /
   * buildAgentphoneContext:
   *   .from(T).where(c).limit(n)        → resultPromise
   *   .from(T).where(c).orderBy().limit → resultPromise
   *   .from(T).where(c)                 → thenable
   *   .from(T).orderBy(...).limit(n)    → resultPromise
   *   .from(T).innerJoin(...).where(c)  → thenable
   */
  function makeQueryBuilder() {
    const result: unknown[] = selectQueue.shift() ?? [];
    const promise = Promise.resolve(result);

    const thenable = {
      then<T, U = never>(
        onfulfilled?: ((v: unknown[]) => T | PromiseLike<T>) | null,
        onrejected?: ((r: unknown) => U | PromiseLike<U>) | null,
      ): Promise<T | U> {
        return promise.then(onfulfilled, onrejected) as Promise<T | U>;
      },
    };

    const afterOrderBy = {
      limit: (_n: number) => promise,
      then: thenable.then,
    };

    const afterWhere = {
      orderBy: (..._args: unknown[]) => afterOrderBy,
      limit: (_n: number) => promise,
      then: thenable.then,
    };

    const afterInnerJoin = {
      where: (_cond: unknown) => afterWhere,
      then: thenable.then,
    };

    const afterFrom = {
      where: (_cond: unknown) => afterWhere,
      orderBy: (..._args: unknown[]) => afterOrderBy,
      innerJoin: (_t: unknown, _on: unknown) => afterInnerJoin,
      then: thenable.then,
    };

    return { from: (_table: unknown) => afterFrom };
  }

  const dbMock = {
    select: vi.fn(() => makeQueryBuilder()),
    insert: vi.fn(() => ({
      values: (_v: unknown) => ({
        returning: () => Promise.resolve([]),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
      }),
    })),
    update: vi.fn(() => ({
      set: () => ({ where: () => Promise.resolve([]) }),
    })),
    delete: vi.fn(() => ({ where: () => Promise.resolve() })),
  };

  const callModelSpy = vi.fn();

  return { dbMock, callModelSpy, selectQueue };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../lib/logger", () => loggerMockFactory());

vi.mock("../middleware/rateLimit", () => rateLimitMockFactory());

vi.mock("../middleware/auth", () => ({
  requireAuth: vi.fn((_req: unknown, _res: unknown, next: () => void) =>
    next(),
  ),
}));

vi.mock("@sentry/node", () => sentryMockFactory());

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

// ── Core AI client: the spy that captures model selection ─────────────────
vi.mock("../lib/ai-client", () => ({
  callModel: (...args: unknown[]) => callModelSpy(...args),
  callModelWithSubagent: vi.fn().mockResolvedValue({ content: "" }),
  HIDDEN_REASONING: {},
}));

// ── Elaine config: two distinct model strings so the test can tell them apart
vi.mock("../lib/elaine-config", () => ({
  getElaineGlobalConfig: vi.fn().mockResolvedValue({
    chatModel: "fast-chat-model",
    models: {
      restrictedTextModel: "smart-restricted-model",
    },
    isEnabled: true,
    actionConfirmationMode: "auto_run",
  }),
  updateElaineGlobalConfig: vi.fn(),
  // ElaineTurnRuntime (loaded via the real, unmocked "./runtime" module in
  // this file) falls back to this constant when no `budget` override is
  // passed — must stay in the mock or the module import throws "No
  // DEFAULT_RUNTIME_BUDGET export is defined".
  DEFAULT_RUNTIME_BUDGET: {
    maxModelRounds: 8,
    maxToolCalls: 24,
    maxReplans: 10,
    maxElapsedMs: 240_000,
  },
}));

// ── OpenAI Responses API: disabled so the OpenRouter callModel path runs ──
vi.mock("../lib/openai-responses", () => ({
  isOpenAIResponsesConfigured: vi.fn().mockReturnValue(false),
  recordOpenAIResponsesFallback: vi.fn(),
  createOpenAIStableIdentifier: vi.fn().mockReturnValue("id-123"),
  generateOpenAIResponseText: vi.fn().mockResolvedValue(""),
  getOpenAIResponsesMetrics: vi.fn().mockReturnValue({}),
  isRecoverableOpenAIStateError: vi.fn().mockReturnValue(false),
  messagesToResponseInput: vi.fn().mockReturnValue([]),
  OpenAIResponsesUnavailableError: class extends Error {
    category = "config_missing";
  },
  resolveOpenAIResponsesModel: vi.fn().mockReturnValue(""),
  streamOpenAIResponseRound: vi.fn(),
  runRestrictedTurnViaOpenAIResponses: vi.fn(),
}));

vi.mock("../lib/elaine-memory", () => ({
  getElaineMemorySummary: vi.fn().mockResolvedValue(null),
  getRelevantElaineMemory: vi.fn().mockResolvedValue({ evidenceBlock: "" }),
  rememberElaineMemory: vi.fn().mockResolvedValue(undefined),
  forgetElaineMemory: vi.fn().mockResolvedValue(undefined),
  correctElaineMemory: vi.fn().mockResolvedValue(undefined),
  saveElaineMemorySummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/elaine-cross-channel", () => ({
  loadCrossChannelContext: vi.fn().mockResolvedValue(""),
  appendCrossChannelEntry: vi.fn().mockResolvedValue(undefined),
}));

// Uses the shared scaffold to keep the elaine-lessons mock in sync with siblings.
// Wrapped in a lambda so Vitest's hoist pass doesn't reference the import
// binding before the module is initialized.
vi.mock("../lib/elaine-lessons", () => elaineLessonsMockFactory());

vi.mock("../lib/app-config", () => ({
  getAllConfig: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockResolvedValue(null),
  getConfigRow: vi.fn().mockResolvedValue(null),
  updateConfigValue: vi.fn().mockResolvedValue(undefined),
  APP_CONFIG_DEFAULTS: [],
}));

vi.mock("../lib/openai", () => ({
  embedText: vi.fn().mockResolvedValue([]),
  openaiClient: { chat: { completions: { create: vi.fn() } } },
}));

vi.mock("../lib/email", () => ({
  sendAssistantEmail: vi.fn().mockResolvedValue(undefined),
  sendTestEmail: vi.fn().mockResolvedValue(undefined),
  resendConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/sms", () => ({
  sendSms: vi.fn().mockResolvedValue(undefined),
  SmsRegistrationPendingError: class extends Error {},
  SmsOptedOutError: class extends Error {},
}));

vi.mock("../lib/web-search", () => ({
  webSearch: vi.fn().mockResolvedValue([]),
  fetchPage: vi.fn().mockResolvedValue(""),
}));

vi.mock("../lib/openrouter-models", () => ({
  listOpenRouterModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/travels/storage", () => ({
  deleteTripPhoto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/travels-storage", () => ({
  deleteDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/soft-delete", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/google-calendar-tokens", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue(null),
}));

vi.mock("../routes/travels/documents", () => ({
  rescanTripDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../routes/admin/integrations-health", () => ({
  getCachedHealthChecks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../routes/travels/reminders", () => ({
  getReminderSyncTarget: vi.fn().mockResolvedValue(null),
  syncReminderCalendarEvents: vi.fn().mockResolvedValue(undefined),
  deleteAllReminderCalendarEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../routes/travels/ai", () => ({
  generateItineraryForTrip: vi.fn().mockResolvedValue(undefined),
  ItineraryActionError: class extends Error {},
}));

vi.mock("../lib/pottery/ebay-market-value", () => ({
  lookupEbayMarketValue: vi.fn().mockResolvedValue(null),
  buildEbayQuery: vi.fn().mockReturnValue(""),
}));

vi.mock("../lib/ornaments/hallmark-search", () => ({
  searchHallmark: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/ornaments/barcode", () => ({
  lookupBarcode: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/travels/flights", () => ({
  lookupFlightPrices: vi.fn().mockResolvedValue([]),
}));

vi.mock("./travel-wishlist-executors", () => ({
  removeWishlistItemExecutor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/ssrf-safe-fetch", () => ({
  fetchJsonSafe: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/expert-consult", () => ({
  consultExperts: vi.fn().mockResolvedValue(""),
}));

vi.mock("../lib/travels/google-maps", () => ({
  getWeatherForecast: vi.fn().mockResolvedValue(null),
  getAirQuality: vi.fn().mockResolvedValue(null),
  getPollenForecast: vi.fn().mockResolvedValue(null),
  searchPlaces: vi.fn().mockResolvedValue([]),
  computeRoute: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/env", () => ({
  env: {
    isProduction: false,
    sessionSecret: "test-session",
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    openrouterApiKey: "mock-openrouter",
  },
}));

// ---------------------------------------------------------------------------
// Module under test — imported AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { runMessengerElaineTurn } from "./index";
import { getRelevantElaineLessons } from "../lib/elaine-lessons";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fake OpenRouter completion: a single assistant message, no tool calls. */
function fakeCompletion(content = "Mock Elaine messenger reply") {
  return {
    choices: [{ message: { content, tool_calls: [] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  selectQueue.length = 0;
  vi.clearAllMocks();

  // Default callModel implementation: return a plain text reply with no tool
  // calls so the restricted-turn loop exits after one round.
  callModelSpy.mockResolvedValue(fakeCompletion());
});

describe("runMessengerElaineTurn — model tier selection", () => {
  it("calls callModel with restrictedTextModel, not chatModel", async () => {
    // Confirm the messenger channel does NOT take the fast-model path.
    // Voice is the only channel that passes useFastModel:true; messenger must
    // use config.models.restrictedTextModel (the smart tier).
    await runMessengerElaineTurn({
      userId: 1,
      conversationId: 1,
      inputText: "What trips do I have coming up?",
      senderName: "Alice",
    });

    expect(callModelSpy).toHaveBeenCalled();

    // The first positional argument to callModel is the model string.
    const modelArg = callModelSpy.mock.calls[0][0] as string;
    expect(modelArg).toBe("smart-restricted-model");
    expect(modelArg).not.toBe("fast-chat-model");
  });

  it("does NOT call callModel with chatModel (fast path) for messenger", async () => {
    await runMessengerElaineTurn({
      userId: 2,
      conversationId: 5,
      inputText: "Remind me about my packing list",
      senderName: "Bob",
    });

    // Assert across ALL callModel invocations (multi-round tool loops would
    // call it multiple times) that the fast chatModel is never selected.
    for (const call of callModelSpy.mock.calls) {
      const modelArg = call[0] as string;
      expect(modelArg).not.toBe("fast-chat-model");
    }
  });

  it("returns a replyText produced by callModel", async () => {
    callModelSpy.mockResolvedValue(
      fakeCompletion("Here are your upcoming trips!"),
    );

    const result = await runMessengerElaineTurn({
      userId: 1,
      conversationId: 1,
      inputText: "My trips?",
      senderName: "Alice",
    });

    expect(result.replyText).toBe("Here are your upcoming trips!");
    expect(result.widgets).toEqual([]);
  });

  it("skips the Responses API path (isOpenAIResponsesConfigured is false) and falls through to callModel", async () => {
    const { isOpenAIResponsesConfigured } =
      await import("../lib/openai-responses");

    await runMessengerElaineTurn({
      userId: 1,
      conversationId: 1,
      inputText: "Hello",
      senderName: "Alice",
    });

    // The Responses path is disabled by the mock; callModel must still run.
    expect(isOpenAIResponsesConfigured).toHaveBeenCalled();
    expect(callModelSpy).toHaveBeenCalled();
  });
});

describe("runMessengerElaineTurn — past lessons reach the planner", () => {
  it("passes lesson evidence to generateElainePlan when the request needs structured planning", async () => {
    // Arrange: return specific lesson evidence from the lessons lookup.
    const lessonEvidence =
      "Past lesson: always confirm a flight number before adding to packing list";
    vi.mocked(getRelevantElaineLessons).mockResolvedValue({
      lessons: [],
      evidenceBlock: lessonEvidence,
    });

    // Capture the messages sent to every callModel invocation by running the
    // real callback against a minimal stub client. This lets us assert the
    // planning prompt (one of the callModel calls) contains the lesson text.
    const capturedPrompts: string[] = [];
    callModelSpy.mockImplementation(
      async (
        _model: string,
        callback: (
          client: unknown,
          model: string,
        ) => Promise<{
          choices: { message: { content: string; tool_calls: [] } }[];
        }>,
      ) => {
        const stubClient = {
          chat: {
            completions: {
              create: (params: {
                messages: Array<{ role: string; content: string }>;
              }) => {
                for (const msg of params.messages) {
                  capturedPrompts.push(msg.content);
                }
                return Promise.resolve({
                  choices: [{ message: { content: "{}", tool_calls: [] } }],
                });
              },
            },
          },
        };
        return callback(stubClient, _model);
      },
    );

    // Act: use an action-class message that classifyElaineRequest routes to
    // a non-answer kind, so requestNeedsStructuredPlan returns true and the
    // planner runs.
    await runMessengerElaineTurn({
      userId: 1,
      conversationId: 1,
      inputText: "Add a reminder for my dentist appointment on Friday at 3pm",
      senderName: "Alice",
    });

    // Assert: the lesson evidence appears in at least one captured prompt
    // (the planner prompt, which buildPlannerPrompt embeds it into).
    const plannerPromptHit = capturedPrompts.some((p) =>
      p.includes(lessonEvidence),
    );
    expect(plannerPromptHit).toBe(true);
  });
});
