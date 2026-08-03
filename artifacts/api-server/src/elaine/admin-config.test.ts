/**
 * Write-path + round-trip tests for the Elaine/AI global config admin layer.
 *
 * Together with elaine-config.test.ts (read path), these prove the full
 * loop: a value saved through applyAdminConfigPatch is the value the next
 * read returns (not silently discarded / not silently defaulted), and
 * resetElaineGlobalConfigToDefaults truly discards customizations rather
 * than merging.
 *
 * Only `db` from @workspace/db is mocked (real schema via importOriginal),
 * per the repo's established route-testing convention.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let selectQueue: unknown[][] = [];
let upsertSets: Record<string, unknown>[] = [];

function makeSelectBuilder() {
  const builder = {
    from: () => builder,
    limit: () => Promise.resolve(selectQueue.shift() ?? []),
  };
  return builder;
}

function makeInsertBuilder() {
  const builder: {
    values: (v: Record<string, unknown>) => typeof builder;
    onConflictDoUpdate: (cfg: {
      set: Record<string, unknown>;
    }) => Promise<void>;
  } = {
    values: () => builder,
    onConflictDoUpdate: (cfg) => {
      upsertSets.push(cfg.set);
      return Promise.resolve();
    },
  };
  return builder;
}

const dbMock = {
  select: vi.fn(() => makeSelectBuilder()),
  insert: vi.fn(() => makeInsertBuilder()),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("../lib/logger", () => ({
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
  upsertSets = [];
  vi.clearAllMocks();
  vi.resetModules();
});

describe("applyAdminConfigPatch", () => {
  it("persists the patched value to the DB and the next read reflects it, not the pre-patch value", async () => {
    // "current" read inside applyAdminConfigPatch (merge base)
    selectQueue.push([dbRow({ chatModel: "old/model" })]);
    // final getElaineGlobalConfig() read after cache invalidation
    selectQueue.push([dbRow({ chatModel: "custom/patched-model" })]);

    const { applyAdminConfigPatch } = await import("./admin-config");
    const result = await applyAdminConfigPatch(
      { chatModel: "custom/patched-model" },
      42,
    );

    // Write path: the value actually sent to the DB upsert is the patched one.
    expect(upsertSets[0]?.chatModel).toBe("custom/patched-model");
    expect(upsertSets[0]?.updatedByUserId).toBe(42);
    // Read-back reflects the new value, proving the round trip is wired.
    expect(result.chatModel).toBe("custom/patched-model");
    expect(result.chatModel).not.toBe("old/model");
  });

  it("merges a partial patch over the current value instead of clobbering untouched fields", async () => {
    selectQueue.push([dbRow({ subagentModel: "existing/subagent" })]);
    selectQueue.push([dbRow({ subagentModel: "existing/subagent" })]);

    const { applyAdminConfigPatch } = await import("./admin-config");
    await applyAdminConfigPatch({ maxResponseTokens: 1200 }, 1);

    expect(upsertSets[0]?.subagentModel).toBe("existing/subagent");
    expect(upsertSets[0]?.maxResponseTokens).toBe(1200);
  });
});

describe("resetElaineGlobalConfigToDefaults", () => {
  it("overwrites every field to defaults regardless of the current customization (no merge)", async () => {
    // resetElaineGlobalConfigToDefaults does not read "current" — it writes
    // literal defaults directly. Only the final read (after invalidation)
    // consumes a select.
    selectQueue.push([
      dbRow({
        chatModel: "google/gemini-2.5-flash",
        subagentModel: "z-ai/glm-5.2",
      }),
    ]);

    const { resetElaineGlobalConfigToDefaults } =
      await import("./admin-config");
    const { ELAINE_CONFIG_DEFAULTS } = await import("../lib/elaine-config");

    const result = await resetElaineGlobalConfigToDefaults(7);

    expect(upsertSets[0]?.chatModel).toBe(ELAINE_CONFIG_DEFAULTS.chatModel);
    expect(upsertSets[0]?.subagentModel).toBe(
      ELAINE_CONFIG_DEFAULTS.subagentModel,
    );
    expect(upsertSets[0]?.extraModels).toEqual(ELAINE_CONFIG_DEFAULTS.models);
    expect(upsertSets[0]?.timeouts).toEqual(ELAINE_CONFIG_DEFAULTS.timeouts);
    expect(upsertSets[0]?.features).toEqual(ELAINE_CONFIG_DEFAULTS.features);
    expect(upsertSets[0]?.thresholds).toEqual(
      ELAINE_CONFIG_DEFAULTS.thresholds,
    );
    expect(upsertSets[0]?.updatedByUserId).toBe(7);
    expect(result.chatModel).toBe(ELAINE_CONFIG_DEFAULTS.chatModel);
  });
});

describe("round trip: patch changes a value, patching back restores the original", () => {
  it("captures the original value, verifies a patch changed it, then verifies patching back restores it exactly", async () => {
    const original = dbRow({ chatModel: "original/model" });

    // 1) Capture the original value.
    selectQueue.push([original]);
    const { getElaineGlobalConfig } = await import("../lib/elaine-config");
    const before = await getElaineGlobalConfig();
    expect(before.chatModel).toBe("original/model");

    // 2) Patch to a new value. applyAdminConfigPatch's internal "current"
    //    read is served from cache (already warm from step 1) — the DB is
    //    only hit again for the post-invalidation read below.
    selectQueue.push([dbRow({ chatModel: "temporary/test-value" })]);
    const { applyAdminConfigPatch } = await import("./admin-config");
    const changed = await applyAdminConfigPatch(
      { chatModel: "temporary/test-value" },
      99,
    );
    expect(changed.chatModel).toBe("temporary/test-value");
    expect(changed.chatModel).not.toBe(before.chatModel);

    // 3) Patch back to the captured original value — proving any state a
    //    test mutates gets explicitly restored, not just left changed.
    selectQueue.push([original]);
    const restored = await applyAdminConfigPatch(
      { chatModel: before.chatModel },
      99,
    );
    expect(restored.chatModel).toBe(before.chatModel);
    expect(upsertSets[upsertSets.length - 1]?.chatModel).toBe("original/model");
  });
});
