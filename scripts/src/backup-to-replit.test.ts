#!/usr/bin/env tsx
/** Regression coverage for backing up from a source before new columns migrated. */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { copyTable } from "./copy-table-helpers.js";
import {
  BACKUP_CONNECTION_TIMEOUT_MS,
  connectBackupClients,
  withBackupSnapshot,
} from "./backup-connections.js";

const sourceQueries: string[] = [];
const source = {
  async query(text: string) {
    sourceQueries.push(text);
    if (text.includes("information_schema.columns")) {
      return {
        rows: [
          { column_name: "id" },
          { column_name: "messages" },
          { column_name: "updated_at" },
        ],
      };
    }
    return {
      rows: [{ id: 1, messages: { role: "user" }, updated_at: "2026-01-01" }],
    };
  },
} as never;

const destinationQueries: string[] = [];
const dest = {
  async query(text: string) {
    destinationQueries.push(text);
    return { rows: [] };
  },
} as never;

const copied = await copyTable(source, dest, {
  table: "agentphone_conversations",
  columns: [
    "id",
    "messages",
    "pending_outbound_id",
    "pending_outbound_call_id",
    "pending_outbound_opening",
    "pending_outbound_private_context",
    "pending_outbound_expires_at",
    "version",
    "updated_at",
  ],
  orderBy: "id",
  jsonbColumns: ["messages"],
  missingColumnDefaults: {
    pending_outbound_id: "NULL",
    pending_outbound_call_id: "NULL",
    pending_outbound_opening: "NULL",
    pending_outbound_private_context: "NULL",
    pending_outbound_expires_at: "NULL",
    version: "0",
  },
});

assert.equal(copied, 1);
const select = sourceQueries.find(
  (query) =>
    query.startsWith("SELECT") && !query.includes("information_schema.columns"),
);
assert.ok(select);
assert.match(select, /NULL AS "pending_outbound_id"/);
assert.match(select, /NULL AS "pending_outbound_call_id"/);
assert.match(select, /NULL AS "pending_outbound_opening"/);
assert.match(select, /NULL AS "pending_outbound_private_context"/);
assert.match(select, /NULL AS "pending_outbound_expires_at"/);
assert.match(select, /0 AS "version"/);
assert.match(select, /ORDER BY "id"/);
assert.match(
  destinationQueries[0] ?? "",
  /TRUNCATE "agentphone_conversations" CASCADE/,
);
assert.match(
  destinationQueries[1] ?? "",
  /INSERT INTO "agentphone_conversations" \("id", "messages"/,
);

assert.equal(BACKUP_CONNECTION_TIMEOUT_MS, 10_000);
const backupSource = readFileSync(
  new URL("./backup-to-replit.ts", import.meta.url),
  "utf8",
);
assert.equal(
  backupSource.match(/connectionTimeoutMillis: BACKUP_CONNECTION_TIMEOUT_MS/g)
    ?.length,
  2,
  "both database clients must have a connection deadline",
);
for (const failingSide of ["source", "destination", "neither"]) {
  const events: string[] = [];
  const client = (side: string) => ({
    async connect() {
      events.push(`connect:${side}`);
      if (side === failingSide) throw new Error("Connection timed out");
    },
    async end() {
      events.push(`end:${side}`);
    },
  });
  const connect = connectBackupClients(client("source"), client("destination"));
  if (failingSide === "neither") {
    await connect;
    assert.deepEqual(events, ["connect:source", "connect:destination"]);
  } else {
    await assert.rejects(connect, /Connection timed out/);
    assert.ok(events.includes("end:source"));
    assert.ok(events.includes("end:destination"));
    if (failingSide === "source") {
      assert.ok(!events.includes("connect:destination"));
    }
  }
}

// Model the destination's transaction boundary, including a partial table copy.
// No real database or production rows are used.
for (const failure of ["mid-copy", "commit", "disconnected", "none"]) {
  const previous = [{ id: 1, name: "previous complete snapshot" }];
  let committed = structuredClone(previous);
  let pending: typeof previous | undefined;
  let recorded = false;
  let pendingHistory = false;
  const statements: string[] = [];
  const destination = {
    async query(sql: string) {
      statements.push(sql);
      if (sql === "BEGIN") pending = structuredClone(committed);
      if (sql === "TRUNCATE") pending = [];
      if (sql === "INSERT") pending!.push({ id: 2, name: "partial new copy" });
      if (sql === "HISTORY") pendingHistory = true;
      if (sql === "COMMIT") {
        if (failure === "commit") throw new Error("Commit failed");
        committed = pending!;
        recorded = pendingHistory;
        pending = undefined;
      }
      if (sql === "ROLLBACK") {
        pending = undefined;
        pendingHistory = false;
        if (failure === "disconnected") throw new Error("Connection closed");
      }
    },
  };
  const result = withBackupSnapshot(destination, async () => {
    await destination.query("TRUNCATE");
    await destination.query("INSERT");
    if (failure === "mid-copy" || failure === "disconnected") {
      throw new Error("Copy interrupted");
    }
    await destination.query("HISTORY");
    return "complete";
  });
  if (failure === "none") {
    assert.equal(await result, "complete");
    assert.deepEqual(committed, [{ id: 2, name: "partial new copy" }]);
    assert.equal(recorded, true);
    assert.equal(statements.at(-1), "COMMIT");
  } else {
    await assert.rejects(result, /Copy interrupted|Commit failed/);
    assert.deepEqual(committed, previous, "retain the previous snapshot");
    assert.equal(recorded, false, "do not record an incomplete backup");
    assert.equal(statements.at(-1), "ROLLBACK");
  }
  assert.equal(statements[0], "BEGIN");
}

// Execute the real setup script with fake tools: never install, migrate, or
// contact a database during a regression test.
const tools = mkdtempSync(join(tmpdir(), "backup-setup-test-"));
try {
  writeFileSync(
    join(tools, "pnpm"),
    '#!/bin/bash\nif [[ "$*" == *backup-to-replit* && "$BACKUP_TEST_MODE" == failure ]]; then exit 1; fi\nif [[ "$*" == *bootstrap* && "$BACKUP_TEST_MODE" == bootstrap-failure ]]; then exit 1; fi\n',
    { mode: 0o700 },
  );
  writeFileSync(
    join(tools, "timeout"),
    '#!/bin/bash\n[[ "$1" == --kill-after=5s && "$2" == 120s ]] || exit 99\nif [[ "$BACKUP_TEST_MODE" == timeout ]]; then exit 124; fi\nshift 2\nexec "$@"\n',
    { mode: 0o700 },
  );
  const script = fileURLToPath(new URL("../post-merge.sh", import.meta.url));
  const run = (mode: string) =>
    execFileSync("bash", [script], {
      env: {
        ...process.env,
        PATH: `${tools}:${process.env.PATH}`,
        BACKUP_TEST_MODE: mode,
      },
      encoding: "utf8",
    });
  assert.match(run("success"), /✓ Backup complete/);
  for (const mode of ["failure", "timeout"]) {
    const output = run(mode);
    assert.match(output, /WARNING: Backup failed or timed out/);
    assert.doesNotMatch(output, /✓ Backup complete/);
  }
  assert.throws(() => run("bootstrap-failure"));
} finally {
  rmSync(tools, { recursive: true, force: true });
}

console.log("backup-to-replit.test: passed");
