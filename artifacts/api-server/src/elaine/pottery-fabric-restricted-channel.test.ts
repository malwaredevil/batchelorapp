/**
 * End-to-end integration tests confirming that `show_pottery_item` and
 * `show_fabric_swatch` work correctly over the SMS (AgentPhone) and email
 * (Resend) restricted channels.
 *
 * Task #669 added these tools to ALL_READ_CHANNELS in the capability policy
 * and included them in RESTRICTED_SOFT_TOOL_NAMES.  The static coverage test
 * (restricted-channel-coverage.test.ts) already confirms those constants are
 * consistent.  These tests go one level deeper and verify that a real
 * restricted-channel turn:
 *
 *  1. Actually offers the tools to the model (they appear in the
 *     `tools` array sent to the completions API).
 *  2. Executes the tool when the model calls it — returning a meaningful
 *     tool-result string, NOT the channel-restriction fallback
 *     "That action isn't available over sms" / "…over email".
 *  3. Completes the turn with a non-empty reply string (the model can still
 *     generate a final answer after the tool result).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted refs — created before vi.mock() factories run so factories can
// reference them without temporal dead-zone errors.
// ---------------------------------------------------------------------------

const { mockDbSelect, mockCallModel, passthrough } = vi.hoisted(() => {
  // Recursive chainable builder — resolves to [] when awaited so that all the
  // context-building selects (trips, reminders, memories …) get an empty
  // household without touching a real database.  Tests that need a real row
  // returned from a specific select call set `nextSelectResult` immediately
  // before calling `runAgentphoneTurn` / `runElaineEmailTurn`.
  function makeChain(result: unknown[]): unknown {
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
      // Each chained method receives the same result so every chain link
      // ultimately resolves to the same value.
      handler[m] = vi.fn(() => makeChain(result));
    }
    handler.then = (resolve: (v: unknown[]) => void) => {
      resolve(result);
      return Promise.resolve(result);
    };
    handler.catch = (_fn: unknown) => Promise.resolve(result);
    return handler;
  }

  // Queue consumed one-per-select call.  When empty all selects resolve to [].
  const selectQueue: unknown[][] = [];

  const mockDbSelect = vi.fn(() => {
    const result = selectQueue.length > 0 ? selectQueue.shift()! : [];
    return makeChain(result);
  });

  const passthrough = (_r: unknown, _s: unknown, next: () => void) => next();

  return {
    mockDbSelect,
    mockCallModel: vi.fn(),
    passthrough,
    /** Push rows to return on the NEXT db.select() call (FIFO). */
    queueSelectResult: (rows: unknown[]) => selectQueue.push(rows),
    /** Drain remaining queued items (call in beforeEach). */
    drainSelectQueue: () => {
      selectQueue.length = 0;
    },
  };
});

// Re-export the queue helpers with proper module-level access via the hoisted
// mock's closure.  (vi.hoisted returns are available at the module top level.)

// ---------------------------------------------------------------------------
// Module mocks
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
// ./runtime/tool-families — mock it to prevent the startup family-coverage throw.
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

vi.mock("./communication-actions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./communication-actions")>();
  return {
    ...actual,
    communicationActionExecutors: {
      ...actual.communicationActionExecutors,
    },
  };
});

vi.mock("../lib/ai-client", () => ({
  callModel: (...args: unknown[]) => mockCallModel(...args),
  callModelWithSubagent: vi.fn(),
  HIDDEN_REASONING: { reasoning: { enabled: true, exclude: true } },
}));

// Supabase signed-URL calls inside show_pottery_item / show_fabric_swatch are
// non-fatal (the catch block swallows errors). We mock the client so tests
// don't need real credentials and the signed URL path is exercised without I/O.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi
          .fn()
          .mockResolvedValue({ data: { signedUrl: "https://mock-url/img" } }),
      })),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Import modules under test (after all vi.mock() calls)
// ---------------------------------------------------------------------------

import { runAgentphoneTurn, runElaineEmailTurn } from "./index";

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
              id: "call_test_001",
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
// Test fixtures — minimal pottery and fabric rows matching what the DB
// executor selects.
// ---------------------------------------------------------------------------

const POTTERY_ROW = {
  id: 42,
  name: "Blue Celadon Vase",
  maker: "Studio Kiln",
  style: "celadon",
  imagePath: "pottery/items/42/main.jpg",
  aiDescription: "A tall celadon-glazed vase with a crackle finish.",
  dominantColors: ["blue", "grey"],
};

const FABRIC_ROW = {
  id: 7,
  name: "Indigo Stripe",
  manufacturer: "Moda Fabrics",
  designer: "Zen Chic",
  dominantColors: ["indigo", "white"],
  imagePath: "quilting/fabrics/7/swatch.jpg",
  aiDescription: "Deep indigo stripes on a white cotton background.",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Build a fully chainable Drizzle-style select mock that resolves to `result`. */
function makeSelectChain(result: unknown[] = []): unknown {
  const h: Record<string, unknown> = {};
  for (const m of [
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
  ]) {
    h[m] = vi.fn(() => makeSelectChain(result));
  }
  h.then = (resolve: (v: unknown[]) => void) => {
    resolve(result);
    return Promise.resolve(result);
  };
  h.catch = (_fn: unknown) => Promise.resolve(result);
  return h;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: callModel returns a plain-text reply so the turn finishes cleanly.
  mockCallModel.mockImplementation(
    (_model: unknown, fn: (client: unknown, model: unknown) => unknown) =>
      fn(makeFakeClient(makeTextCompletion("OK.")), "openai/gpt-4o-mini"),
  );
  // Default: all db.select() calls resolve to [] (empty household context).
  // Individual tests override this when they need a specific row returned.
  mockDbSelect.mockImplementation(() => makeSelectChain([]));
});

// ---------------------------------------------------------------------------
// Helper: make callModel simulate one tool call round then a text reply
// ---------------------------------------------------------------------------

function simulateToolCallRound(
  toolName: string,
  args: Record<string, unknown>,
  finalReply = "Here is what I found.",
): {
  capturedToolResults: Array<{ name: string; content: string }>;
  capturedToolNames: string[];
} {
  const capturedToolResults: Array<{ name: string; content: string }> = [];
  const capturedToolNames: string[] = [];
  let round = 0;

  mockCallModel.mockImplementation(
    (_model: unknown, fn: (client: unknown, model: unknown) => unknown) => {
      round += 1;
      if (round === 1) {
        // Round 1: model "decides" to call the tool.
        // Also capture the tools array to verify the tool is offered.
        const fakeClient = {
          chat: {
            completions: {
              create: vi.fn().mockImplementation(
                (params: {
                  tools?: Array<{ type: string; function: { name: string } }>;
                  messages?: Array<{
                    role: string;
                    content?: string | null;
                    tool_call_id?: string;
                    name?: string;
                  }>;
                }) => {
                  if (params.tools) {
                    capturedToolNames.push(
                      ...params.tools
                        .filter((t) => t.type === "function")
                        .map((t) => t.function.name),
                    );
                  }
                  return Promise.resolve(
                    makeToolCallCompletion(toolName, args),
                  );
                },
              ),
            },
          },
        };
        return fn(fakeClient, "openai/gpt-4o-mini");
      } else {
        // Round 2+: capture the tool-result message, then return final text.
        const fakeClient = {
          chat: {
            completions: {
              create: vi.fn().mockImplementation(
                (params: {
                  messages?: Array<{
                    role: string;
                    content?: string | null;
                    tool_call_id?: string;
                    name?: string;
                  }>;
                }) => {
                  // Find tool result messages in this round's messages.
                  const toolResults = (params.messages ?? []).filter(
                    (m) => m.role === "tool",
                  );
                  for (const tr of toolResults) {
                    capturedToolResults.push({
                      name: tr.name ?? toolName,
                      content: tr.content ?? "",
                    });
                  }
                  return Promise.resolve(makeTextCompletion(finalReply));
                },
              ),
            },
          },
        };
        return fn(fakeClient, "openai/gpt-4o-mini");
      }
    },
  );

  return { capturedToolResults, capturedToolNames };
}

// ---------------------------------------------------------------------------
// Tests: SMS channel (runAgentphoneTurn)
// ---------------------------------------------------------------------------

describe("SMS channel — show_pottery_item", () => {
  it("includes show_pottery_item in the tools offered to the model", async () => {
    const { capturedToolNames } = simulateToolCallRound("show_pottery_item", {
      itemId: POTTERY_ROW.id,
    });

    await runAgentphoneTurn({
      userId: 1,
      inputText: "show me pottery item 42",
      history: [],
    });

    expect(capturedToolNames).toContain("show_pottery_item");
  });

  it("executes show_pottery_item and returns a pottery-specific result, not a channel-restriction error", async () => {
    // Override db.select() to return the pottery row on every call.
    // Context-building selects (trips, reminders, users) also receive the
    // pottery row, but they only use results for string formatting and won't
    // throw if the columns don't match — they just render empty fields.
    mockDbSelect.mockImplementation(() => makeSelectChain([POTTERY_ROW]));

    const { capturedToolResults } = simulateToolCallRound(
      "show_pottery_item",
      { itemId: POTTERY_ROW.id },
      `Here is your pottery piece: ${POTTERY_ROW.name}.`,
    );

    const result = await runAgentphoneTurn({
      userId: 1,
      inputText: "tell me about pottery item 42",
      history: [],
    });

    // The turn must return a real reply (not empty, not an error string).
    expect(typeof result.replyText).toBe("string");
    expect(result.replyText.length).toBeGreaterThan(0);

    // The tool-result content must NOT be the channel-restriction fallback.
    const toolResult = capturedToolResults.find(
      (r) => r.content.includes("pottery") || r.content.includes("Pottery"),
    );
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    // The executor sets resultText to "Pottery item card shown for '${name}'."
    // when a row is found, confirming the full happy path was exercised.
    expect(toolResult!.content).toContain("Pottery item card shown for");
    expect(toolResult!.content).toContain(POTTERY_ROW.name);
  });
});

describe("SMS channel — show_fabric_swatch", () => {
  it("includes show_fabric_swatch in the tools offered to the model", async () => {
    const { capturedToolNames } = simulateToolCallRound("show_fabric_swatch", {
      fabricId: FABRIC_ROW.id,
    });

    await runAgentphoneTurn({
      userId: 1,
      inputText: "show me fabric 7",
      history: [],
    });

    expect(capturedToolNames).toContain("show_fabric_swatch");
  });

  it("executes show_fabric_swatch and returns a fabric-specific result, not a channel-restriction error", async () => {
    mockDbSelect.mockImplementation(() => makeSelectChain([FABRIC_ROW]));

    const { capturedToolResults } = simulateToolCallRound(
      "show_fabric_swatch",
      { fabricId: FABRIC_ROW.id },
      `Here is your fabric: ${FABRIC_ROW.name}.`,
    );

    const result = await runAgentphoneTurn({
      userId: 1,
      inputText: "what does fabric 7 look like?",
      history: [],
    });

    expect(typeof result.replyText).toBe("string");
    expect(result.replyText.length).toBeGreaterThan(0);

    const toolResult = capturedToolResults.find(
      (r) => r.content.includes("fabric") || r.content.includes("Fabric"),
    );
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    // The executor sets resultText to "Fabric swatch card shown for '${name}'."
    // when a row is found.
    expect(toolResult!.content).toContain("Fabric swatch card shown for");
    expect(toolResult!.content).toContain(FABRIC_ROW.name);
  });
});

// ---------------------------------------------------------------------------
// Tests: Email channel (runElaineEmailTurn)
// ---------------------------------------------------------------------------

describe("Email channel — show_pottery_item", () => {
  it("includes show_pottery_item in the tools offered to the model over email", async () => {
    const { capturedToolNames } = simulateToolCallRound("show_pottery_item", {
      itemId: POTTERY_ROW.id,
    });

    await runElaineEmailTurn({
      userId: 1,
      inputText: "show me pottery item 42",
      history: [],
    });

    expect(capturedToolNames).toContain("show_pottery_item");
  });

  it("executes show_pottery_item over email and returns a pottery result, not a channel-restriction error", async () => {
    mockDbSelect.mockImplementation(() => makeSelectChain([POTTERY_ROW]));

    const { capturedToolResults } = simulateToolCallRound(
      "show_pottery_item",
      { itemId: POTTERY_ROW.id },
      `Here is the pottery piece you asked about: ${POTTERY_ROW.name}.`,
    );

    const result = await runElaineEmailTurn({
      userId: 1,
      inputText: "tell me about pottery item 42",
      history: [],
    });

    expect(typeof result.replyText).toBe("string");
    expect(result.replyText.length).toBeGreaterThan(0);

    const toolResult = capturedToolResults.find(
      (r) => r.content.includes("pottery") || r.content.includes("Pottery"),
    );
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    expect(toolResult!.content).toContain("Pottery item card shown for");
    expect(toolResult!.content).toContain(POTTERY_ROW.name);
  });
});

describe("Email channel — show_fabric_swatch", () => {
  it("includes show_fabric_swatch in the tools offered to the model over email", async () => {
    const { capturedToolNames } = simulateToolCallRound("show_fabric_swatch", {
      fabricId: FABRIC_ROW.id,
    });

    await runElaineEmailTurn({
      userId: 1,

      inputText: "show me fabric 7",
      history: [],
    });

    expect(capturedToolNames).toContain("show_fabric_swatch");
  });

  it("executes show_fabric_swatch over email and returns a fabric result, not a channel-restriction error", async () => {
    mockDbSelect.mockImplementation(() => makeSelectChain([FABRIC_ROW]));

    const { capturedToolResults } = simulateToolCallRound(
      "show_fabric_swatch",
      { fabricId: FABRIC_ROW.id },
      `Here is the fabric you asked about: ${FABRIC_ROW.name}.`,
    );

    const result = await runElaineEmailTurn({
      userId: 1,

      inputText: "what does fabric 7 look like?",
      history: [],
    });

    expect(typeof result.replyText).toBe("string");
    expect(result.replyText.length).toBeGreaterThan(0);

    const toolResult = capturedToolResults.find(
      (r) => r.content.includes("fabric") || r.content.includes("Fabric"),
    );
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    expect(toolResult!.content).toContain("Fabric swatch card shown for");
    expect(toolResult!.content).toContain(FABRIC_ROW.name);
  });
});

// Tests: SMS channel (runAgentphoneTurn) — calculate_yardage
// ---------------------------------------------------------------------------

describe("SMS channel — calculate_yardage", () => {
  it("includes calculate_yardage in the tools offered to the model", async () => {
    const { capturedToolNames } = simulateToolCallRound("calculate_yardage", {
      quiltWidthInches: 90,
      quiltHeightInches: 108,
      fabricWidthInches: 44,
      bindingStripWidthInches: 2.5,
    });

    await runAgentphoneTurn({
      userId: 1,
      inputText:
        "how many yards do I need for a queen quilt at 44-inch fabric width?",
      history: [],
    });

    expect(capturedToolNames).toContain("calculate_yardage");
  });

  it("executes calculate_yardage and returns a numeric yardage result, not a channel-restriction error", async () => {
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 90,
        quiltHeightInches: 108,
        fabricWidthInches: 44,
        bindingStripWidthInches: 2.5,
      },
      "You will need approximately 9.75 yards of backing fabric.",
    );

    const result = await runAgentphoneTurn({
      userId: 1,
      inputText:
        "how many yards do I need for a queen quilt at 44-inch fabric width?",
      history: [],
    });

    // The turn must return a real reply string.
    expect(typeof result.replyText).toBe("string");
    expect(result.replyText.length).toBeGreaterThan(0);

    // The tool-result content must contain "yards" (a numeric answer) and must
    // NOT be the channel-restriction fallback message.
    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    // The executor always includes the word "yards" in a successful result.
    expect(toolResult.content).toMatch(/yards/i);
    // Confirm it contains an actual number (e.g. "9.75 yards").
    expect(toolResult.content).toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it('returns exact known-good values for a twin (60x80") quilt over SMS', async () => {
    // Twin 60×80" with 40" default bolt width:
    //   Backing: 2 panels × 88" = 176" → roundUpToEighth(176/36) = 5 yards
    //   Binding: 2×(60+80)+15 = 295" → 8 strips × 2.5" = 20" → roundUpToEighth(20/36) = 0.625 yards
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
      },
      "You will need 5 yards of backing and 0.625 yards of binding.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "how much backing and binding do I need for a twin quilt?",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];
    // Must not be a channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    // Backing: exactly 5 yards.
    expect(toolResult.content).toMatch(
      /backing.*5\s*yards|5\s*yards.*backing/i,
    );
    // Binding: exactly 0.625 yards.
    expect(toolResult.content).toMatch(
      /binding.*0\.625\s*yards|0\.625\s*yards.*binding/i,
    );
  });

  it('returns exact known-good values for a baby/wall-hanging (24x36") quilt over SMS — single-panel backing branch', async () => {
    // Baby 24×36" with 40" default bolt width:
    //   Backing: backingWidth = 24+8 = 32" ≤ 40" → 1 panel (single-panel branch)
    //            backingLength = (36+8) × 1 = 44" → roundUpToEighth(44/36) = 1.25 yards
    //   Binding: 2×(24+36)+15 = 135" → ceil(135/40) = 4 strips × 2.5" = 10"
    //            → roundUpToEighth(10/36) = 0.375 yards
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 24,
        quiltHeightInches: 36,
      },
      "You will need 1.25 yards of backing and 0.375 yards of binding.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText:
        "how much backing and binding do I need for a 24 by 36 inch baby quilt?",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];
    // Must not be a channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    // Single-panel backing: exactly 1.25 yards.
    expect(toolResult.content).toMatch(
      /backing.*1\.25\s*yards|1\.25\s*yards.*backing/i,
    );
    // Binding: exactly 0.375 yards.
    expect(toolResult.content).toMatch(
      /binding.*0\.375\s*yards|0\.375\s*yards.*binding/i,
    );
  });

  it('returns exact known-good values for a queen (90x108") quilt with 60" wide backing fabric over SMS', async () => {
    // Queen 90×108" with 60" wide bolt (wide-format backing fabric):
    //   Backing: backingWidthNeeded = 90+8 = 98" > 60" → ceil(98/60) = 2 panels
    //            (Compare: at 40" default this would be ceil(98/40) = 3 panels)
    //            backingLength = (108+8) × 2 = 232" → roundUpToEighth(232/36) = 6.5 yards
    //   Binding: 2×(90+108)+15 = 411" → ceil(411/60) = 7 strips × 2.5" = 17.5"
    //            → roundUpToEighth(17.5/36) = 0.5 yards
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 90,
        quiltHeightInches: 108,
        fabricWidthInches: 60,
        bindingStripWidthInches: 2.5,
      },
      "You will need 6.5 yards of backing and 0.5 yards of binding.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText:
        "how much wide backing and binding do I need for a queen quilt using 60-inch fabric?",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];
    // Must not be a channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    // With 60" wide fabric the queen quilt backing needs exactly 2 panels
    // (vs 3 panels at the 40" default) — confirmed in the tool-result string.
    expect(toolResult.content).toMatch(/2\s*panels?/i);
    // Backing: exactly 6.5 yards (saved vs the 9.75 yards needed at 40" wide).
    expect(toolResult.content).toMatch(
      /backing.*6\.5\s*yards|6\.5\s*yards.*backing/i,
    );
    // Binding: exactly 0.5 yards.
    expect(toolResult.content).toMatch(
      /binding.*0\.5\s*yards|0\.5\s*yards.*binding/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: Email channel (runElaineEmailTurn) — calculate_yardage
// ---------------------------------------------------------------------------

describe("Email channel — calculate_yardage", () => {
  it("includes calculate_yardage in the tools offered to the model over email", async () => {
    const { capturedToolNames } = simulateToolCallRound("calculate_yardage", {
      quiltWidthInches: 90,
      quiltHeightInches: 108,
      fabricWidthInches: 44,
      bindingStripWidthInches: 2.5,
    });

    await runElaineEmailTurn({
      userId: 1,
      inputText:
        "how many yards do I need for a queen quilt at 44-inch fabric width?",
      history: [],
    });

    expect(capturedToolNames).toContain("calculate_yardage");
  });

  it("executes calculate_yardage over email and returns a numeric yardage result, not a channel-restriction error", async () => {
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 90,
        quiltHeightInches: 108,
        fabricWidthInches: 44,
        bindingStripWidthInches: 2.5,
      },
      "You will need approximately 9.75 yards of backing fabric.",
    );

    const result = await runElaineEmailTurn({
      userId: 1,
      inputText:
        "how many yards do I need for a queen quilt at 44-inch fabric width?",
      history: [],
    });

    // The turn must return a real reply string.
    expect(typeof result.replyText).toBe("string");
    expect(result.replyText.length).toBeGreaterThan(0);

    // The tool-result content must contain "yards" and must NOT be a
    // channel-restriction fallback.
    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    expect(toolResult.content).toMatch(/yards/i);
    expect(toolResult.content).toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it('returns exact known-good values for a twin (60x80") quilt over email', async () => {
    // Same math as the SMS path — both call sites delegate to the shared
    // calculateYardage() helper so results must be identical.
    // Twin 60×80" with 40" default bolt width:
    //   Backing: 2 panels × 88" = 176" → roundUpToEighth(176/36) = 5 yards
    //   Binding: 2×(60+80)+15 = 295" → 8 strips × 2.5" = 20" → roundUpToEighth(20/36) = 0.625 yards
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
      },
      "You will need 5 yards of backing and 0.625 yards of binding.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText: "how much backing and binding do I need for a twin quilt?",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];
    // Must not be a channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    // Backing: exactly 5 yards — same as the SMS code path.
    expect(toolResult.content).toMatch(
      /backing.*5\s*yards|5\s*yards.*backing/i,
    );
    // Binding: exactly 0.625 yards — same as the SMS code path.
    expect(toolResult.content).toMatch(
      /binding.*0\.625\s*yards|0\.625\s*yards.*binding/i,
    );
  });

  it('returns exact known-good values for a baby/wall-hanging (24x36") quilt over email — single-panel backing branch', async () => {
    // Same math as the SMS path — both call sites delegate to the shared
    // calculateYardage() helper so results must be identical.
    // Baby 24×36" with 40" default bolt width:
    //   Backing: backingWidth = 24+8 = 32" ≤ 40" → 1 panel (single-panel branch)
    //            backingLength = (36+8) × 1 = 44" → roundUpToEighth(44/36) = 1.25 yards
    //   Binding: 2×(24+36)+15 = 135" → ceil(135/40) = 4 strips × 2.5" = 10"
    //            → roundUpToEighth(10/36) = 0.375 yards
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 24,
        quiltHeightInches: 36,
      },
      "You will need 1.25 yards of backing and 0.375 yards of binding.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText:
        "how much backing and binding do I need for a 24 by 36 inch baby quilt?",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];
    // Must not be a channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    // Single-panel backing: exactly 1.25 yards — same as the SMS code path.
    expect(toolResult.content).toMatch(
      /backing.*1\.25\s*yards|1\.25\s*yards.*backing/i,
    );
    // Binding: exactly 0.375 yards — same as the SMS code path.
    expect(toolResult.content).toMatch(
      /binding.*0\.375\s*yards|0\.375\s*yards.*binding/i,
    );
  });

  it('returns exact known-good values for a queen (90x108") quilt with 60" wide backing fabric over email', async () => {
    // Queen 90×108" with 60" wide bolt (wide-format backing fabric):
    //   Backing: backingWidthNeeded = 90+8 = 98" > 60" → ceil(98/60) = 2 panels
    //            (Compare: at 40" default this would be ceil(98/40) = 3 panels)
    //            backingLength = (108+8) × 2 = 232" → roundUpToEighth(232/36) = 6.5 yards
    //   Binding: 2×(90+108)+15 = 411" → ceil(411/60) = 7 strips × 2.5" = 17.5"
    //            → roundUpToEighth(17.5/36) = 0.5 yards
    // Same math as the SMS path — both call sites delegate to the shared
    // calculateYardage() helper so results must be identical.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 90,
        quiltHeightInches: 108,
        fabricWidthInches: 60,
        bindingStripWidthInches: 2.5,
      },
      "You will need 6.5 yards of backing and 0.5 yards of binding.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText:
        "how much wide backing and binding do I need for a queen quilt using 60-inch fabric?",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];
    // Must not be a channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    // With 60" wide fabric the queen quilt backing needs exactly 2 panels
    // (vs 3 panels at the 40" default) — confirmed in the tool-result string.
    expect(toolResult.content).toMatch(/2\s*panels?/i);
    // Backing: exactly 6.5 yards (saved vs the 9.75 yards needed at 40" wide).
    expect(toolResult.content).toMatch(
      /backing.*6\.5\s*yards|6\.5\s*yards.*backing/i,
    );
    // Binding: exactly 0.5 yards.
    expect(toolResult.content).toMatch(
      /binding.*0\.5\s*yards|0\.5\s*yards.*binding/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Fixture — minimal ornament row matching what the DB executor selects.
// ---------------------------------------------------------------------------

const ORNAMENT_ROW = {
  id: 15,
  name: "Hallmark 1991 Polar Bear",
  seriesOrCollection: "Polar Classics",
  year: 1991,
  brand: "Hallmark",
  imagePath: "ornaments/items/15/main.jpg",
  aiDescription: "A white polar bear ornament with a red scarf.",
  dominantColors: ["white", "red"],
};

// ---------------------------------------------------------------------------
// Tests: SMS channel (runAgentphoneTurn) — show_ornament_item
// ---------------------------------------------------------------------------

describe("SMS channel — show_ornament_item", () => {
  it("includes show_ornament_item in the tools offered to the model", async () => {
    const { capturedToolNames } = simulateToolCallRound("show_ornament_item", {
      itemId: ORNAMENT_ROW.id,
    });

    await runAgentphoneTurn({
      userId: 1,
      inputText: "show me ornament 15",
      history: [],
    });

    expect(capturedToolNames).toContain("show_ornament_item");
  });

  it("executes show_ornament_item and returns an ornament-specific result, not a channel-restriction error", async () => {
    mockDbSelect.mockImplementation(() => makeSelectChain([ORNAMENT_ROW]));

    const { capturedToolResults } = simulateToolCallRound(
      "show_ornament_item",
      { itemId: ORNAMENT_ROW.id },
      `Here is your ornament: ${ORNAMENT_ROW.name}.`,
    );

    const result = await runAgentphoneTurn({
      userId: 1,
      inputText: "tell me about ornament 15",
      history: [],
    });

    expect(typeof result.replyText).toBe("string");
    expect(result.replyText.length).toBeGreaterThan(0);

    const toolResult = capturedToolResults.find(
      (r) => r.content.includes("ornament") || r.content.includes("Ornament"),
    );
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    // The executor sets resultText to `Ornament card shown for "${name}".`
    // when a row is found, confirming the full happy path was exercised.
    expect(toolResult!.content).toContain("Ornament card shown for");
    expect(toolResult!.content).toContain(ORNAMENT_ROW.name);
  });
});

// ---------------------------------------------------------------------------
// Tests: Email channel (runElaineEmailTurn) — show_ornament_item
// ---------------------------------------------------------------------------

describe("Email channel — show_ornament_item", () => {
  it("includes show_ornament_item in the tools offered to the model over email", async () => {
    const { capturedToolNames } = simulateToolCallRound("show_ornament_item", {
      itemId: ORNAMENT_ROW.id,
    });

    await runElaineEmailTurn({
      userId: 1,
      inputText: "show me ornament 15",
      history: [],
    });

    expect(capturedToolNames).toContain("show_ornament_item");
  });

  it("executes show_ornament_item over email and returns an ornament result, not a channel-restriction error", async () => {
    mockDbSelect.mockImplementation(() => makeSelectChain([ORNAMENT_ROW]));

    const { capturedToolResults } = simulateToolCallRound(
      "show_ornament_item",
      { itemId: ORNAMENT_ROW.id },
      `Here is the ornament you asked about: ${ORNAMENT_ROW.name}.`,
    );

    const result = await runElaineEmailTurn({
      userId: 1,
      inputText: "tell me about ornament 15",
      history: [],
    });

    expect(typeof result.replyText).toBe("string");
    expect(result.replyText.length).toBeGreaterThan(0);

    const toolResult = capturedToolResults.find(
      (r) => r.content.includes("ornament") || r.content.includes("Ornament"),
    );
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    expect(toolResult!.content).toContain("Ornament card shown for");
    expect(toolResult!.content).toContain(ORNAMENT_ROW.name);
  });
});

// ---------------------------------------------------------------------------
// Tests: SMS channel (runAgentphoneTurn) — suggest_clothing_layers
// ---------------------------------------------------------------------------

describe("SMS channel — suggest_clothing_layers", () => {
  it("includes suggest_clothing_layers in the tools offered to the model", async () => {
    const { capturedToolNames } = simulateToolCallRound(
      "suggest_clothing_layers",
      {
        destination: "Paris, France",
        startDate: "2026-10-01",
        endDate: "2026-10-10",
      },
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "what should I pack for my Paris trip in October?",
      history: [],
    });

    expect(capturedToolNames).toContain("suggest_clothing_layers");
  });

  it("executes suggest_clothing_layers and returns clothing-layer content, not a channel-restriction error", async () => {
    // This is the text the mocked internal callModel returns as clothing advice.
    // The restricted-channel executor calls callModel once internally to generate
    // the advice, then feeds that text back as the tool result.  simulateToolCallRound
    // uses round-counting: round 1 = main model calls the tool, round 2 = executor's
    // internal callModel returning this advice text, round 3 = main model receives
    // the tool result and returns the final reply (also this text, which is fine for
    // a unit test).
    const CLOTHING_ADVICE =
      "Base layers: moisture-wicking shirts.\nMid layers: light fleece.\nOuter layers: waterproof jacket.";

    const { capturedToolResults } = simulateToolCallRound(
      "suggest_clothing_layers",
      {
        destination: "Paris, France",
        startDate: "2026-10-01",
        endDate: "2026-10-10",
      },
      CLOTHING_ADVICE,
    );

    const result = await runAgentphoneTurn({
      userId: 1,
      inputText: "what should I pack for my Paris trip in October?",
      history: [],
    });

    expect(typeof result.replyText).toBe("string");
    expect(result.replyText.length).toBeGreaterThan(0);

    // The executor must have run — tool results are captured from the round
    // where the main loop sends the tool result back to the model.
    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must contain the advice produced by the internal callModel.
    expect(toolResult.content).toMatch(
      /layer|packing|jacket|fleece|base|mid|outer/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: Email channel (runElaineEmailTurn) — suggest_clothing_layers
// ---------------------------------------------------------------------------

describe("Email channel — suggest_clothing_layers", () => {
  it("includes suggest_clothing_layers in the tools offered to the model over email", async () => {
    const { capturedToolNames } = simulateToolCallRound(
      "suggest_clothing_layers",
      {
        destination: "Paris, France",
        startDate: "2026-10-01",
        endDate: "2026-10-10",
      },
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText: "what should I pack for my Paris trip in October?",
      history: [],
    });

    expect(capturedToolNames).toContain("suggest_clothing_layers");
  });

  it("executes suggest_clothing_layers over email and returns clothing-layer content, not a channel-restriction error", async () => {
    const CLOTHING_ADVICE =
      "Base layers: moisture-wicking shirts.\nMid layers: light fleece.\nOuter layers: waterproof jacket.";

    const { capturedToolResults } = simulateToolCallRound(
      "suggest_clothing_layers",
      {
        destination: "Paris, France",
        startDate: "2026-10-01",
        endDate: "2026-10-10",
      },
      CLOTHING_ADVICE,
    );

    const result = await runElaineEmailTurn({
      userId: 1,
      inputText: "what should I pack for my Paris trip in October?",
      history: [],
    });

    expect(typeof result.replyText).toBe("string");
    expect(result.replyText.length).toBeGreaterThan(0);

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must contain the advice produced by the internal callModel.
    expect(toolResult.content).toMatch(
      /layer|packing|jacket|fleece|base|mid|outer/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: calculate_yardage — nonsense input validation (zero / negative dims)
// ---------------------------------------------------------------------------

describe("SMS channel — calculate_yardage rejects zero/negative dimensions", () => {
  it("returns a validation-error message (not a channel-restriction error) when quiltWidthInches is 0 over SMS", async () => {
    // The Zod schema uses .positive() on both dimension fields, so width=0 fails
    // safeParse and the executor returns "Invalid quilt dimensions — ask the
    // user to clarify." rather than a garbage numeric answer.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 0,
        quiltHeightInches: 60,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "how much backing do I need for a 0-inch-wide quilt?",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message — not a numeric yardage answer.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number (i.e. the math must NOT
    // have run on the zero-width input).
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message (not a channel-restriction error) when quiltHeightInches is negative over SMS", async () => {
    // Negative height is also rejected by the .positive() Zod constraint.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: -20,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "backing for a quilt with negative height please",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });
});

describe("Email channel — calculate_yardage rejects zero/negative dimensions", () => {
  it("returns a validation-error message (not a channel-restriction error) when quiltWidthInches is negative over email", async () => {
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: -5,
        quiltHeightInches: 80,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText: "how much backing for a -5 inch wide quilt?",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message (not a channel-restriction error) when quiltHeightInches is 0 over email", async () => {
    // Both width=0 and height=0 are rejected by the .positive() Zod constraint.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 0,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText: "yardage estimate for a 60 by 0 inch quilt",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: calculate_yardage — nonsense fabric-width / binding-strip-width inputs
// ---------------------------------------------------------------------------

describe("SMS channel — calculate_yardage rejects nonsense fabric-width and binding-strip-width inputs", () => {
  it("returns a validation-error message when fabricWidthInches is 0 over SMS", async () => {
    // .positive() rejects 0 — the executor returns an "Invalid quilt dimensions"
    // message instead of running the yardage math.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: 0,
        bindingStripWidthInches: 2.5,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "how much fabric do I need if the fabric width is 0 inches?",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message when fabricWidthInches is -10 (negative) over SMS", async () => {
    // .positive() rejects negative values — the executor returns an "Invalid quilt
    // dimensions" message instead of running the yardage math.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: -10,
        bindingStripWidthInches: 2.5,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "yardage with fabric width of negative 10 inches",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message when fabricWidthInches is 200 (above max 120) over SMS", async () => {
    // .max(120) rejects 200 — the executor returns an "Invalid quilt dimensions"
    // message instead of running the yardage math.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: 200,
        bindingStripWidthInches: 2.5,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "calculate yardage with 200-inch-wide fabric",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message when bindingStripWidthInches is -1 over SMS", async () => {
    // .positive() rejects negative values — the executor returns an "Invalid quilt
    // dimensions" message instead of running the yardage math.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: 44,
        bindingStripWidthInches: -1,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "yardage for a quilt with binding strip width of -1 inch",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message when bindingStripWidthInches is 0 over SMS", async () => {
    // .positive() rejects zero — the executor returns an "Invalid quilt dimensions"
    // message instead of running the yardage math.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: 44,
        bindingStripWidthInches: 0,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "yardage for a quilt with 0-inch binding strip",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message when bindingStripWidthInches is 15 (above max 12) over SMS", async () => {
    // .max(12) rejects 15 — the executor returns an "Invalid quilt dimensions"
    // message instead of running the yardage math.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: 44,
        bindingStripWidthInches: 15,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "yardage with a 15-inch-wide binding strip",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });
});

describe("Email channel — calculate_yardage rejects nonsense fabric-width and binding-strip-width inputs", () => {
  it("returns a validation-error message when fabricWidthInches is 0 over email", async () => {
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: 0,
        bindingStripWidthInches: 2.5,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText: "how much fabric with 0-inch fabric width?",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message when fabricWidthInches is -10 (negative) over email", async () => {
    // .positive() rejects negative values — the executor returns an "Invalid quilt
    // dimensions" message instead of running the yardage math.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: -10,
        bindingStripWidthInches: 2.5,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText: "yardage with fabric width of negative 10 inches please",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message when fabricWidthInches is 200 (above max 120) over email", async () => {
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: 200,
        bindingStripWidthInches: 2.5,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText: "estimate yardage using 200-inch-wide fabric please",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message when bindingStripWidthInches is -1 over email", async () => {
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: 44,
        bindingStripWidthInches: -1,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText: "yardage estimate with binding strip width -1",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message when bindingStripWidthInches is 0 over email", async () => {
    // .positive() rejects zero — the executor returns an "Invalid quilt dimensions"
    // message instead of running the yardage math.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: 44,
        bindingStripWidthInches: 0,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText: "yardage for a quilt with 0-inch binding strip width",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });

  it("returns a validation-error message when bindingStripWidthInches is 15 (above max 12) over email", async () => {
    // .max(12) rejects 15 — the executor returns an "Invalid quilt dimensions"
    // message instead of running the yardage math.
    const { capturedToolResults } = simulateToolCallRound(
      "calculate_yardage",
      {
        quiltWidthInches: 60,
        quiltHeightInches: 80,
        fabricWidthInches: 44,
        bindingStripWidthInches: 15,
      },
      "I need valid quilt dimensions to calculate yardage.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText: "estimate yardage with a 15-inch-wide binding strip",
      history: [],
    });

    expect(capturedToolResults.length).toBeGreaterThan(0);
    const toolResult = capturedToolResults[0];

    // Must NOT be the channel-restriction fallback.
    expect(toolResult.content).not.toMatch(
      /isn't available over|not available over/i,
    );

    // Must be a validation / clarification message.
    expect(toolResult.content).toMatch(/invalid|clarify|dimensions/i);

    // Must NOT contain a sensible-looking yardage number.
    expect(toolResult.content).not.toMatch(/\d+(\.\d+)?\s*yards/i);
  });
});

// ---------------------------------------------------------------------------
// Guard: "not found" case still does NOT produce a channel-restriction error
// ---------------------------------------------------------------------------

describe("Empty-DB fallback — tools still execute (item not found ≠ channel blocked)", () => {
  it("show_pottery_item over SMS returns 'not found' not 'not available over sms' when DB is empty", async () => {
    // The beforeEach default already sets mockDbSelect to return [] — no override needed.

    const { capturedToolResults } = simulateToolCallRound(
      "show_pottery_item",
      { itemId: 9999 },
      "I couldn't find that pottery piece.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "show pottery item 9999",
      history: [],
    });

    const toolResult = capturedToolResults.find(
      (r) => r.content.includes("Pottery") || r.content.includes("pottery"),
    );
    expect(toolResult).toBeDefined();
    // "Pottery item #9999 not found." — meaningful, not a channel restriction.
    expect(toolResult!.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    expect(toolResult!.content).toMatch(
      /#?9999.*(not found)|not found.*#?9999/i,
    );
  });

  it("show_fabric_swatch over email returns 'not found' not 'not available over email' when DB is empty", async () => {
    // The beforeEach default already sets mockDbSelect to return [] — no override needed.

    const { capturedToolResults } = simulateToolCallRound(
      "show_fabric_swatch",
      { fabricId: 9999 },
      "I couldn't find that fabric.",
    );

    await runElaineEmailTurn({
      userId: 1,

      inputText: "show fabric 9999",
      history: [],
    });

    const toolResult = capturedToolResults.find(
      (r) => r.content.includes("Fabric") || r.content.includes("fabric"),
    );
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    expect(toolResult!.content).toMatch(
      /#?9999.*(not found)|not found.*#?9999/i,
    );
  });

  it("show_ornament_item over SMS returns 'not found' not 'not available over sms' when DB is empty", async () => {
    // The beforeEach default already sets mockDbSelect to return [] — no override needed.

    const { capturedToolResults } = simulateToolCallRound(
      "show_ornament_item",
      { itemId: 9999 },
      "I couldn't find that ornament.",
    );

    await runAgentphoneTurn({
      userId: 1,
      inputText: "show ornament 9999",
      history: [],
    });

    const toolResult = capturedToolResults.find(
      (r) => r.content.includes("Ornament") || r.content.includes("ornament"),
    );
    expect(toolResult).toBeDefined();
    // "Ornament #9999 not found." — meaningful, not a channel restriction.
    expect(toolResult!.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    expect(toolResult!.content).toMatch(
      /#?9999.*(not found)|not found.*#?9999/i,
    );
  });

  it("show_ornament_item over email returns 'not found' not 'not available over email' when DB is empty", async () => {
    // The beforeEach default already sets mockDbSelect to return [] — no override needed.

    const { capturedToolResults } = simulateToolCallRound(
      "show_ornament_item",
      { itemId: 9999 },
      "I couldn't find that ornament.",
    );

    await runElaineEmailTurn({
      userId: 1,
      inputText: "show ornament 9999",
      history: [],
    });

    const toolResult = capturedToolResults.find(
      (r) => r.content.includes("Ornament") || r.content.includes("ornament"),
    );
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).not.toMatch(
      /isn't available over|not available over/i,
    );
    expect(toolResult!.content).toMatch(
      /#?9999.*(not found)|not found.*#?9999/i,
    );
  });
});
