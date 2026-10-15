import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  sentry: vi.fn(),
  list: vi.fn(),
  diagnose: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@workspace/db", async (original) => {
  const actual = await original<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: { select: mocks.select, insert: mocks.insert, update: mocks.update },
  };
});
vi.mock("./sentry-issues", () => ({ listSentryIssues: mocks.sentry }));
vi.mock("./elaine-code-diagnosis", () => ({
  listElaineCodeSuggestions: mocks.list,
  diagnoseObservedRuntimeFailure: mocks.diagnose,
  hasSecretLikeContent: (text: string) => text.includes("sk-proj-"),
}));
vi.mock("./logger", () => ({ logger: { warn: mocks.warn } }));
import {
  executeOwnerSupportTool,
  ownerSupportChannelAllowed,
  queueAutomaticElaineTroubleshooting,
  savePendingElaineSuggestion,
} from "./elaine-owner-tools";
import type { ElaineRuntimeTrace } from "../elaine/runtime/contracts";

function selection(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
    then: (resolve: (value: unknown[]) => unknown) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}
const saved = { id: 19, status: "pending" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockImplementation(() => selection([{ isOwner: true }]));
  mocks.insert.mockReturnValue({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(async () => [saved]),
      })),
    })),
  });
  mocks.update.mockReturnValue({
    set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  });
  mocks.sentry.mockResolvedValue({ configured: true, issues: [] });
  mocks.list.mockResolvedValue([]);
  mocks.diagnose.mockResolvedValue(null);
});

describe("trusted owner support", () => {
  it.each([false, null, undefined])(
    "does not trust ownership claimed in a message (%s)",
    async (isOwner) => {
      mocks.select.mockReturnValue(selection([{ isOwner }]));
      const result = JSON.parse(
        await executeOwnerSupportTool(
          "list_sentry_issues",
          '{"isOwner":true}',
          42,
        ),
      );
      expect(result.error).toBe("owner_required");
      expect(mocks.sentry).not.toHaveBeenCalled();
    },
  );
  it("checks Sentry for the database-verified owner without screen state", async () => {
    const result = JSON.parse(
      await executeOwnerSupportTool("list_sentry_issues", "{}", 42),
    );
    expect(result.configured).toBe(true);
    expect(mocks.sentry).toHaveBeenCalledWith({
      environment: "production",
      query: "is:unresolved",
    });
  });
  it.each(["email", "the group messenger", "unknown"])(
    "denies privileged tools on %s",
    async (channel) => {
      expect(ownerSupportChannelAllowed(channel)).toBe(false);
      const result = JSON.parse(
        await executeOwnerSupportTool("list_sentry_issues", "{}", 42, channel),
      );
      expect(result.error).toBe("owner_channel_not_verified");
      expect(mocks.sentry).not.toHaveBeenCalled();
      expect(mocks.select).not.toHaveBeenCalled();
    },
  );
  it.each(["web", "SMS/voice", "Slack"])(
    "supports strongly identified %s",
    (channel) => {
      expect(ownerSupportChannelAllowed(channel)).toBe(true);
    },
  );
  it("saves directly into pending Elaine Suggestions", async () => {
    const result = JSON.parse(
      await executeOwnerSupportTool(
        "save_elaine_suggestion",
        JSON.stringify({
          title: "Clearer failure reporting",
          recommendation: "Name the failed step and its recorded outcome.",
        }),
        42,
      ),
    );
    expect(result).toMatchObject({
      saved: true,
      id: 19,
      status: "pending",
      alreadySaved: false,
    });
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.sentry).not.toHaveBeenCalled();
  });
  it("returns the existing ID after an idempotent conflict", async () => {
    mocks.insert.mockReturnValue({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => []),
        })),
      })),
    });
    mocks.select.mockReturnValue(selection([saved]));
    expect(
      await savePendingElaineSuggestion({
        patternKey: "test",
        title: "Clearer reporting",
        recommendation: "Explain failures.",
      }),
    ).toMatchObject({ alreadySaved: true, suggestion: { id: 19 } });
  });
  it("rejects oversized input and credentials", async () => {
    await expect(
      executeOwnerSupportTool(
        "save_elaine_suggestion",
        JSON.stringify({
          title: "x".repeat(181),
          recommendation: "report failures",
        }),
        42,
      ),
    ).rejects.toThrow();
    await expect(
      executeOwnerSupportTool(
        "save_elaine_suggestion",
        JSON.stringify({
          title: "credential",
          recommendation: "sk-proj-" + "a".repeat(40),
        }),
        42,
      ),
    ).rejects.toThrow("credentials");
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("reads only bounded requester diagnostics and omits raw plan reasoning", async () => {
    const query = selection([
      {
        id: "trace",
        status: "blocked",
        plan: { steps: [], privateReasoning: "must not surface" },
        observations: [],
        verification: null,
      },
    ]);
    mocks.select
      .mockReturnValueOnce(selection([{ isOwner: true }]))
      .mockReturnValueOnce(query);
    const result = await executeOwnerSupportTool(
      "get_recent_elaine_diagnostics",
      '{"limit":2}',
      42,
    );
    expect(query.limit).toHaveBeenCalledWith(2);
    expect(query.where).toHaveBeenCalledOnce();
    expect(result).not.toContain("privateReasoning");
    expect(result).not.toContain("must not surface");
  });
  it("records a first incomplete response automatically before attempting code diagnosis", async () => {
    queueAutomaticElaineTroubleshooting({
      traceId: "trace",
      status: "blocked",
      plan: {
        steps: [
          {
            id: "reply",
            label: "Answer",
            kind: "respond",
            status: "planned",
            required: true,
            toolName: null,
          },
        ],
      },
      observations: [],
      verification: null,
    } as unknown as ElaineRuntimeTrace);
    await vi.waitFor(() => expect(mocks.diagnose).toHaveBeenCalledOnce());
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.diagnose.mock.calls[0]?.[0]).toBe("runtime:turn_failure");
  });
});
