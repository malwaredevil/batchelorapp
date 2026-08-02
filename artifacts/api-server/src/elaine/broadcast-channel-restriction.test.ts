/**
 * Confirms that `broadcast_message` cannot be triggered from the SMS or
 * AgentPhone channel (or the email channel, which shares the same tool
 * allowlist).
 *
 * Two enforcement layers are verified:
 *  1. STATIC — `broadcast_message` is absent from AGENTPHONE_ACTION_TYPES,
 *     the set that governs which action tools the restricted-channel model
 *     is offered.  An action not in this set is never sent to the model, so
 *     it cannot be called in any ordinary flow.
 *
 *  2. DYNAMIC — even if the model somehow hallucinates a `broadcast_message`
 *     tool call (e.g. from a cached state that predates the exclusion), the
 *     execution gate inside runRestrictedElaineTurn rejects it: the
 *     `AGENTPHONE_ACTION_TYPES.has(name)` check fails, so the executor is
 *     never invoked and the reply continues without executing the action.
 *
 * Together these prevent the delivery loop: an SMS-triggered broadcast would
 * echo back to the SMS channel it originated from and to every other channel
 * the user has configured, amplifying a single inbound message into a flood.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted refs — created before vi.mock() factories run so factories can
// reference them without triggering temporal dead-zone errors.
// ---------------------------------------------------------------------------

const {
  mockDbSelect,
  mockCallModel,
  mockBroadcastMessageExecutor,
  passthrough,
} = vi.hoisted(() => {
  // Recursive chainable builder — resolves to [] when awaited, and exposes
  // every method that Drizzle's select query builder might chain (innerJoin,
  // leftJoin, where, orderBy, limit, groupBy, having, etc.).
  function makeChain(): unknown {
    const handler: Record<string, unknown> = {};
    const methods = [
      "from",
      "where",
      "limit",
      "orderBy",
      "innerJoin",
      "leftJoin",
      "rightJoin",
      "fullJoin",
      "groupBy",
      "having",
      "offset",
    ];
    for (const m of methods) {
      handler[m] = vi.fn(() => makeChain());
    }
    // Make it thenable so `await db.select()....` resolves to [].
    handler.then = (resolve: (v: unknown[]) => void, _reject?: unknown) => {
      resolve([]);
      return Promise.resolve([]);
    };
    handler.catch = (_fn: unknown) => Promise.resolve([]);
    return handler;
  }
  const mockDbSelect = vi.fn(() => makeChain());
  const passthrough = (_r: unknown, _s: unknown, next: () => void) => next();
  return {
    mockDbSelect,
    mockCallModel: vi.fn(),
    mockBroadcastMessageExecutor: vi.fn(),
    passthrough,
  };
});

// ---------------------------------------------------------------------------
// Module mocks — order matters only insofar as they must all appear before
// any top-level import of the mocked modules.
// ---------------------------------------------------------------------------

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@sentry/node", () => ({
  setConversationId: vi.fn(),
  captureException: vi.fn(),
  withActiveSpan: vi.fn((_span: unknown, fn: () => unknown) => fn()),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
}));

// DB mock — all selects resolve to [] (empty household context is fine for
// these tests; we only need the turn to run without touching a real database).
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: mockDbSelect,
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
      })),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    },
    pool: { connect: vi.fn(), query: vi.fn() },
  };
});

vi.mock("../lib/app-config", () => ({
  getAllConfig: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockResolvedValue(null),
  updateConfigValue: vi.fn(),
  invalidateConfigCache: vi.fn(),
  APP_CONFIG_DEFAULTS: [],
}));

vi.mock("../lib/elaine-config", () => ({
  getElaineGlobalConfig: vi.fn().mockResolvedValue({
    chatModel: "openai/gpt-4o-mini",
    plannerModel: "openai/gpt-4o-mini",
    plannerEnabled: false,
    responsesEnabled: false,
  }),
  invalidateElaineGlobalConfigCache: vi.fn(),
}));

vi.mock("../lib/elaine-memory", () => ({
  getRelevantElaineMemory: vi.fn().mockResolvedValue([]),
  getElaineMemorySummary: vi.fn().mockResolvedValue(null),
  rememberElaineMemory: vi.fn(),
  correctElaineMemory: vi.fn(),
  forgetElaineMemory: vi.fn(),
  saveElaineMemorySummary: vi.fn(),
}));

vi.mock("../lib/elaine-cross-channel", () => ({
  loadCrossChannelContext: vi.fn().mockResolvedValue(null),
  appendCrossChannelEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/elaine-tasks", () => ({
  getElaineTaskForUser: vi.fn().mockResolvedValue(null),
  listElaineTasksForUser: vi.fn().mockResolvedValue([]),
  cancelElaineTaskForUser: vi.fn(),
}));

vi.mock("../lib/openai-responses", () => ({
  isOpenAIResponsesConfigured: vi.fn().mockReturnValue(false),
  createOpenAIStableIdentifier: vi.fn().mockReturnValue("mock-stable-id"),
  generateOpenAIResponseText: vi.fn(),
  getOpenAIResponsesMetrics: vi.fn().mockReturnValue({}),
  isRecoverableOpenAIStateError: vi.fn().mockReturnValue(false),
  OpenAIResponsesUnavailableError: class extends Error {},
  recordOpenAIResponsesFallback: vi.fn(),
  resolveOpenAIResponsesModel: vi.fn().mockReturnValue(null),
  streamOpenAIResponseRound: vi.fn(),
}));

vi.mock("../middleware/rateLimit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../middleware/rateLimit")>();
  // Replace every export that is a middleware function with a passthrough so
  // tests never hit the real rate-limit store.  Using importOriginal + spread
  // handles any new limiter exports added later without needing to update this
  // mock.
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) =>
      typeof v === "function" ? [k, passthrough] : [k, v],
    ),
  );
});

vi.mock("../middleware/auth", () => ({
  requireAuth: (_r: unknown, _s: unknown, next: () => void) => next(),
}));

vi.mock("../lib/email", () => ({
  sendAssistantEmail: vi.fn(),
  sendTestEmail: vi.fn(),
  resendConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/sms", () => ({
  sendSms: vi.fn(),
  SmsOptedOutError: class extends Error {},
  SmsRegistrationPendingError: class extends Error {},
}));

vi.mock("../lib/slack", () => ({
  openDmChannel: vi.fn(),
  postSlackMessage: vi.fn(),
  slackConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/calls", () => ({
  initiateOutboundCall: vi.fn(),
}));

vi.mock("../lib/openai", () => ({
  embedText: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
}));

vi.mock("../lib/web-search", () => ({
  webSearch: vi.fn().mockResolvedValue({ results: [] }),
  fetchPage: vi.fn().mockResolvedValue(""),
}));

vi.mock("../lib/soft-delete", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../lib/travels/storage", () => ({
  deleteTripPhoto: vi.fn(),
}));

vi.mock("../lib/travels-storage", () => ({
  deleteDocument: vi.fn(),
}));

vi.mock("../lib/google-calendar-tokens", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue(null),
}));

vi.mock("../routes/travels/documents", () => ({
  rescanTripDocument: vi.fn(),
}));

vi.mock("../routes/admin/integrations-health", () => ({
  getCachedHealthChecks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../routes/travels/reminders", () => ({
  getReminderSyncTarget: vi.fn().mockResolvedValue(null),
  syncReminderCalendarEvents: vi.fn(),
  deleteAllReminderCalendarEvents: vi.fn(),
}));

vi.mock("../routes/travels/ai", () => ({
  generateItineraryForTrip: vi.fn(),
  ItineraryActionError: class extends Error {},
}));

vi.mock("../lib/pottery/ebay-market-value", () => ({
  lookupEbayMarketValue: vi.fn(),
  buildEbayQuery: vi.fn().mockReturnValue(""),
}));

vi.mock("../lib/ornaments/hallmark-search", () => ({
  searchHallmark: vi.fn().mockResolvedValue([]),
  lookupHallmarkFromDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/ornaments/barcode", () => ({
  lookupBarcode: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/travels/flights", () => ({
  lookupFlightPrices: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/travels/google-maps", () => ({
  getWeatherForecast: vi.fn().mockResolvedValue(null),
  getAirQuality: vi.fn().mockResolvedValue(null),
  getPollenForecast: vi.fn().mockResolvedValue(null),
  searchPlaces: vi.fn().mockResolvedValue([]),
  computeRoute: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/ssrf-safe-fetch", () => ({
  fetchJsonSafe: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/expert-consult", () => ({
  consultExperts: vi.fn().mockResolvedValue(""),
}));

vi.mock("../lib/openrouter-models", () => ({
  listOpenRouterModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("./travel-wishlist-executors", () => ({
  removeWishlistItemExecutor: vi.fn(),
}));

// planner-tool-catalog.ts imports assertElaineToolFamilyCoverage directly from
// ./runtime/tool-families (not the ./runtime barrel), so we need a separate
// mock for that sub-path to prevent the startup-time family-coverage throw.
vi.mock("./runtime/tool-families", () => ({
  assertElaineToolFamilyCoverage: vi.fn(),
  ELAINE_TOOL_FAMILIES: {},
}));

vi.mock("./runtime", () => ({
  buildElaineSourceRoute: vi.fn().mockReturnValue("test"),
  classifyElaineRequest: vi.fn().mockResolvedValue({ label: "action" }),
  completedActionAcknowledgement: vi.fn().mockReturnValue("Done."),
  preparedActionAcknowledgement: vi.fn().mockReturnValue("Ready."),
  createElaineTurnTrace: vi.fn().mockResolvedValue({ id: "trace-1" }),
  finishElaineTurnTrace: vi.fn().mockResolvedValue(undefined),
  generateElainePlan: vi.fn().mockResolvedValue({ tools: [], reasoning: "" }),
  createFallbackPlan: vi.fn().mockReturnValue({ tools: [], reasoning: "" }),
  persistElaineTraceBestEffort: vi.fn(),
  requestNeedsStructuredPlan: vi.fn().mockReturnValue(false),
  evaluateElaineTrace: vi.fn().mockResolvedValue({ score: 1 }),
  evaluateForecastDateCoverage: vi.fn().mockReturnValue(true),
  findElaineSatisfiedFallback: vi.fn().mockReturnValue(null),
  aggregateElaineTraceEvaluations: vi.fn().mockReturnValue([]),
  decideElaineModelStreamRecovery: vi.fn().mockReturnValue("abort"),
  loadElaineTurnTracesForMessages: vi.fn().mockResolvedValue([]),
  mapWithConcurrency: vi
    .fn()
    .mockImplementation(
      async (items: unknown[], fn: (item: unknown) => Promise<unknown>) =>
        Promise.all(items.map(fn)),
    ),
  sanitizeRuntimeText: vi.fn().mockImplementation((t: string) => t),
  selectElaineReplanTool: vi.fn().mockReturnValue(null),
  isReusableElaineResponseState: vi.fn().mockReturnValue(false),
  selectElaineOpenAIRole: vi.fn().mockReturnValue("assistant"),
  stripElaineCitationMetadata: vi.fn().mockImplementation((t: string) => t),
  provenanceForTool: vi.fn().mockReturnValue(null),
  assertElaineToolFamilyCoverage: vi.fn(),
  MODEL_VISIBLE_HARD_TOOL_NAMES: new Set<string>(),
  MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS: {},
  ELAINE_READ_CONCURRENCY: 3,
  ElaineTurnRuntime: class {},
}));

vi.mock("./capability-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./capability-registry")>();
  return {
    ...actual,
    buildElaineCapabilityRegistry: vi.fn().mockReturnValue({}),
    buildPlannerCatalogFromCapabilities: vi.fn().mockReturnValue([]),
  };
});

vi.mock("./universal-read-tools", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./universal-read-tools")>();
  return {
    ...actual,
    executeUniversalReadTool: vi.fn().mockResolvedValue(""),
  };
});

vi.mock("./office-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./office-actions")>();
  return {
    ...actual,
    executeOfficeTool: vi.fn().mockResolvedValue(""),
  };
});

// broadcast_message executor spy — the hoisted ref is injected here so the
// factory can reference it without a temporal dead-zone error.
vi.mock("./communication-actions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./communication-actions")>();
  return {
    ...actual,
    communicationActionExecutors: {
      ...actual.communicationActionExecutors,
      broadcast_message: mockBroadcastMessageExecutor,
    },
  };
});

// callModel mock — the hoisted ref lets each test override behaviour.
vi.mock("../lib/ai-client", () => ({
  callModel: (...args: unknown[]) => mockCallModel(...args),
  callModelWithSubagent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import modules under test (after all vi.mock() calls)
// ---------------------------------------------------------------------------

import { AGENTPHONE_ACTION_TYPES, runAgentphoneTurn } from "./index";
import { ACTION_TOOLS } from "./planner-tool-catalog";

// ---------------------------------------------------------------------------
// Response builder helpers
// ---------------------------------------------------------------------------

function makeTextCompletion(text: string) {
  return {
    choices: [
      {
        message: { role: "assistant", content: text, tool_calls: undefined },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function makeToolCallCompletion(
  toolName: string,
  args: Record<string, unknown>,
) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_hallucinated",
              type: "function",
              function: { name: toolName, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

type FakeCompletion =
  | ReturnType<typeof makeTextCompletion>
  | ReturnType<typeof makeToolCallCompletion>;

function makeFakeClient(response: FakeCompletion) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(response),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: callModel returns a plain text reply so the turn finishes cleanly.
  mockCallModel.mockImplementation(
    (_model: unknown, fn: (client: unknown, model: unknown) => unknown) =>
      fn(makeFakeClient(makeTextCompletion("OK.")), "openai/gpt-4o-mini"),
  );
});

// ── 1. Static exclusion checks ───────────────────────────────────────────────

describe("AGENTPHONE_ACTION_TYPES — broadcast_message exclusion", () => {
  it("does not include broadcast_message in the restricted-channel allowlist", () => {
    // If this assertion fails, broadcast_message has been added to
    // AGENTPHONE_ACTION_TYPES (or removed from RESTRICTED_EXCLUDED_ACTION_TYPES),
    // which would allow the model to call it over SMS/voice/email and create
    // a delivery loop.
    expect(AGENTPHONE_ACTION_TYPES.has("broadcast_message")).toBe(false);
  });

  it("broadcast_message is a real action tool in ACTION_TOOLS (exclusion is deliberate, not an omission)", () => {
    // Confirms the tool exists in the full web-channel catalog.
    // If this were missing from ACTION_TOOLS too, the exclusion could mask
    // a broken executor rather than a deliberate channel restriction.
    const toolNames = ACTION_TOOLS.filter(
      (t): t is Extract<typeof t, { type: "function" }> =>
        t.type === "function",
    ).map((t) => t.function.name);

    expect(toolNames).toContain("broadcast_message");
  });

  it("every name in AGENTPHONE_ACTION_TYPES comes from ACTION_TOOLS (no invented names)", () => {
    // Integrity guard: the allowlist must be a strict subset of the full
    // catalog.  A name in AGENTPHONE_ACTION_TYPES that doesn't correspond to
    // a real tool would be dead weight and could mask a typo.
    const actionToolNames = new Set(
      ACTION_TOOLS.filter(
        (t): t is Extract<typeof t, { type: "function" }> =>
          t.type === "function",
      ).map((t) => t.function.name),
    );

    for (const name of AGENTPHONE_ACTION_TYPES) {
      expect(
        actionToolNames.has(name),
        `AGENTPHONE_ACTION_TYPES contains "${name}" but it is not in ACTION_TOOLS`,
      ).toBe(true);
    }
  });
});

// ── 2. Dynamic / route-level guard ───────────────────────────────────────────

describe("runAgentphoneTurn — broadcast_message hallucination guard", () => {
  it("does not invoke the broadcast_message executor when the model hallucinates the tool call", async () => {
    // Arrange: the model first returns a hallucinated broadcast_message call,
    // then (in the next completion round) returns a normal text reply.
    let callCount = 0;
    mockCallModel.mockImplementation(
      (_model: unknown, fn: (client: unknown, model: unknown) => unknown) => {
        callCount += 1;
        const response =
          callCount === 1
            ? makeToolCallCompletion("broadcast_message", {
                message: "Hello everyone from SMS!",
              })
            : makeTextCompletion(
                "Sorry, I can't send a broadcast from SMS — use the app.",
              );
        return fn(makeFakeClient(response), "openai/gpt-4o-mini");
      },
    );

    // Act: simulate an inbound SMS turn from a known user.
    const result = await runAgentphoneTurn({
      userId: 42,
      inputText: "broadcast a message to the whole household",
      history: [],
    });

    // Assert: the executor was never called — the hallucinated tool call was
    // silently dropped by the AGENTPHONE_ACTION_TYPES.has() gate.
    expect(mockBroadcastMessageExecutor).not.toHaveBeenCalled();

    // Assert: the turn still returns a reply (graceful degradation — the
    // ignored tool call doesn't break the conversation).
    expect(typeof result.replyText).toBe("string");
    expect(result.replyText.length).toBeGreaterThan(0);
  });

  it("does not include broadcast_message in the tools offered to the model", async () => {
    // Captures the tools array sent to the model in the completion request
    // and asserts broadcast_message is absent, so the model is never even
    // offered the tool in the first place (defence-in-depth: the execution
    // gate above is the second line of defence).
    const capturedToolNames: string[] = [];

    mockCallModel.mockImplementation(
      (_model: unknown, fn: (client: unknown, model: unknown) => unknown) => {
        const fakeClient = {
          chat: {
            completions: {
              create: vi
                .fn()
                .mockImplementation(
                  (params: {
                    tools?: Array<{ type: string; function: { name: string } }>;
                  }) => {
                    if (params.tools) {
                      capturedToolNames.push(
                        ...params.tools
                          .filter((t) => t.type === "function")
                          .map((t) => t.function.name),
                      );
                    }
                    return Promise.resolve(makeTextCompletion("OK."));
                  },
                ),
            },
          },
        };
        return fn(fakeClient, "openai/gpt-4o-mini");
      },
    );

    await runAgentphoneTurn({
      userId: 42,
      inputText: "can you broadcast something to everyone?",
      history: [],
    });

    // broadcast_message must not appear in the tools offered to the restricted
    // channel model.  If it does, the model could call it legitimately
    // (not just via hallucination) and the delivery loop would occur.
    expect(capturedToolNames).not.toContain("broadcast_message");
  });
});
