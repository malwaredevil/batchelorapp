/**
 * Round-trip integrity tests for the Elaine/AI global config read path.
 *
 * These exist to catch a specific class of bug: the owner panel silently
 * reading/showing hardcoded defaults instead of the value actually stored in
 * `elaine_global_config`. Every "reads the DB" test below asserts the
 * returned value differs from ELAINE_CONFIG_DEFAULTS AND matches the mocked
 * row — proving the value genuinely came off the (mocked) database, not the
 * defaults fallback.
 *
 * Only `db` from @workspace/db is mocked (real schema via importOriginal),
 * per the repo's established route-testing convention.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let selectQueue: unknown[][] = [];

function makeSelectBuilder() {
  const builder = {
    from: () => builder,
    limit: () => Promise.resolve(selectQueue.shift() ?? []),
  };
  return builder;
}

const dbMock = {
  select: vi.fn(() => makeSelectBuilder()),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function dbRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    chatModel: "google/gemini-2.5-flash",
    subagentModel: "z-ai/glm-5.2",
    requestTimeoutMs: 12_000,
    maxResponseTokens: 700,
    extraModels: {},
    timeouts: {},
    features: {},
    thresholds: {},
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  selectQueue = [];
  vi.clearAllMocks();
  vi.resetModules();
});

describe("getElaineGlobalConfig", () => {
  it("falls back to hardcoded defaults only when no row exists", async () => {
    selectQueue.push([]);
    const { getElaineGlobalConfig, ELAINE_CONFIG_DEFAULTS } = await import(
      "./elaine-config"
    );
    const config = await getElaineGlobalConfig();
    expect(config).toEqual(ELAINE_CONFIG_DEFAULTS);
  });

  it("reads the live value from the stored DB row, not the hardcoded default", async () => {
    selectQueue.push([dbRow({ chatModel: "custom/model-from-db" })]);
    const { getElaineGlobalConfig, ELAINE_CONFIG_DEFAULTS } = await import(
      "./elaine-config"
    );
    const config = await getElaineGlobalConfig();
    expect(config.chatModel).toBe("custom/model-from-db");
    expect(config.chatModel).not.toBe(ELAINE_CONFIG_DEFAULTS.chatModel);
  });

  it("merges stored jsonb overrides on top of defaults for nested config", async () => {
    selectQueue.push([
      dbRow({ features: { enableAdvisor: false } }),
    ]);
    const { getElaineGlobalConfig, ELAINE_CONFIG_DEFAULTS } = await import(
      "./elaine-config"
    );
    const config = await getElaineGlobalConfig();
    expect(config.features.enableAdvisor).toBe(false);
    expect(ELAINE_CONFIG_DEFAULTS.features.enableAdvisor).not.toBe(false);
    // Untouched sibling feature flags still come from defaults.
    expect(config.features.enableSubagent).toBe(
      ELAINE_CONFIG_DEFAULTS.features.enableSubagent,
    );
  });

  it("caches the result and does not re-query the DB within the TTL", async () => {
    selectQueue.push([dbRow()]);
    const { getElaineGlobalConfig } = await import("./elaine-config");
    await getElaineGlobalConfig();
    await getElaineGlobalConfig();
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it("invalidateElaineGlobalConfigCache() forces the next read to hit the DB again and reflect the new row", async () => {
    selectQueue.push([dbRow({ chatModel: "model/before" })]);
    selectQueue.push([dbRow({ chatModel: "model/after" })]);
    const { getElaineGlobalConfig, invalidateElaineGlobalConfigCache } =
      await import("./elaine-config");

    const before = await getElaineGlobalConfig();
    invalidateElaineGlobalConfigCache();
    const after = await getElaineGlobalConfig();

    expect(dbMock.select).toHaveBeenCalledTimes(2);
    expect(before.chatModel).toBe("model/before");
    expect(after.chatModel).toBe("model/after");
  });

  it("falls back to defaults (fail-closed, not a crash) if the DB read throws", async () => {
    dbMock.select.mockImplementationOnce(() => {
      throw new Error("connection refused");
    });
    const { getElaineGlobalConfig, ELAINE_CONFIG_DEFAULTS } = await import(
      "./elaine-config"
    );
    const config = await getElaineGlobalConfig();
    expect(config).toEqual(ELAINE_CONFIG_DEFAULTS);
  });
});
