import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("./ai-client", () => ({ callModel: vi.fn() }));
vi.mock("./elaine-config", () => ({ getElaineGlobalConfig: vi.fn() }));
vi.mock("./jobs/queue", () => ({ enqueueJob: vi.fn() }));
vi.mock("./web-search", () => ({ webSearch: vi.fn() }));

import {
  projectElaineTask,
  researchTaskIdempotencyKey,
  runElaineResearchTask,
  type ElaineResearchCheckpoint,
} from "./elaine-tasks";

describe("Elaine durable research tasks", () => {
  it("uses a stable per-user, per-day idempotency key", () => {
    const input = {
      userId: 7,
      goal: "Compare invented options",
      queries: ["invented option a", "invented option b"],
      now: new Date("2026-07-30T08:00:00.000Z"),
    };
    expect(researchTaskIdempotencyKey(input)).toBe(
      researchTaskIdempotencyKey({
        ...input,
        now: new Date("2026-07-30T22:00:00.000Z"),
      }),
    );
    expect(researchTaskIdempotencyKey(input)).not.toBe(
      researchTaskIdempotencyKey({
        ...input,
        now: new Date("2026-07-31T00:00:00.000Z"),
      }),
    );
  });

  it("resumes from a fenced checkpoint without repeating completed searches", async () => {
    const previous: ElaineResearchCheckpoint = {
      version: 1,
      state: "running",
      completedQueryIndexes: [0],
      observations: [
        {
          query: "first query",
          success: true,
          evidenceSummary: "first evidence",
          citations: ["https://example.test/first"],
          observedAt: "2026-07-30T08:00:00.000Z",
        },
      ],
      citations: ["https://example.test/first"],
      updatedAt: "2026-07-30T08:00:00.000Z",
    };
    const search = vi.fn().mockResolvedValue({
      answer: "second evidence",
      citations: ["https://example.test/second"],
      images: [],
    });
    const checkpoints: unknown[] = [];

    await runElaineResearchTask(
      {
        userId: 7,
        goal: "Compare invented evidence",
        queries: ["first query", "second query"],
        requestedAt: "2026-07-30T08:00:00.000Z",
        confirmationGrantedAt: "2026-07-30T08:00:00.000Z",
      },
      {
        jobId: 44,
        attempt: 2,
        signal: new AbortController().signal,
        updateProgress: vi.fn().mockResolvedValue(undefined),
        saveCheckpoint: vi.fn(async (checkpoint) => {
          checkpoints.push(checkpoint);
          return true;
        }),
      },
      {
        search,
        synthesize: vi.fn().mockResolvedValue("final answer"),
        loadCheckpoint: vi.fn().mockResolvedValue(previous),
        now: () => new Date("2026-07-30T09:00:00.000Z"),
      },
    );

    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("second query");
    expect(checkpoints.at(-1)).toMatchObject({
      state: "completed",
      completedQueryIndexes: [0, 1],
      answer: "final answer",
      citations: ["https://example.test/first", "https://example.test/second"],
      observations: [
        { citations: ["https://example.test/first"] },
        { citations: ["https://example.test/second"] },
      ],
    });
  });

  it("projects internal queue statuses to user-safe task states", () => {
    expect(
      projectElaineTask({
        id: 1,
        status: "retry_wait",
        goal: "Invented task",
        progress_percent: 40,
        progress_message: "Waiting to retry",
        result: null,
        attempt_count: 1,
        max_attempts: 3,
        last_error_code: null,
        last_error_message: null,
        created_at: "2026-07-30T08:00:00.000Z",
        updated_at: "2026-07-30T08:01:00.000Z",
        completed_at: null,
      }).state,
    ).toBe("queued");
  });
});
