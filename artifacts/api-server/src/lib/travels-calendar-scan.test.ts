import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sentry } from "./sentry";
import { classifyOptionalLookupTimeout } from "./optional-ai-lookup";

const mocks = vi.hoisted(() => ({
  calendars: vi.fn(),
  token: vi.fn(),
  events: vi.fn(),
  linked: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
  completion: vi.fn(),
  callModel: vi.fn(),
  models: vi.fn(),
  claim: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: {
    select: () => ({ from: mocks.linked }),
    insert: mocks.insert,
  },
}));
vi.mock("./google-calendar-tokens", () => ({
  getAllConnectedCalendars: mocks.calendars,
  getValidAccessToken: mocks.token,
}));
vi.mock("./google-calendar", () => ({ listCalendarEvents: mocks.events }));
vi.mock("./ai-client", () => ({
  getModels: mocks.models,
  callModel: mocks.callModel,
}));
vi.mock("./scheduler-guard", () => ({
  shouldRunScheduledTask: mocks.claim,
  recordScheduledTaskSuccess: mocks.success,
  recordScheduledTaskFailure: mocks.failure,
  getSchedulerPollIntervalMs: () => 900_000,
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: mocks.warn, error: mocks.error },
}));

import {
  scanCalendarForTripSuggestions,
  startCalendarTripScanScheduler,
} from "./travels-calendar-scan";

describe("calendar trip scan failure handling", () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.calendars.mockResolvedValue([
      { userId: 1, googleCalendarId: "calendar-test", isTravelCalendar: true },
    ]);
    mocks.token.mockResolvedValue("test-token");
    mocks.events.mockResolvedValue([
      {
        id: "event-1",
        title: "Flight",
        start: "2026-10-22",
        end: "2026-10-23",
      },
    ]);
    mocks.linked.mockResolvedValue([]);
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({
      onConflictDoNothing: () => ({ returning: mocks.returning }),
    });
    mocks.returning.mockResolvedValue([{ id: 1 }]);
    mocks.models.mockResolvedValue({ fastVision: "test-model" });
    mocks.callModel.mockImplementation(async (model, run) =>
      run({ chat: { completions: { create: mocks.completion } } }, model),
    );
    mocks.completion.mockResolvedValue({
      choices: [{ message: { content: '{"trips":[]}' } }],
    });
    mocks.claim.mockResolvedValue(false);
    mocks.success.mockResolvedValue(undefined);
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  it("returns incomplete on an SDK timeout without writing suggestions or retrying immediately", async () => {
    mocks.completion.mockRejectedValue(new OpenAI.APIConnectionTimeoutError());
    await expect(scanCalendarForTripSuggestions()).resolves.toEqual({
      scanned: 1,
      created: 0,
      completed: false,
    });
    expect(mocks.completion).toHaveBeenCalledTimes(1);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      { scanned: 1, completed: false },
      expect.stringContaining("scan incomplete"),
    );
  });

  it("scopes timeout classification to the optional completion, not other AI work", async () => {
    const parent = Sentry.getCurrentScope();
    mocks.completion.mockImplementation(async () => {
      expect(Sentry.getCurrentScope()).not.toBe(parent);
      expect(Sentry.getCurrentScope().getScopeData().eventProcessors).toContain(
        classifyOptionalLookupTimeout,
      );
      return { choices: [{ message: { content: '{"trips":[]}' } }] };
    });
    await scanCalendarForTripSuggestions();
    expect(Sentry.getCurrentScope()).toBe(parent);
  });

  it.each([
    new TypeError("unexpected bug"),
    new OpenAI.AuthenticationError(401, {}, "unauthorized", new Headers()),
  ])("does not hide unexpected failures (%s)", async (error) => {
    mocks.completion.mockRejectedValue(error);
    await expect(scanCalendarForTripSuggestions()).rejects.toBe(error);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("does not mark malformed AI JSON as a successful empty scan", async () => {
    mocks.completion.mockResolvedValue({
      choices: [{ message: { content: "not JSON" } }],
    });
    await expect(scanCalendarForTripSuggestions()).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });

  it("treats no calendars or no unlinked events as successful no-op scans", async () => {
    mocks.calendars.mockResolvedValueOnce([]);
    await expect(scanCalendarForTripSuggestions()).resolves.toEqual({
      scanned: 0,
      created: 0,
      completed: true,
    });
    mocks.linked.mockResolvedValueOnce([{ googleEventId: "event-1" }]);
    await expect(scanCalendarForTripSuggestions()).resolves.toEqual({
      scanned: 1,
      created: 0,
      completed: true,
    });
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it("keeps suggestion creation idempotent when a later scan repeats an event", async () => {
    mocks.completion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              trips: [
                { title: "Test trip", relatedEventIds: ["event-1", "unknown"] },
              ],
            }),
          },
        },
      ],
    });
    expect(await scanCalendarForTripSuggestions()).toEqual({
      scanned: 1,
      created: 1,
      completed: true,
    });
    mocks.returning.mockResolvedValueOnce([]);
    expect(await scanCalendarForTripSuggestions()).toEqual({
      scanned: 1,
      created: 0,
      completed: true,
    });
    expect(mocks.values.mock.calls[0]![0].dedupeKey).toBe(
      mocks.values.mock.calls[1]![0].dedupeKey,
    );
    expect(mocks.values.mock.calls[0]![0].relatedEventIds).toEqual(["event-1"]);
  });

  it("records failure, waits for a later granted claim, then records success after recovery", async () => {
    vi.useFakeTimers();
    mocks.claim
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mocks.completion.mockRejectedValueOnce(
      new OpenAI.APIConnectionTimeoutError(),
    );
    stop = startCalendarTripScanScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.failure).toHaveBeenCalledExactlyOnceWith(
      "travels-calendar-scan",
    );
    expect(mocks.success).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(mocks.completion).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(mocks.completion).toHaveBeenCalledTimes(2);
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
      "travels-calendar-scan",
    );
    expect(mocks.claim).toHaveBeenLastCalledWith(
      "travels-calendar-scan",
      86_400_000,
      {
        recoverStuckClaims: false,
        incompleteRetryIntervalMs: 3_600_000,
      },
    );
  });

  it("keeps unexpected scheduler errors on the error path without recording success", async () => {
    vi.useFakeTimers();
    mocks.claim.mockResolvedValueOnce(true);
    mocks.completion.mockRejectedValue(new TypeError("unexpected"));
    stop = startCalendarTripScanScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(TypeError) }),
      "travels-calendar-scan: run failed",
    );
    expect(mocks.failure).toHaveBeenCalledExactlyOnceWith(
      "travels-calendar-scan",
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
