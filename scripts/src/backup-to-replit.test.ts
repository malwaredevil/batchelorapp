#!/usr/bin/env tsx
/** Regression coverage for backing up from a source before new columns migrated. */

import assert from "node:assert/strict";
import { copyTable } from "./copy-table-helpers.js";

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

console.log("backup-to-replit.test: passed");
