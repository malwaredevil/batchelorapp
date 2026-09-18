#!/usr/bin/env tsx
/**
 * Regression coverage for restoring backups made before AgentPhone's
 * outbound-call state columns were added.
 */

import assert from "node:assert/strict";
import { copyTable } from "./restore-from-replit.js";

type QueryCall = { text: string; values?: unknown[] };

const sourceCalls: QueryCall[] = [];
const source = {
  async query(text: string, values?: unknown[]) {
    sourceCalls.push({ text, values });
    if (text.includes("information_schema.columns")) {
      return {
        rows: [
          { column_name: "id" },
          { column_name: "phone_number" },
          { column_name: "user_id" },
          { column_name: "messages" },
          { column_name: "updated_at" },
        ],
      };
    }
    return {
      rows: [
        {
          id: 7,
          phone_number: "+15555550123",
          user_id: 3,
          messages: [{ role: "user", content: "hello" }],
          pending_outbound_id: null,
          pending_outbound_call_id: null,
          pending_outbound_opening: null,
          pending_outbound_private_context: null,
          pending_outbound_expires_at: null,
          version: 0,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
  },
} as never;

const destinationCalls: QueryCall[] = [];
const dest = {
  async query(text: string, values?: unknown[]) {
    destinationCalls.push({ text, values });
    return { rows: [] };
  },
} as never;

const copied = await copyTable(source, dest, {
  table: "agentphone_conversations",
  columns: [
    "id",
    "phone_number",
    "user_id",
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
const select = sourceCalls.find(
  (call) =>
    call.text.startsWith("SELECT") &&
    !call.text.includes("information_schema.columns"),
);
assert.ok(select);
assert.match(select.text, /NULL AS pending_outbound_id/);
assert.match(select.text, /NULL AS pending_outbound_call_id/);
assert.match(select.text, /NULL AS pending_outbound_opening/);
assert.match(select.text, /NULL AS pending_outbound_private_context/);
assert.match(select.text, /NULL AS pending_outbound_expires_at/);
assert.match(select.text, /0 AS version/);
assert.match(select.text, /ORDER BY id/);

assert.equal(destinationCalls.length, 1);
assert.deepEqual(destinationCalls[0].values, [
  7,
  "+15555550123",
  3,
  JSON.stringify([{ role: "user", content: "hello" }]),
  null,
  null,
  null,
  null,
  null,
  0,
  "2026-01-01T00:00:00.000Z",
]);

console.log("restore-from-replit.test: passed");
