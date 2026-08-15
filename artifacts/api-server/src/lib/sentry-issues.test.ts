/**
 * Tests for the Sentry issues client:
 *   • "not configured" path when any of the three env values is missing
 *   • environment + query filtering forwarded to the Sentry API URL
 *   • response parsing / normalisation (string counts → numbers)
 *   • non-OK / non-array responses throw
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockEnv = vi.hoisted(() => ({
  sentryAuthToken: undefined as string | undefined,
  sentryOrgSlug: undefined as string | undefined,
  sentryProjectSlug: undefined as string | undefined,
}));

vi.mock("./env", () => ({ env: mockEnv }));

import {
  listSentryIssues,
  isSentryIssuesConfigured,
  getSentryIssuesConfig,
} from "./sentry-issues";

const realFetch = global.fetch;

function mockFetchOnce(
  body: unknown,
  ok = true,
  status = 200,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  mockEnv.sentryAuthToken = "token";
  mockEnv.sentryOrgSlug = "my-org";
  mockEnv.sentryProjectSlug = "my-project";
});

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("configuration detection", () => {
  it("is not configured when any of the three values is missing", () => {
    for (const key of [
      "sentryAuthToken",
      "sentryOrgSlug",
      "sentryProjectSlug",
    ] as const) {
      mockEnv.sentryAuthToken = "token";
      mockEnv.sentryOrgSlug = "org";
      mockEnv.sentryProjectSlug = "proj";
      mockEnv[key] = undefined;
      expect(isSentryIssuesConfigured()).toBe(false);
      expect(getSentryIssuesConfig()).toBeNull();
    }
  });

  it("is configured when all three values are present", () => {
    expect(isSentryIssuesConfigured()).toBe(true);
  });

  it("listSentryIssues returns configured:false without calling fetch", async () => {
    mockEnv.sentryAuthToken = undefined;
    const fetchSpy = mockFetchOnce([]);
    const result = await listSentryIssues({ environment: "production" });
    expect(result).toEqual({ configured: false, issues: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("listSentryIssues", () => {
  it("passes environment and query to the Sentry API URL", async () => {
    const fetchSpy = mockFetchOnce([]);
    await listSentryIssues({
      environment: "development",
      query: "is:resolved",
    });
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("/projects/my-org/my-project/issues/");
    expect(url).toContain("environment=development");
    expect(url).toContain("query=is%3Aresolved");
  });

  it("defaults to is:unresolved for the production environment", async () => {
    const fetchSpy = mockFetchOnce([]);
    await listSentryIssues({ environment: "production" });
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("environment=production");
    expect(url).toContain("query=is%3Aunresolved");
  });

  it("sends the auth token as a Bearer header", async () => {
    const fetchSpy = mockFetchOnce([]);
    await listSentryIssues({ environment: "production" });
    const init = fetchSpy.mock.calls[0]![1] as {
      headers: Record<string, string>;
    };
    expect(init.headers["Authorization"]).toBe("Bearer token");
  });

  it("normalises issues (string counts become numbers)", async () => {
    mockFetchOnce([
      {
        id: "123",
        shortId: "APP-1",
        title: "TypeError: boom",
        culprit: "lib/thing.ts in doThing",
        level: "error",
        count: "42",
        userCount: "3",
        firstSeen: "2026-08-14T00:00:00Z",
        lastSeen: "2026-08-15T00:00:00Z",
        permalink: "https://sentry.io/x/123",
        status: "unresolved",
      },
    ]);
    const result = await listSentryIssues({ environment: "production" });
    expect(result.configured).toBe(true);
    expect(result.issues).toHaveLength(1);
    const issue = result.issues[0]!;
    expect(issue.count).toBe(42);
    expect(issue.userCount).toBe(3);
    expect(issue.title).toBe("TypeError: boom");
    expect(issue.permalink).toBe("https://sentry.io/x/123");
  });

  it("throws on a non-OK response", async () => {
    mockFetchOnce({ detail: "nope" }, false, 403);
    await expect(
      listSentryIssues({ environment: "production" }),
    ).rejects.toThrow(/403/);
  });

  it("throws on a non-array response body", async () => {
    mockFetchOnce({ detail: "weird" });
    await expect(
      listSentryIssues({ environment: "production" }),
    ).rejects.toThrow(/non-array/);
  });
});
