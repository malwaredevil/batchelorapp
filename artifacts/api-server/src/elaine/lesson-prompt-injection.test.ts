/**
 * Before/after proof that a recorded lesson changes what gets injected into
 * Elaine's web-chat system prompt.
 *
 * "Before": no relevant past lesson exists yet — buildElaineCoreSystemPrompt
 * with pastLessonsBlock omitted (as on restricted channels) or empty renders
 * no PAST LESSONS section at all.
 *
 * "After": getRelevantElaineLessons (the real ranking/formatting code, not a
 * mock) surfaces a previously-recorded mistake for a matching situation, and
 * that evidence block — once passed into buildElaineCoreSystemPrompt exactly
 * as the web /chat route does — appears verbatim in the system prompt, with
 * an explicit instruction to avoid repeating the mistake.
 *
 * This is the module under heavy mocking only because buildElaineCoreSystemPrompt
 * lives inside index.ts, which has import-time side effects (route wiring,
 * config loads) — see broadcast-channel-restriction.test.ts for the same
 * pattern and rationale.
 */

import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — suppress import-time side effects from ./index.
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
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
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
  getRelevantElaineMemory: vi.fn().mockResolvedValue({
    memories: [],
    evidenceBlock: "(no relevant durable memory)",
    existingFactContents: [],
  }),
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
  const passthrough = (_r: unknown, _s: unknown, next: () => void) => next();
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
  isReminderDoubtMessage: vi.fn().mockReturnValue(false),
  isSchedulingDoubtMessage: vi.fn().mockReturnValue(false),
  buildSelfHealLessonInput: vi.fn().mockReturnValue(null),
  detectClaimedCheckWithoutToolCall: vi.fn().mockReturnValue(null),
  selfHealPatternKey: vi.fn().mockReturnValue("self_heal:mock"),
  buildClassifierDoubtLessonInput: vi.fn().mockReturnValue(null),
  classifierDoubtPatternKey: vi.fn().mockReturnValue("classifier_doubt:mock"),
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

vi.mock("../lib/ai-client", () => ({
  callModel: vi.fn(),
  callModelWithSubagent: vi.fn(),
  HIDDEN_REASONING: { reasoning: { enabled: true, exclude: true } },
}));

// ---------------------------------------------------------------------------
// Import modules under test (after all vi.mock() calls)
// ---------------------------------------------------------------------------

import { buildElaineCoreSystemPrompt } from "./index";
import {
  formatLessonEvidence,
  rankElaineLessons,
  type ElaineLessonCandidate,
} from "./runtime/lesson-policy";

const BASE_PROMPT_PARAMS = {
  userName: "Sam",
  channelLabel: "the web chat",
  contextBlockLabel: "Reminders",
  contextBlock: "(no page context)",
  memoryBlock: "(no relevant durable memory)",
  actionConfirmationMode: "auto_run",
  isTravelsApp: false,
};

function reminderMistakeLesson(
  overrides: Partial<ElaineLessonCandidate> = {},
): ElaineLessonCandidate {
  return {
    id: 1,
    outcome: "mistake",
    domain: "reminders",
    situation:
      "user asked to push a reminder back an hour and it was reset to 1 hour from now instead of added to the existing time",
    takeaway:
      "push it back an hour means add 1 hour to the existing reminder time, never reset it to 1 hour from now",
    tags: ["reminders", "reschedule"],
    active: true,
    source: "explicit_assistant",
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    updatedAt: new Date("2026-08-01T12:00:00.000Z"),
    ...overrides,
  };
}

describe("Web-chat system prompt — past-lessons injection changes real behavior", () => {
  it("BEFORE: web chat renders the PAST LESSONS section with a placeholder, not the mistake's own text, when nothing is relevant yet", () => {
    // Web chat always passes a real evidenceBlock (mirroring how the durable
    // memory section always renders) — the section header always appears,
    // but with a placeholder instead of any actual lesson content.
    const prompt = buildElaineCoreSystemPrompt({
      ...BASE_PROMPT_PARAMS,
      pastLessonsBlock: formatLessonEvidence([]),
    });
    expect(prompt).toContain("PAST LESSONS ABOUT YOUR OWN PERFORMANCE");
    expect(prompt).toContain("(no relevant past lessons)");
    expect(prompt).not.toContain("[MISTAKE;");
  });

  it("omits the section entirely on restricted channels (pastLessonsBlock not passed)", () => {
    const prompt = buildElaineCoreSystemPrompt({ ...BASE_PROMPT_PARAMS });
    expect(prompt).not.toContain("PAST LESSONS ABOUT YOUR OWN PERFORMANCE");
  });

  it("AFTER: a lesson recorded from a prior mistake is retrieved for the same situation and injected verbatim, with an instruction not to repeat it", () => {
    // Retrieval uses the real ranking/formatting code (not a mock) — this is
    // exactly what getRelevantElaineLessons does internally once rows come
    // back from the database.
    const ranked = rankElaineLessons({
      query: "can you push my dentist reminder back an hour",
      currentDomain: "reminders",
      lessons: [reminderMistakeLesson()],
    });
    expect(ranked).toHaveLength(1);
    const pastLessonsBlock = formatLessonEvidence(ranked);

    const prompt = buildElaineCoreSystemPrompt({
      ...BASE_PROMPT_PARAMS,
      pastLessonsBlock,
    });

    expect(prompt).toContain("PAST LESSONS ABOUT YOUR OWN PERFORMANCE");
    expect(prompt).toContain("MISTAKE");
    expect(prompt).toContain(
      "add 1 hour to the existing reminder time, never reset it to 1 hour from now",
    );
    expect(prompt).toContain(
      "actively avoid repeating it in a similar situation now",
    );
  });

  it("an unrelated past mistake in a different domain is not surfaced (no false-positive injection)", () => {
    const ranked = rankElaineLessons({
      query: "what's weather forecast for our trip to rome",
      currentDomain: "travels",
      lessons: [reminderMistakeLesson()],
    });
    expect(ranked).toHaveLength(0);

    const prompt = buildElaineCoreSystemPrompt({
      ...BASE_PROMPT_PARAMS,
      pastLessonsBlock: formatLessonEvidence(ranked),
    });
    expect(prompt).toContain("PAST LESSONS ABOUT YOUR OWN PERFORMANCE");
    expect(prompt).toContain("(no relevant past lessons)");
    expect(prompt).not.toContain("[MISTAKE;");
  });
});
