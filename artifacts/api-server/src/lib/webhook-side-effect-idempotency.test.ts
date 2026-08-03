/**
 * Covers the webhook side-effect idempotency ledger used by AgentPhone SMS
 * and Elaine email replies to prevent double-sends on duplicate webhook
 * deliveries.
 *
 * The regression this guards against: `claimWebhookSideEffect`'s
 * ON CONFLICT reclaim clause originally only matched a stuck 'processing'
 * row (crash mid-send) after a 5-minute cooldown. It never matched a
 * 'failed' row, so once `markWebhookSideEffectFailed` recorded a transient
 * send error, that effect key could never be reclaimed again by any future
 * legitimate retry/redelivery — the exact scenario this ledger exists to
 * support. The fix allows 'failed' rows to be reclaimed immediately.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, update, set, where } = vi.hoisted(() => ({
  execute: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: { execute, update },
  };
});

import {
  claimWebhookSideEffect,
  cleanupOldWebhookSideEffects,
  markWebhookSideEffectCompleted,
  markWebhookSideEffectFailed,
} from "./webhook-side-effect-idempotency";

describe("claimWebhookSideEffect", () => {
  beforeEach(() => {
    execute.mockReset();
    update.mockReset();
    set.mockReset();
    where.mockReset();
    update.mockReturnValue({ set });
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);
  });

  it("claims a brand-new effect key (INSERT path)", async () => {
    execute.mockResolvedValue({ rows: [{ effect_key: "k1" }] });
    await expect(
      claimWebhookSideEffect({
        effectKey: "k1",
        provider: "agentphone",
        channel: "sms",
      }),
    ).resolves.toBe(true);
  });

  it("does NOT reclaim a row still actively processing (duplicate delivery)", async () => {
    // The DB simulates its own WHERE clause: an in-flight 'processing' row
    // younger than 5 minutes never matches the UPDATE, so RETURNING is empty.
    execute.mockResolvedValue({ rows: [] });
    await expect(
      claimWebhookSideEffect({
        effectKey: "k2",
        provider: "agentphone",
        channel: "sms",
      }),
    ).resolves.toBe(false);
  });

  it("reclaims a row left 'failed' by a prior send attempt (the fixed bug)", async () => {
    execute.mockResolvedValue({ rows: [{ effect_key: "k3" }] });
    await expect(
      claimWebhookSideEffect({
        effectKey: "k3",
        provider: "resend",
        channel: "email",
      }),
    ).resolves.toBe(true);
  });

  it("has a reclaim clause that matches 'failed' rows, not just stuck 'processing' rows", () => {
    // Static guard on the raw SQL source: asserts a future edit can't
    // silently drop the OR'd failed-status branch while every mock-driven
    // behavioral test above keeps passing.
    const sourcePath = fileURLToPath(
      new URL("./webhook-side-effect-idempotency.ts", import.meta.url),
    );
    const source = readFileSync(sourcePath, "utf-8");
    expect(source).toMatch(/status\s*=\s*'failed'/);
  });

  it("reclaims a stuck 'processing' row after the cooldown window", async () => {
    execute.mockResolvedValue({ rows: [{ effect_key: "k4" }] });
    await expect(
      claimWebhookSideEffect({
        effectKey: "k4",
        provider: "agentphone",
        channel: "sms",
      }),
    ).resolves.toBe(true);
  });
});

describe("markWebhookSideEffectCompleted / markWebhookSideEffectFailed", () => {
  beforeEach(() => {
    update.mockReset();
    set.mockReset();
    where.mockReset();
    update.mockReturnValue({ set });
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);
  });

  it("marks an effect completed", async () => {
    await markWebhookSideEffectCompleted("k1");
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", lastError: null }),
    );
  });

  it("marks an effect failed and never throws even if persistence itself fails", async () => {
    where.mockRejectedValueOnce(new Error("db down"));
    await expect(
      markWebhookSideEffectFailed("k2", new Error("send failed")),
    ).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", lastError: "send failed" }),
    );
  });
});

describe("cleanupOldWebhookSideEffects", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("returns the number of rows the DELETE removed", async () => {
    execute.mockResolvedValue({
      rows: [{ effect_key: "old1" }, { effect_key: "old2" }],
    });
    await expect(cleanupOldWebhookSideEffects()).resolves.toBe(2);
  });

  it("returns 0 when nothing is old enough to delete", async () => {
    execute.mockResolvedValue({ rows: [] });
    await expect(cleanupOldWebhookSideEffects()).resolves.toBe(0);
  });

  it("deletes by age regardless of status, so permanently-stuck rows can't accumulate forever", () => {
    // Static guard: the retention query must not filter on `status`, or a
    // row stuck in one particular state (e.g. never-retried 'processing')
    // could silently outlive every other row and defeat the cleanup.
    const sourcePath = fileURLToPath(
      new URL("./webhook-side-effect-idempotency.ts", import.meta.url),
    );
    const source = readFileSync(sourcePath, "utf-8");
    const fnBody = source.slice(
      source.indexOf("export async function cleanupOldWebhookSideEffects"),
      source.indexOf("export function startWebhookSideEffectCleanupScheduler"),
    );
    expect(fnBody).toMatch(/DELETE FROM app_webhook_side_effects/);
    expect(fnBody).not.toMatch(/status/);
  });
});
