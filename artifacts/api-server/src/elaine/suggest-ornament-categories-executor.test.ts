/**
 * suggest-ornament-categories-executor.test.ts
 *
 * Focused executor test for Elaine's `suggest_and_create_ornament_categories`
 * action (Task #1077), verifying:
 *   1. Success path: suggestion + create-and-backfill both run, and the
 *      executor returns the combined result shape.
 *   2. Empty-suggestion path: create-and-backfill is never called when there
 *      is nothing to suggest (e.g. an empty collection or every name already
 *      matches an existing category).
 *   3. Rate-limited path: the paid AI suggestion call is never made when
 *      consumeAiRateLimit reports the user is over their cap.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { rateLimitMockFactory } from "./test-helpers/standard-mock-scaffold";

vi.mock("../middleware/rateLimit", () => rateLimitMockFactory());

vi.mock("../lib/soft-delete", () => ({ logActivity: vi.fn() }));

vi.mock("../lib/env", () => ({
  env: { supabaseUrl: "https://mock.supabase.co", ebayAppId: "test-app-id" },
}));

vi.mock("../lib/pottery/ebay-market-value", () => ({
  lookupOrnamentEbayData: vi.fn(),
  buildEbayQuery: vi.fn(),
}));

vi.mock("../lib/ornaments/storage", () => ({ deleteImage: vi.fn() }));

vi.mock("../routes/ornaments/ornaments", () => ({
  bulkReanalyzeOrnamentItems: vi.fn(),
  promoteOrnamentImageToPrimary: vi.fn(),
  createOrnamentItemFromBuffer: vi.fn(),
}));

const {
  mockSuggestOrnamentCategories,
  mockCreateAndBackfillOrnamentCategories,
} = vi.hoisted(() => ({
  mockSuggestOrnamentCategories: vi.fn(),
  mockCreateAndBackfillOrnamentCategories: vi.fn(),
}));

vi.mock("../routes/ornaments/categories", () => ({
  suggestOrnamentCategories: mockSuggestOrnamentCategories,
  createAndBackfillOrnamentCategories: mockCreateAndBackfillOrnamentCategories,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: vi.fn(),
      update: vi.fn(),
      insert: vi.fn(),
      delete: vi.fn(),
    },
  };
});

import { consumeAiRateLimit } from "../middleware/rateLimit";
import { ornamentActionExecutors } from "./ornaments-actions";

describe("suggest_and_create_ornament_categories executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consumeAiRateLimit).mockResolvedValue({ limited: false });
  });

  it("suggests, creates, and backfills categories on the success path", async () => {
    mockSuggestOrnamentCategories.mockResolvedValue(["Star Wars", "Reindeer"]);
    mockCreateAndBackfillOrnamentCategories.mockResolvedValue({
      categories: [],
      createdCount: 2,
      assignmentsCreated: 7,
    });

    const result =
      await ornamentActionExecutors.suggest_and_create_ornament_categories(
        {} as never,
        1,
      );

    expect(result.status).toBe(200);
    expect(mockCreateAndBackfillOrnamentCategories).toHaveBeenCalledWith(1, [
      "Star Wars",
      "Reindeer",
    ]);
    const body = result.body as {
      result: {
        suggestedNames: string[];
        createdCount: number;
        assignmentsCreated: number;
      };
    };
    expect(body.result).toEqual({
      suggestedNames: ["Star Wars", "Reindeer"],
      createdCount: 2,
      assignmentsCreated: 7,
    });
  });

  it("skips create-and-backfill when there is nothing to suggest", async () => {
    mockSuggestOrnamentCategories.mockResolvedValue([]);

    const result =
      await ornamentActionExecutors.suggest_and_create_ornament_categories(
        {} as never,
        1,
      );

    expect(result.status).toBe(200);
    expect(mockCreateAndBackfillOrnamentCategories).not.toHaveBeenCalled();
    const body = result.body as {
      result: {
        suggestedNames: string[];
        createdCount: number;
        assignmentsCreated: number;
      };
    };
    expect(body.result).toEqual({
      suggestedNames: [],
      createdCount: 0,
      assignmentsCreated: 0,
    });
  });

  it("returns 429 and never calls the AI suggestion when rate-limited", async () => {
    vi.mocked(consumeAiRateLimit).mockResolvedValueOnce({ limited: true });

    const result =
      await ornamentActionExecutors.suggest_and_create_ornament_categories(
        {} as never,
        1,
      );

    expect(result.status).toBe(429);
    expect(mockSuggestOrnamentCategories).not.toHaveBeenCalled();
    expect(mockCreateAndBackfillOrnamentCategories).not.toHaveBeenCalled();
  });
});
