import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  all: vi.fn(),
  one: vi.fn(),
  refresh: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: {
    select: () => ({
      from: () => ({
        then: (
          resolve: (rows: unknown) => unknown,
          reject: (err: unknown) => unknown,
        ) => mocks.all().then(resolve, reject),
        where: () => ({ limit: mocks.one }),
      }),
    }),
    update: mocks.update,
  },
}));
vi.mock("./gmail-oauth", () => ({
  createGmailOAuthClient: vi.fn(),
}));
vi.mock("./google-oauth", () => ({
  OAUTH_EXPIRY_BUFFER_MS: 60_000,
  refreshGoogleToken: mocks.refresh,
}));
vi.mock("./token-encryption", () => ({
  encryptToken: vi.fn(),
  decryptToken: (value: string) => value,
}));
vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  getAllGmailConnections,
  getValidGmailAccessToken,
} from "./gmail-tokens";

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
});
afterEach(() => vi.useRealTimers());

function transientReadError() {
  return new Error("Failed query", {
    cause: new Error("Connection terminated due to connection timeout"),
  });
}

describe("Gmail connection read retries", () => {
  it("recovers connection enumeration after a wrapped transient DB failure", async () => {
    mocks.all
      .mockRejectedValueOnce(transientReadError())
      .mockResolvedValueOnce([]);
    const result = getAllGmailConnections();
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual([]);
    expect(mocks.all).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("recovers the access-token read without refreshing or writing tokens", async () => {
    mocks.one
      .mockRejectedValueOnce(transientReadError())
      .mockResolvedValueOnce([
        {
          accessToken: "fixture-token",
          accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        },
      ]);
    const result = getValidGmailAccessToken(1);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("fixture-token");
    expect(mocks.one).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(["all", "one"] as const)(
    "propagates exhausted %s reads after exactly two attempts",
    async (key) => {
      const error = transientReadError();
      mocks[key].mockRejectedValue(error);
      const result =
        key === "all" ? getAllGmailConnections() : getValidGmailAccessToken(1);
      const assertion = expect(result).rejects.toBe(error);
      await vi.runAllTimersAsync();
      await assertion;
      expect(mocks[key]).toHaveBeenCalledTimes(2);
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it.each(["all", "one"] as const)(
    "does not retry permanent %s read errors",
    async (key) => {
      const error = new Error("permission denied for table");
      mocks[key].mockRejectedValue(error);
      const result =
        key === "all" ? getAllGmailConnections() : getValidGmailAccessToken(1);
      await expect(result).rejects.toBe(error);
      expect(mocks[key]).toHaveBeenCalledTimes(1);
    },
  );
});
