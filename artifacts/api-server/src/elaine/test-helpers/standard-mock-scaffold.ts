/**
 * Shared vi.mock() factory functions for the reminder-doubt and
 * scheduling-doubt test files.
 *
 * Both `chat-reminder-doubt.test.ts` and
 * `scheduling-doubt-tool-forcing.test.ts` share a large body of "leaf" mocks
 * — modules that must be stubbed to prevent real network/DB calls but that
 * do not drive the core test behaviour.  Maintaining two copies creates drift
 * risk: a mock updated in one file is routinely missed in the other.
 *
 * Usage in a test file:
 *
 *   import {
 *     elaineLessonsMockFactory,
 *     loggerMockFactory,
 *     // … other factories
 *   } from "./test-helpers/standard-mock-scaffold";
 *
 *   vi.mock("../lib/elaine-lessons", elaineLessonsMockFactory);
 *   vi.mock("../lib/logger", loggerMockFactory);
 *
 * The factory functions are plain objects / functions that Vitest accepts as
 * the second argument to vi.mock().  They do NOT close over any hoisted
 * vi.fn() references — per-file hoisted controls stay in the test file,
 * while the shared "boring" mocks live here.
 *
 * Guardrail:
 *   `scripts/src/check-domain-composition.ts` has named-file requirements
 *   that verify both sibling test files import from this module.  Any future
 *   test file that duplicates this scaffold will be caught by the general
 *   composition scan.
 */

import { vi } from "vitest";

// ── Primitive helpers ─────────────────────────────────────────────────────────

/** A no-op Express-style middleware (pass-through rate limiter). */
function passthrough(_req: unknown, _res: unknown, next: () => void): void {
  next();
}

// ────────────────────────────────────────────────────────────────────────────
// Shared vi.mock() factory functions
//
// Each export is a zero-argument function suitable for the second parameter of
// vi.mock(path, factory).  Every factory is self-contained: it does not
// capture any hoisted vi.fn() references from the calling test file.
// ────────────────────────────────────────────────────────────────────────────

/**
 * @sentry/node — stubs every entry point used by the Elaine chat route.
 * Both test files need Sentry silenced; the exact shape is a superset of
 * both callers.
 */
export function sentryMockFactory() {
  return {
    init: vi.fn(),
    setUser: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    withScope: vi.fn(),
    startSpan: vi.fn((_o: unknown, cb: () => unknown) => cb()),
    setConversationId: vi.fn(),
    Scope: class {},
  };
}

/**
 * ../lib/logger — silent logger stub.
 * Identical in both sibling files; one canonical copy here.
 */
export function loggerMockFactory() {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
}

/**
 * ../middleware/rateLimit — all limiters become no-op pass-throughs.
 * The scheduling-doubt file used importOriginal for this; the canonical
 * version here stubs all known limiters without touching the real module,
 * which is the safer choice for unit tests.
 */
export function rateLimitMockFactory() {
  return {
    loginLimiter: passthrough,
    passwordResetLimiter: passthrough,
    phoneVerifyLimiter: passthrough,
    authLimiter: passthrough,
    apiLimiter: passthrough,
    adminLimiter: passthrough,
    webhookLimiter: passthrough,
    aiLimiter: passthrough,
    bulkAiLimiter: passthrough,
    compareLimiter: passthrough,
    supplementalUploadLimiter: passthrough,
    consumeAiRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  };
}

/**
 * ../lib/elaine-lessons — CRITICAL shared mock.
 *
 * The real getRelevantElaineLessons issues an extra db.select() that shifts
 * the selectQueue slots out of alignment, silently aborting the SSE response
 * with ECONNRESET before headers are ever sent.  Both test files must mock
 * this module identically.  A single copy here prevents that from drifting.
 */
export function elaineLessonsMockFactory() {
  return {
    ELAINE_LESSON_DOMAINS: [
      "travels",
      "pottery",
      "quilting",
      "ornaments",
      "office",
      "reminders",
      "memory",
      "navigation",
      "communication",
      "general",
    ],
    getRelevantElaineLessons: vi
      .fn()
      .mockResolvedValue({ lessons: [], evidenceBlock: "" }),
    recordElaineLesson: vi
      .fn()
      .mockResolvedValue({ id: 1, occurrenceCount: 1 }),
  };
}

/**
 * ../lib/env — minimal env stub so the route doesn't throw on startup.
 */
export function envMockFactory() {
  return {
    env: {
      isProduction: false,
      sessionSecret: "test-session",
      supabaseUrl: "https://mock.supabase.co",
      supabaseServiceRoleKey: "mock-key",
      openrouterApiKey: "mock-openrouter",
      databaseUrl: "postgresql://mock:mock@localhost/mock",
    },
  };
}

/**
 * pdf-parse — stub so the route doesn't try to load binary native modules.
 */
export function pdfParseMockFactory() {
  return { default: vi.fn().mockResolvedValue({ text: "" }) };
}

/**
 * ../lib/openai — embedText stub.
 */
export function openaiMockFactory() {
  return { embedText: vi.fn().mockResolvedValue([]) };
}

/**
 * ../lib/openrouter-models — stub so model-list calls don't hit the network.
 */
export function openrouterModelsMockFactory() {
  return { listOpenRouterModels: vi.fn().mockResolvedValue([]) };
}

/**
 * ../lib/web-search — stubs webSearch and fetchPage.
 */
export function webSearchMockFactory() {
  return {
    webSearch: vi.fn().mockResolvedValue([]),
    fetchPage: vi.fn().mockResolvedValue(""),
  };
}

/**
 * ../lib/ssrf-safe-fetch — stubs fetchJsonSafe.
 */
export function ssrfSafeFetchMockFactory() {
  return { fetchJsonSafe: vi.fn().mockResolvedValue(null) };
}

/**
 * ../lib/expert-consult — stubs consultExperts.
 */
export function expertConsultMockFactory() {
  return { consultExperts: vi.fn().mockResolvedValue("") };
}

/**
 * ../lib/soft-delete — stubs logActivity.
 */
export function softDeleteMockFactory() {
  return { logActivity: vi.fn().mockResolvedValue(undefined) };
}

/**
 * ../lib/email — stubs all outbound email helpers.
 */
export function emailMockFactory() {
  return {
    sendAssistantEmail: vi.fn().mockResolvedValue(undefined),
    sendTestEmail: vi.fn().mockResolvedValue(undefined),
    resendConfigured: vi.fn().mockReturnValue(false),
    sendElaineEmailReply: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * ../lib/sms — stubs SMS helpers and error classes.
 */
export function smsMockFactory() {
  return {
    sendSms: vi.fn().mockResolvedValue(undefined),
    smsConfigured: vi.fn().mockReturnValue(false),
    SmsRegistrationPendingError: class extends Error {},
    SmsOptedOutError: class extends Error {},
  };
}

/**
 * ../lib/travels/flights — stubs lookupFlightPrices.
 */
export function travelFlightsMockFactory() {
  return { lookupFlightPrices: vi.fn().mockResolvedValue([]) };
}

/**
 * ../lib/travels/google-maps — stubs all Maps helpers.
 */
export function travelGoogleMapsMockFactory() {
  return {
    getWeatherForecast: vi.fn().mockResolvedValue(null),
    getAirQuality: vi.fn().mockResolvedValue(null),
    getPollenForecast: vi.fn().mockResolvedValue(null),
    searchPlaces: vi.fn().mockResolvedValue([]),
    computeRoute: vi.fn().mockResolvedValue(null),
  };
}

/**
 * ../lib/travels/storage — stubs deleteTripPhoto.
 */
export function travelStorageMockFactory() {
  return { deleteTripPhoto: vi.fn().mockResolvedValue(undefined) };
}

/**
 * ../lib/travels-storage — stubs deleteDocument.
 */
export function travelsStorageMockFactory() {
  return { deleteDocument: vi.fn().mockResolvedValue(undefined) };
}

/**
 * ../lib/pottery/ebay-market-value — stubs eBay lookup helpers.
 */
export function ebayMarketValueMockFactory() {
  return {
    lookupEbayMarketValue: vi.fn().mockResolvedValue(null),
    buildEbayQuery: vi.fn().mockReturnValue(""),
  };
}

/**
 * ../lib/ornaments/hallmark-search — stubs Hallmark search helpers.
 */
export function hallmarkSearchMockFactory() {
  return {
    searchHallmark: vi.fn().mockResolvedValue([]),
  };
}

/**
 * ../lib/ornaments/barcode — stubs lookupBarcode.
 */
export function barcodeMockFactory() {
  return { lookupBarcode: vi.fn().mockResolvedValue(null) };
}

/**
 * ../lib/google-calendar-tokens — stubs getValidAccessToken.
 */
export function googleCalendarTokensMockFactory() {
  return { getValidAccessToken: vi.fn().mockResolvedValue(null) };
}

/**
 * ../routes/travels/documents — stubs rescanTripDocument.
 */
export function travelDocumentsMockFactory() {
  return { rescanTripDocument: vi.fn().mockResolvedValue(undefined) };
}

/**
 * ../routes/admin/integrations-health — stubs getCachedHealthChecks.
 */
export function integrationsHealthMockFactory() {
  return { getCachedHealthChecks: vi.fn().mockResolvedValue([]) };
}

/**
 * ../routes/travels/ai — stubs itinerary helpers.
 */
export function travelAiMockFactory() {
  return {
    generateItineraryForTrip: vi.fn().mockResolvedValue([]),
    ItineraryActionError: class extends Error {},
  };
}

/**
 * ../routes/travels/reminders — stubs reminder-sync helpers.
 */
export function travelRemindersMockFactory() {
  return {
    getReminderSyncTarget: vi.fn().mockResolvedValue(null),
    syncReminderCalendarEvents: vi.fn().mockResolvedValue(undefined),
    deleteAllReminderCalendarEvents: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * ../lib/elaine-tasks — stubs Elaine async-task helpers.
 */
export function elaineTasksMockFactory() {
  return {
    cancelElaineTaskForUser: vi.fn().mockResolvedValue(false),
    getElaineTaskForUser: vi.fn().mockResolvedValue(null),
    listElaineTasksForUser: vi.fn().mockResolvedValue([]),
  };
}

/**
 * ../lib/retry — makes withRetry a transparent pass-through.
 */
export function retryMockFactory() {
  return {
    withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
  };
}

/**
 * ../lib/document-parsing — stubs document text extraction.
 */
export function documentParsingMockFactory() {
  return {
    extractDocumentText: vi.fn().mockResolvedValue(""),
    docTypeTagForMime: vi.fn().mockReturnValue(""),
  };
}

/**
 * ../lib/document-generation — stubs document buffer generation.
 */
export function documentGenerationMockFactory() {
  return {
    buildDocumentBuffer: vi.fn().mockResolvedValue(Buffer.from("")),
    DOCUMENT_MIME_BY_FORMAT: {},
    DOCUMENT_EXTENSION_BY_FORMAT: {},
  };
}

/**
 * @supabase/supabase-js — stubs the Supabase client with signed-URL support.
 */
export function supabaseMockFactory() {
  return {
    createClient: vi.fn().mockReturnValue({
      storage: {
        from: vi.fn().mockReturnValue({
          upload: vi.fn().mockResolvedValue({ data: null, error: null }),
          getPublicUrl: vi.fn().mockReturnValue({
            data: { publicUrl: "https://mock.example.com/file.jpg" },
          }),
          createSignedUrl: vi.fn().mockResolvedValue({
            data: { signedUrl: "https://signed.example.com/file.jpg" },
            error: null,
          }),
        }),
      },
    }),
  };
}

/**
 * ../lib/storage-core — stubs bucket management and upload helpers.
 */
export function storageCoreMockFactory() {
  return {
    ensureBucketWithPolicy: vi.fn().mockResolvedValue(undefined),
    ELAINE_ATTACHMENTS_BUCKET_POLICY: {
      name: "elaine-attachments",
      allowedMimeTypes: [],
    },
    buildStorageAdapter: vi.fn(() => ({
      uploadImage: vi.fn(),
      uploadFile: vi.fn(),
      deleteFile: vi.fn(),
      getSignedUrl: vi.fn(),
    })),
    IMAGE_ONLY_POLICY: {},
    TRAVELS_BUCKET_POLICY: {},
    ORNAMENTS_BUCKET_POLICY: {},
    QUILTING_BUCKET_POLICY: {},
  };
}

/**
 * ../lib/upload-limits — stubs multerLimitForPrefix.
 */
export function uploadLimitsMockFactory() {
  return {
    multerLimitForPrefix: vi
      .fn()
      .mockReturnValue({ fileSize: 5 * 1024 * 1024 }),
  };
}

/**
 * multer — stubs the multer middleware factory.
 * memoryStorage() is called at module-load time by pottery.ts, so it must
 * exist as a static property on the default export.
 */
export function multerMockFactory() {
  const multerFactory = (_opts?: unknown) => ({
    single: () => passthrough,
    array: () => passthrough,
    fields: () => passthrough,
  });
  multerFactory.memoryStorage = () => ({});
  return { default: multerFactory };
}

/**
 * ./travel-wishlist-executors — stubs removeWishlistItemExecutor.
 */
export function travelWishlistExecutorsMockFactory() {
  return {
    removeWishlistItemExecutor: vi
      .fn()
      .mockResolvedValue({ status: 200, body: {} }),
  };
}

/**
 * ../lib/elaine-code-diagnosis — stubs diagnosis helpers.
 * Prevents fire-and-forget DB calls or model requests from background paths.
 */
export function elaineCodeDiagnosisMockFactory() {
  return {
    diagnoseRecurringFailureInBackground: vi.fn(),
    maybeDiagnoseRecurringFailure: vi.fn().mockResolvedValue(null),
    listElaineCodeSuggestions: vi.fn().mockResolvedValue([]),
    decideElaineCodeSuggestion: vi.fn().mockResolvedValue(null),
  };
}
