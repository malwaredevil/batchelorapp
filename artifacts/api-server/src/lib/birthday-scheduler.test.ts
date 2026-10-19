import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  users: vi.fn(),
  completed: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: {
    execute: mocks.execute,
    select: () => ({ from: () => ({ where: mocks.users }) }),
    update: () => ({ set: () => ({ where: mocks.completed }) }),
  },
}));
vi.mock("./email", () => ({
  resendConfigured: () => true,
  sendBirthdayEmail: mocks.send,
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  runBirthdayEmails,
  startBirthdayScheduler,
} from "./birthday-scheduler";

const POLL = 15 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const dialect = new PgDialect();

describe("birthday calendar-day and one-shot delivery", () => {
  let stop: (() => void) | undefined;
  let lastRun: string | null;
  let lastSuccess: string | null;
  let effects: Set<string>;
  let pauseClaim: boolean;
  let finishClaim: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T23:58:00Z"));
    vi.resetAllMocks();
    lastRun = null;
    lastSuccess = null;
    effects = new Set();
    pauseClaim = false;
    finishClaim = undefined;
    mocks.users.mockResolvedValue([
      { id: "previous", email: "previous@example.com", birthday: "10-18" },
      { id: "current", email: "current@example.com", birthday: "10-19" },
      { id: "next", email: "next@example.com", birthday: "10-20" },
    ]);
    mocks.send.mockResolvedValue(undefined);
    mocks.completed.mockResolvedValue(undefined);
    mocks.execute.mockImplementation((statement) => {
      const query = dialect.sqlToQuery(statement);
      if (query.sql.includes("INSERT INTO scheduler_runs")) {
        // Model the row-locked DB claim with its *compiled* date parameters.
        // SQL-shape assertions also protect INSERT and BOTH update CASE arms.
        expect(query.sql).toContain("WHERE (now() AT TIME ZONE 'UTC')::date");
        expect(query.sql.match(/last_run_at AT TIME ZONE 'UTC'/g)).toHaveLength(
          2,
        );
        const date = query.params[3] as string;
        expect(query.params.filter((p) => p === date)).toHaveLength(3);
        expect(query.params.filter((p) => typeof p === "boolean")).toEqual([
          false,
          false,
        ]);
        const claim = () => {
          if (date !== new Date().toISOString().slice(0, 10))
            return { rows: [] };
          const claimed = lastRun === null || lastRun.slice(0, 10) < date;
          if (claimed) lastRun = new Date().toISOString();
          return {
            rows: [
              {
                name: "birthday-emails",
                claimed,
                last_run_at: lastRun,
                last_success_at: lastSuccess,
              },
            ],
          };
        };
        if (pauseClaim) {
          return new Promise((resolve) => {
            finishClaim = () => {
              pauseClaim = false;
              resolve(claim());
            };
          });
        }
        return Promise.resolve(claim());
      }
      if (query.sql.includes("INSERT INTO app_webhook_side_effects")) {
        expect(query.params.at(-1)).toBe(false);
        expect(query.sql).toMatch(/WHERE \$\d+::boolean\s+AND \(/);
        const key = query.params[0] as string;
        if (effects.has(key)) return Promise.resolve({ rows: [] });
        effects.add(key);
        return Promise.resolve({ rows: [{ effect_key: key }] });
      }
      expect(query.sql).toContain("UPDATE scheduler_runs");
      lastSuccess = new Date().toISOString();
      return Promise.resolve({ rows: [] });
    });
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  it("does not skip a birthday when a late run finishes after midnight", async () => {
    let finishSend!: () => void;
    mocks.send.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSend = resolve;
        }),
    );
    stop = startBirthdayScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.send).toHaveBeenCalledWith("previous@example.com", null);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    finishSend();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL);
    expect(mocks.send.mock.calls.map((c) => c[0])).toEqual([
      "previous@example.com",
      "current@example.com",
    ]);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(mocks.send.mock.calls.map((c) => c[0])).toEqual([
      "previous@example.com",
      "current@example.com",
      "next@example.com",
    ]);
    expect([...effects]).toEqual([
      "birthday-email:2026-10-18:previous",
      "birthday-email:2026-10-19:current",
      "birthday-email:2026-10-20:next",
    ]);
  });

  it("preserves the date of claimed work if the user query crosses midnight", async () => {
    let finishUsers!: () => void;
    mocks.users.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUsers = () =>
            resolve([
              {
                id: "previous",
                email: "previous@example.com",
                birthday: "10-18",
              },
            ]);
        }),
    );
    stop = startBirthdayScheduler();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    finishUsers();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      "previous@example.com",
      null,
    );
    expect([...effects]).toEqual(["birthday-email:2026-10-18:previous"]);
  });

  it("rejects a date that became stale while claiming, then picks up the new day", async () => {
    pauseClaim = true;
    stop = startBirthdayScheduler();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    finishClaim!();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(lastRun).toBeNull();
    await vi.advanceTimersByTimeAsync(POLL);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      "current@example.com",
      null,
    );
  });

  it("does not replay today's run on restart, including a pre-upgrade claim", async () => {
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    lastRun = new Date().toISOString();
    stop = startBirthdayScheduler();
    await vi.advanceTimersByTimeAsync(2 * POLL);
    stop();
    stop = startBirthdayScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each(["send", "completion"] as const)(
    "never retries an uncertain %s even after the old ledger reclaim window",
    async (stage) => {
      if (stage === "send")
        mocks.send.mockRejectedValueOnce(new Error("unknown provider outcome"));
      else
        mocks.completed.mockRejectedValueOnce(
          new Error("receipt write unavailable"),
        );
      await runBirthdayEmails("2026-10-18");
      await vi.advanceTimersByTimeAsync(2 * POLL);
      await runBirthdayEmails("2026-10-18");
      expect(mocks.send).toHaveBeenCalledTimes(1);
      expect(effects.size).toBe(1);
    },
  );
});
