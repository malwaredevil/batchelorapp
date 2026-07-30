import { describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  correctElaineMemory: vi.fn(),
  forgetElaineMemory: vi.fn(),
  enqueueElaineResearchTask: vi.fn(),
  cancelElaineTaskForUser: vi.fn(),
}));

vi.mock("../lib/elaine-memory", () => ({
  correctElaineMemory: serviceMocks.correctElaineMemory,
  forgetElaineMemory: serviceMocks.forgetElaineMemory,
}));
vi.mock("../lib/elaine-tasks", () => ({
  enqueueElaineResearchTask: serviceMocks.enqueueElaineResearchTask,
  cancelElaineTaskForUser: serviceMocks.cancelElaineTaskForUser,
}));

import {
  ADAPTIVE_ACTION_TYPES,
  adaptiveActionExecutors,
  adaptiveActionSchemas,
  adaptiveActionTools,
} from "./adaptive-actions";

describe("Elaine adaptive actions", () => {
  it("connects every validated action to a confirmation tool and executor", () => {
    const toolNames = new Set(
      adaptiveActionTools.map((tool) =>
        tool.type === "function" ? tool.function.name : "",
      ),
    );
    for (const type of ADAPTIVE_ACTION_TYPES) {
      expect(toolNames.has(type)).toBe(true);
      expect(adaptiveActionExecutors[type]).toBeTypeOf("function");
    }
  });

  it("bounds durable research to five non-empty queries", () => {
    const queueSchema = adaptiveActionSchemas[2];
    expect(
      queueSchema.safeParse({
        type: "queue_research_task",
        payload: {
          goal: "Invented research",
          queries: ["a", "b", "c", "d", "e", "f"],
        },
      }).success,
    ).toBe(false);
  });

  it("returns the durable task id after confirmed execution", async () => {
    serviceMocks.enqueueElaineResearchTask.mockResolvedValueOnce(77);
    const result = await adaptiveActionExecutors.queue_research_task(
      {
        goal: "Compare invented options",
        queries: ["invented option one", "invented option two"],
      } as never,
      7,
    );
    expect(serviceMocks.enqueueElaineResearchTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        goal: "Compare invented options",
      }),
    );
    expect(result).toMatchObject({
      status: 202,
      body: {
        type: "queue_research_task",
        result: { taskId: 77, state: "queued" },
      },
    });
  });
});
