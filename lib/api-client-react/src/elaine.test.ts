import { afterEach, describe, expect, it, vi } from "vitest";
import { streamElaineMessage, type ElaineRuntimeTrace } from "./elaine";

const TRACE: ElaineRuntimeTrace = {
  version: 1,
  traceId: "trace-test",
  requestClass: {
    kind: "research",
    complexity: "multi_step",
    requiresFreshData: true,
    hasAttachment: false,
  },
  goal: "Answer with current evidence",
  plan: {
    version: 1,
    goal: "Answer with current evidence",
    assumptions: [],
    completionCriteria: ["The answer is grounded"],
    steps: [
      {
        id: "search",
        label: "Check the source",
        kind: "research",
        toolName: "web_search",
        dependsOn: [],
        expectedEvidence: "A current source",
        required: true,
        riskClass: "read_only",
        confirmation: "none",
        retryLimit: 1,
        status: "active",
        attempts: 1,
      },
    ],
  },
  events: [],
  verification: null,
  status: "running",
  traceAvailable: true,
  startedAt: "2026-07-30T12:00:00.000Z",
  completedAt: null,
  usage: { modelRounds: 1, toolCalls: 1, replans: 0, elapsedMs: 10 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamElaineMessage runtime SSE", () => {
  it("preserves event order and clears provisional text before the final answer", async () => {
    const finalResponse = {
      role: "assistant",
      content: "Grounded final answer",
      navigate: null,
      actions: [],
      executedActions: [],
      actionConfirmationMode: "one_by_one",
      messages: [
        {
          role: "assistant",
          content: "Grounded final answer",
          runtimeTrace: { ...TRACE, status: "completed" },
        },
      ],
      runtimeTrace: { ...TRACE, status: "completed" },
    };
    const sse = [
      `event: runtime\ndata: ${JSON.stringify({ trace: TRACE })}\n\n`,
      'event: delta\ndata: {"text":"Provisional"}\n\n',
      "event: response_reset\ndata: {}\n\n",
      'event: delta\ndata: {"text":"Grounded final answer"}\n\n',
      `event: done\ndata: ${JSON.stringify(finalResponse)}\n\n`,
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(sse, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        ),
      ),
    );
    const observed: string[] = [];

    const result = await streamElaineMessage(
      { message: "Invented request", appId: "elaine" },
      {
        onRuntime: () => observed.push("runtime"),
        onDelta: (text) => observed.push(`delta:${text}`),
        onResponseReset: () => observed.push("reset"),
        onDone: () => observed.push("done"),
      },
    );

    expect(observed).toEqual([
      "runtime",
      "delta:Provisional",
      "reset",
      "delta:Grounded final answer",
      "done",
    ]);
    expect(result.content).toBe("Grounded final answer");
  });
});
