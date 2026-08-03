import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any `await import()` of the module under test
// ---------------------------------------------------------------------------

const selectQueue: unknown[][] = [];
const updateCalls: { set: unknown }[] = [];

const dbMock = {
  select: vi.fn(() => {
    const resultPromise = Promise.resolve(selectQueue.shift() ?? []);
    return {
      from() {
        return this;
      },
      where() {
        return this;
      },
      limit() {
        return resultPromise;
      },
      orderBy() {
        return resultPromise;
      },
      then<T>(
        onfulfilled?: ((value: unknown[]) => T | PromiseLike<T>) | null,
      ): Promise<T> {
        return resultPromise.then(onfulfilled) as Promise<T>;
      },
    };
  }),
  update: vi.fn(() => {
    const builder = {
      set(set: unknown) {
        updateCalls.push({ set });
        return builder;
      },
      where() {
        return Promise.resolve(undefined);
      },
    };
    return builder;
  }),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

const refreshGoogleToken = vi.fn<
  (client: unknown) => Promise<{ accessToken: string; expiresAt: Date } | null>
>();
vi.mock("./google-oauth", () => ({
  OAUTH_EXPIRY_BUFFER_MS: 60_000,
  refreshGoogleToken: (client: unknown) => refreshGoogleToken(client),
}));

vi.mock("./google-calendar-oauth", () => ({
  createGoogleCalendarClient: () => ({
    setCredentials: vi.fn(),
  }),
}));

// Simple pass-through stubs so encrypted-token round-trips work in tests.
vi.mock("./token-encryption", () => ({
  encryptToken: (t: string) => `enc:${t}`,
  decryptToken: (t: string) => (t.startsWith("enc:") ? t.slice(4) : t),
}));

vi.mock("./logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnectionRow(overrides: Partial<{
  userId: number;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
  needsReauth: boolean;
}> = {}) {
  return {
    userId: 1,
    refreshToken: "enc:refresh-tok",
    accessToken: null,
    accessTokenExpiresAt: null,
    needsReauth: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getValidAccessToken", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updateCalls.length = 0;
    vi.clearAllMocks();
  });

  it("returns null immediately when the user has no connection row", async () => {
    selectQueue.push([]); // no row found
    const { getValidAccessToken } = await import("./google-calendar-tokens");

    const result = await getValidAccessToken(1);

    expect(result).toBeNull();
    expect(refreshGoogleToken).not.toHaveBeenCalled();
  });

  it("returns the decrypted access token directly when it is not yet expired", async () => {
    const futureExpiry = new Date(Date.now() + 3_600_000); // 1 hour from now
    selectQueue.push([
      makeConnectionRow({
        accessToken: "enc:cached-access",
        accessTokenExpiresAt: futureExpiry,
      }),
    ]);
    const { getValidAccessToken } = await import("./google-calendar-tokens");

    const result = await getValidAccessToken(1);

    expect(result).toBe("cached-access");
    expect(refreshGoogleToken).not.toHaveBeenCalled();
  });

  it("refreshes and returns a new access token when the stored one is expired", async () => {
    const pastExpiry = new Date(Date.now() - 1_000);
    selectQueue.push([
      makeConnectionRow({
        accessToken: "enc:old-access",
        accessTokenExpiresAt: pastExpiry,
      }),
    ]);
    const newExpiry = new Date(Date.now() + 3_600_000);
    refreshGoogleToken.mockResolvedValue({
      accessToken: "fresh-access",
      expiresAt: newExpiry,
    });
    const { getValidAccessToken } = await import("./google-calendar-tokens");

    const result = await getValidAccessToken(1);

    expect(result).toBe("fresh-access");
    expect(refreshGoogleToken).toHaveBeenCalledOnce();
    // Should have written the new token back to the DB
    expect(dbMock.update).toHaveBeenCalledOnce();
    const written = updateCalls[0]?.set as Record<string, unknown>;
    expect(written?.accessToken).toBe("enc:fresh-access");
    expect(written?.needsReauth).toBe(false);
  });

  it("sets needsReauth:true on the DB row when refresh fails with invalid_grant", async () => {
    selectQueue.push([makeConnectionRow({ accessToken: null, accessTokenExpiresAt: null })]);
    const grantError = new Error("invalid_grant");
    refreshGoogleToken.mockRejectedValue(grantError);
    const { getValidAccessToken } = await import("./google-calendar-tokens");

    const result = await getValidAccessToken(1);

    expect(result).toBeNull();
    // The DB update that marks needsReauth:true must have been called
    expect(dbMock.update).toHaveBeenCalledOnce();
    const written = updateCalls[0]?.set as Record<string, unknown>;
    expect(written?.needsReauth).toBe(true);
  });

  it("sets needsReauth:true when the error carries invalid_grant in response.data.error", async () => {
    selectQueue.push([makeConnectionRow({ accessToken: null, accessTokenExpiresAt: null })]);
    // Simulate the googleapis SDK error shape
    const sdkError = Object.assign(new Error("Token has been expired or revoked."), {
      response: { data: { error: "invalid_grant" } },
    });
    refreshGoogleToken.mockRejectedValue(sdkError);
    const { getValidAccessToken } = await import("./google-calendar-tokens");

    const result = await getValidAccessToken(1);

    expect(result).toBeNull();
    expect(dbMock.update).toHaveBeenCalledOnce();
    const written = updateCalls[0]?.set as Record<string, unknown>;
    expect(written?.needsReauth).toBe(true);
  });

  it("does NOT set needsReauth when the error is a transient network failure", async () => {
    selectQueue.push([makeConnectionRow({ accessToken: null, accessTokenExpiresAt: null })]);
    refreshGoogleToken.mockRejectedValue(new Error("ECONNREFUSED"));
    const { getValidAccessToken } = await import("./google-calendar-tokens");

    const result = await getValidAccessToken(1);

    expect(result).toBeNull();
    // No DB write for a non-invalid_grant error
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("returns null and does not throw when refreshGoogleToken returns null", async () => {
    selectQueue.push([makeConnectionRow({ accessToken: null, accessTokenExpiresAt: null })]);
    refreshGoogleToken.mockResolvedValue(null);
    const { getValidAccessToken } = await import("./google-calendar-tokens");

    const result = await getValidAccessToken(1);

    expect(result).toBeNull();
    // No update since we didn't get a token back but also didn't throw
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});
