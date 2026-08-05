import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTION_TOOLS,
  CALCULATE_YARDAGE_TOOL_NAME,
  CONSULT_EXPERTS_TOOL_NAME,
  EBAY_SEARCH_TOOL_NAME,
  FETCH_PAGE_TOOL_NAME,
  FIND_NEARBY_PLACES_TOOL_NAME,
  GENERATE_DOCUMENT_TOOL_NAME,
  GET_AIR_QUALITY_TOOL_NAME,
  GET_EXCHANGE_RATE_TOOL_NAME,
  GET_POLLEN_FORECAST_TOOL_NAME,
  GET_ROUTE_INFO_TOOL_NAME,
  GET_WEATHER_TOOL_NAME,
  LOOKUP_BARCODE_TOOL_NAME,
  QUERY_HOUSEHOLD_TOOL_NAME,
  REMEMBER_TOOL_NAME,
  SEARCH_FLIGHTS_TOOL_NAME,
  SEARCH_HALLMARK_TOOL_NAME,
  SEARCH_HOUSEHOLD_TOOL_NAME,
  SEARCH_TRIP_DOCUMENTS_TOOL_NAME,
  SHOW_DATA_CARD_TOOL_NAME,
  SHOW_FABRIC_SWATCH_TOOL_NAME,
  SHOW_ORNAMENT_ITEM_TOOL_NAME,
  SHOW_POTTERY_ITEM_TOOL_NAME,
  SHOW_TRIP_CARD_TOOL_NAME,
  SOFT_TOOLS,
  SOFT_TOOLS_EXTRA,
  SUGGEST_CLOTHING_LAYERS_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
} from "./planner-tool-catalog";
import {
  LIST_CONTACT_CHANNELS_TOOL_NAME,
  LIST_SCHEDULED_CONTACTS_TOOL_NAME,
} from "./communication-actions";
import { LIST_ELAINE_MEMORIES_TOOL_NAME } from "./universal-read-tools";
import {
  ELAINE_TOOL_POLICIES,
  NARROW_READ_CHANNEL_JUSTIFICATIONS,
} from "./capability-registry";
import {
  RESTRICTED_EXCLUDED_ACTION_TYPES,
  RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE,
  RESTRICTED_SOFT_TOOL_NAMES,
  RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED,
  RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED_SOURCE,
  RESTRICTED_SOFT_TOOL_NAMES_SOURCE,
} from "./restricted-channel-config";

/**
 * Reverse map: tool runtime string value → the constant identifier name used
 * in executeRestrictedSoftTool's source code for its `if (name === …)` checks.
 *
 * This map must be kept in sync with RESTRICTED_SOFT_TOOL_NAMES_SOURCE.  The
 * "handler branch coverage" test below will fail with a descriptive message if
 * a name is in RESTRICTED_SOFT_TOOL_NAMES but has no entry here — prompting
 * the developer to add the entry alongside their new handler.
 */
const TOOL_VALUE_TO_CONST_NAME = new Map<string, string>([
  [CALCULATE_YARDAGE_TOOL_NAME, "CALCULATE_YARDAGE_TOOL_NAME"],
  [CONSULT_EXPERTS_TOOL_NAME, "CONSULT_EXPERTS_TOOL_NAME"],
  [EBAY_SEARCH_TOOL_NAME, "EBAY_SEARCH_TOOL_NAME"],
  [FETCH_PAGE_TOOL_NAME, "FETCH_PAGE_TOOL_NAME"],
  [FIND_NEARBY_PLACES_TOOL_NAME, "FIND_NEARBY_PLACES_TOOL_NAME"],
  [GENERATE_DOCUMENT_TOOL_NAME, "GENERATE_DOCUMENT_TOOL_NAME"],
  [GET_AIR_QUALITY_TOOL_NAME, "GET_AIR_QUALITY_TOOL_NAME"],
  [GET_EXCHANGE_RATE_TOOL_NAME, "GET_EXCHANGE_RATE_TOOL_NAME"],
  [GET_POLLEN_FORECAST_TOOL_NAME, "GET_POLLEN_FORECAST_TOOL_NAME"],
  [GET_ROUTE_INFO_TOOL_NAME, "GET_ROUTE_INFO_TOOL_NAME"],
  [GET_WEATHER_TOOL_NAME, "GET_WEATHER_TOOL_NAME"],
  [LOOKUP_BARCODE_TOOL_NAME, "LOOKUP_BARCODE_TOOL_NAME"],
  [QUERY_HOUSEHOLD_TOOL_NAME, "QUERY_HOUSEHOLD_TOOL_NAME"],
  [REMEMBER_TOOL_NAME, "REMEMBER_TOOL_NAME"],
  [SEARCH_FLIGHTS_TOOL_NAME, "SEARCH_FLIGHTS_TOOL_NAME"],
  [SEARCH_HALLMARK_TOOL_NAME, "SEARCH_HALLMARK_TOOL_NAME"],
  [SEARCH_HOUSEHOLD_TOOL_NAME, "SEARCH_HOUSEHOLD_TOOL_NAME"],
  [SEARCH_TRIP_DOCUMENTS_TOOL_NAME, "SEARCH_TRIP_DOCUMENTS_TOOL_NAME"],
  [SHOW_DATA_CARD_TOOL_NAME, "SHOW_DATA_CARD_TOOL_NAME"],
  [SHOW_FABRIC_SWATCH_TOOL_NAME, "SHOW_FABRIC_SWATCH_TOOL_NAME"],
  [SHOW_ORNAMENT_ITEM_TOOL_NAME, "SHOW_ORNAMENT_ITEM_TOOL_NAME"],
  [SHOW_POTTERY_ITEM_TOOL_NAME, "SHOW_POTTERY_ITEM_TOOL_NAME"],
  [SHOW_TRIP_CARD_TOOL_NAME, "SHOW_TRIP_CARD_TOOL_NAME"],
  [SUGGEST_CLOTHING_LAYERS_TOOL_NAME, "SUGGEST_CLOTHING_LAYERS_TOOL_NAME"],
  [WEB_SEARCH_TOOL_NAME, "WEB_SEARCH_TOOL_NAME"],
  [LIST_CONTACT_CHANNELS_TOOL_NAME, "LIST_CONTACT_CHANNELS_TOOL_NAME"],
  [LIST_SCHEDULED_CONTACTS_TOOL_NAME, "LIST_SCHEDULED_CONTACTS_TOOL_NAME"],
  [LIST_ELAINE_MEMORIES_TOOL_NAME, "LIST_ELAINE_MEMORIES_TOOL_NAME"],
]);

/**
 * Restricted-channel tool coverage guard.
 *
 * When a new soft tool is added to the planner catalog with non-web channels
 * in its capability policy, it must also be added to RESTRICTED_SOFT_TOOL_NAMES
 * in restricted-channel-config.ts so the model is actually offered that tool
 * on SMS/voice/email/Slack. Without this check, the omission is silent: the
 * model's system prompt still describes the capability, it just never calls
 * the tool, and Elaine returns an apology instead of an answer.
 *
 * This is modelled after capability-policy-coverage.test.ts (which guards the
 * web-chat planner catalog) and fires in CI so the regression is caught before
 * the code ships rather than after a manual email-webhook test.
 */

const RESTRICTED_CHANNELS = new Set(["sms", "voice", "email", "slack"]);

/** All soft tool names (read + utility) in the full planner catalog. */
const softToolNames = new Set(
  [...SOFT_TOOLS, ...SOFT_TOOLS_EXTRA]
    .filter(
      (t): t is Extract<typeof t, { type: "function" }> =>
        t.type === "function",
    )
    .map((t) => t.function.name),
);

/** All action tool names in the full planner catalog. */
const actionToolNames = new Set(
  ACTION_TOOLS.filter(
    (t): t is Extract<typeof t, { type: "function" }> => t.type === "function",
  ).map((t) => t.function.name),
);

describe("Elaine restricted-channel tool coverage", () => {
  it("every soft tool that policy says is available on a restricted channel is in RESTRICTED_SOFT_TOOL_NAMES", () => {
    // Derive from ELAINE_TOOL_POLICIES which soft tools should be in the
    // restricted-channel set. Any soft tool whose policy channels include at
    // least one of sms / voice / email / slack must be offered to the model
    // on those channels — omitting it from RESTRICTED_SOFT_TOOL_NAMES means
    // the tool silently never runs there.
    const shouldBeRestricted = Object.entries(ELAINE_TOOL_POLICIES)
      .filter(
        ([name, policy]) =>
          softToolNames.has(name) &&
          policy.channels.some((ch) => RESTRICTED_CHANNELS.has(ch)),
      )
      .map(([name]) => name)
      .sort();

    const missing = shouldBeRestricted.filter(
      (name) => !RESTRICTED_SOFT_TOOL_NAMES.has(name),
    );

    // Emit a descriptive message so the failure clearly names the fix needed.
    if (missing.length > 0) {
      expect.fail(
        `These soft tools have non-web channels in ELAINE_TOOL_POLICIES but are ` +
          `missing from RESTRICTED_SOFT_TOOL_NAMES in restricted-channel-config.ts ` +
          `(Elaine silently won't call them over SMS/voice/email/Slack):\n  ${missing.join("\n  ")}`,
      );
    }
    expect(missing).toEqual([]);
  });

  it("every name in RESTRICTED_SOFT_TOOL_NAMES exists as a soft tool in the catalog (no stale entries)", () => {
    // Guard against names that were removed from the catalog but left in the
    // restricted set — stale entries mask real missing-tool bugs.
    const stale = [...RESTRICTED_SOFT_TOOL_NAMES].filter(
      (name) => !softToolNames.has(name),
    );

    if (stale.length > 0) {
      expect.fail(
        `These names in RESTRICTED_SOFT_TOOL_NAMES no longer exist as soft tools ` +
          `in the catalog — remove them from restricted-channel-config.ts:\n  ${stale.join("\n  ")}`,
      );
    }
    expect(stale).toEqual([]);
  });

  it("every action tool that policy says is web-only is in RESTRICTED_EXCLUDED_ACTION_TYPES", () => {
    // Action tools available on restricted channels go through
    // AGENTPHONE_ACTION_TOOLS (= ACTION_TOOLS minus RESTRICTED_EXCLUDED_ACTION_TYPES).
    // Any action tool whose policy channels include only "web" should be in
    // RESTRICTED_EXCLUDED_ACTION_TYPES, otherwise it would be incorrectly
    // offered to the model on SMS/voice/Slack/email.
    const webOnlyActions = Object.entries(ELAINE_TOOL_POLICIES)
      .filter(
        ([name, policy]) =>
          actionToolNames.has(name) &&
          policy.channels.length > 0 &&
          policy.channels.every((ch) => ch === "web"),
      )
      .map(([name]) => name)
      .sort();

    const notExcluded = webOnlyActions.filter(
      (name) => !RESTRICTED_EXCLUDED_ACTION_TYPES.has(name),
    );

    if (notExcluded.length > 0) {
      expect.fail(
        `These action tools have channels: ["web"] in ELAINE_TOOL_POLICIES but are NOT in ` +
          `RESTRICTED_EXCLUDED_ACTION_TYPES in restricted-channel-config.ts:\n  ${notExcluded.join("\n  ")}\n` +
          `Add them to RESTRICTED_EXCLUDED_ACTION_TYPES or update their policy channels.`,
      );
    }
    expect(notExcluded).toEqual([]);
  });

  it("every entry in RESTRICTED_EXCLUDED_ACTION_TYPES exists as an action tool in the catalog (no stale entries)", () => {
    const stale = [...RESTRICTED_EXCLUDED_ACTION_TYPES].filter(
      (name) => !actionToolNames.has(name),
    );

    if (stale.length > 0) {
      expect.fail(
        `These names in RESTRICTED_EXCLUDED_ACTION_TYPES no longer exist as action tools ` +
          `in the catalog — remove them from restricted-channel-config.ts:\n  ${stale.join("\n  ")}`,
      );
    }
    expect(stale).toEqual([]);
  });

  it("RESTRICTED_SOFT_TOOL_NAMES_SOURCE has no duplicate entries", () => {
    // The Set constructor silently deduplicates, so we check the source array
    // instead. Listing the same constant twice via different import aliases
    // (or a copy-paste mistake) would be caught here but not by comparing
    // the derived Set to itself.
    const names = RESTRICTED_SOFT_TOOL_NAMES_SOURCE;
    expect(names.length).toBe(new Set(names).size);
  });

  it("RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE has no duplicate entries", () => {
    // Same rationale as above — check the source array, not the derived Set.
    const names = RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE;
    expect(names.length).toBe(new Set(names).size);
  });

  it("RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED_SOURCE has no duplicate entries", () => {
    const names = RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED_SOURCE;
    expect(names.length).toBe(new Set(names).size);
  });

  it("every caller-handled name is also in RESTRICTED_SOFT_TOOL_NAMES (no stale entries)", () => {
    // Ensure RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED_SOURCE doesn't drift out
    // of sync with RESTRICTED_SOFT_TOOL_NAMES_SOURCE — every name must be in
    // both sets or the caller-handled list is stale.
    const stale = [...RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED].filter(
      (name) => !RESTRICTED_SOFT_TOOL_NAMES.has(name),
    );
    if (stale.length > 0) {
      expect.fail(
        `These names are in RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED_SOURCE but ` +
          `not in RESTRICTED_SOFT_TOOL_NAMES — remove them from the caller-handled list ` +
          `in restricted-channel-config.ts:\n  ${stale.join("\n  ")}`,
      );
    }
    expect(stale).toEqual([]);
  });

  it("every caller-handled soft tool has an explicit dispatch branch in executeRestrictedToolCall", () => {
    // Static-analysis check: each name in RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED
    // must have an `else if (name === CONST_NAME)` branch in the
    // executeRestrictedToolCall dispatch — before the fallthrough
    // `RESTRICTED_SOFT_TOOL_NAMES.has(name)` block.  Without this guard, a
    // developer could add a tool to the caller-handled set without ever wiring
    // up the actual runtime dispatch, causing "Unsupported tool." errors on
    // restricted channels.
    //
    // This dispatch used to live inline in runRestrictedElaineTurn; it was
    // extracted into executeRestrictedToolCall so both the OpenRouter loop
    // and the OpenAI Responses API loop (SMS/Slack/email/messenger vs.
    // voice) execute tool calls identically regardless of which model
    // answered.
    const indexPath = fileURLToPath(new URL("./index.ts", import.meta.url));
    const source = readFileSync(indexPath, "utf8");

    // Locate the restricted-turn dispatch region: from the start of
    // executeRestrictedToolCall up to the fallthrough soft-tool block.
    const fnMarker = "\nasync function executeRestrictedToolCall(";
    const fallthroughSentinel =
      "} else if (RESTRICTED_SOFT_TOOL_NAMES.has(name)) {";
    const fnStart = source.indexOf(fnMarker);
    const regionEnd = source.indexOf(
      fallthroughSentinel,
      fnStart > -1 ? fnStart : 0,
    );

    if (fnStart === -1) {
      expect.fail(
        "Could not locate `executeRestrictedToolCall` in index.ts — " +
          "was the function renamed or moved?",
      );
      return;
    }
    if (regionEnd === -1) {
      expect.fail(
        `Could not locate the fallthrough sentinel ` +
          `\`${fallthroughSentinel}\` in index.ts — was it renamed or moved?`,
      );
      return;
    }

    const dispatchRegion = source.slice(
      fnStart,
      regionEnd + fallthroughSentinel.length,
    );

    const missingBranch: string[] = [];
    const missingFromMap: string[] = [];

    for (const toolValue of RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED) {
      const constName = TOOL_VALUE_TO_CONST_NAME.get(toolValue);
      if (!constName) {
        missingFromMap.push(toolValue);
        continue;
      }
      if (!dispatchRegion.includes(constName)) {
        missingBranch.push(`${toolValue} (${constName})`);
      }
    }

    const failures: string[] = [];
    if (missingFromMap.length > 0) {
      failures.push(
        `These caller-handled tool values have no entry in TOOL_VALUE_TO_CONST_NAME ` +
          `at the top of this test file — add them alongside the new constant import:\n` +
          `  ${missingFromMap.join("\n  ")}`,
      );
    }
    if (missingBranch.length > 0) {
      failures.push(
        `These caller-handled tools are in RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED ` +
          `but have no explicit \`else if (name === CONST_NAME)\` branch in the ` +
          `executeRestrictedToolCall dispatch region of index.ts. ` +
          `Add the branch or move the name out of the caller-handled list:\n` +
          `  ${missingBranch.join("\n  ")}`,
      );
    }
    if (failures.length > 0) {
      expect.fail(failures.join("\n\n"));
    }
    expect(missingBranch).toEqual([]);
    expect(missingFromMap).toEqual([]);
  });

  it("every name in RESTRICTED_SOFT_TOOL_NAMES (not caller-handled) has a handler branch in executeRestrictedSoftTool", () => {
    // Read the source of index.ts and verify that executeRestrictedSoftTool
    // contains an `if (name === CONST_NAME)` branch for each tool it is
    // responsible for handling.  Tools in RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED
    // are handled by the caller (runRestrictedElaineTurn) before
    // executeRestrictedSoftTool is ever reached, so they are excluded.
    //
    // This is a static-analysis test: it does not execute the function and
    // requires no mocking of external dependencies.  The trade-off is that
    // TOOL_VALUE_TO_CONST_NAME (declared at the top of this file) must be kept
    // in sync — its entries are imported constants whose string values are the
    // keys, so adding a new constant to the catalog and forgetting this map
    // will produce a clear "update the test's reverse-map" failure message
    // rather than a silent pass.

    const indexPath = fileURLToPath(new URL("./index.ts", import.meta.url));
    const source = readFileSync(indexPath, "utf8");

    // Locate the function.  The sentinel string is the only path that returns
    // "Unsupported tool." and it sits just before the closing brace.
    const fnMarker = "\nasync function executeRestrictedSoftTool(";
    const sentinel = 'return "Unsupported tool.";';
    const fnStart = source.indexOf(fnMarker);
    const fnEnd = source.indexOf(sentinel, fnStart > -1 ? fnStart : 0);

    if (fnStart === -1) {
      expect.fail(
        "Could not locate `executeRestrictedSoftTool` in index.ts — " +
          "was the function renamed or moved?",
      );
      return;
    }
    if (fnEnd === -1) {
      expect.fail(
        'Could not locate the sentinel `return "Unsupported tool.";` inside ' +
          "`executeRestrictedSoftTool` — was it renamed or removed?",
      );
      return;
    }

    // Slice just the function body up to (and including) the sentinel so we
    // don't accidentally match a constant name that appears later in the file.
    const fnBody = source.slice(fnStart, fnEnd + sentinel.length);

    const missingHandler: string[] = [];
    const missingFromMap: string[] = [];

    for (const toolValue of RESTRICTED_SOFT_TOOL_NAMES) {
      if (RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED.has(toolValue)) continue;

      const constName = TOOL_VALUE_TO_CONST_NAME.get(toolValue);
      if (!constName) {
        missingFromMap.push(toolValue);
        continue;
      }

      if (!fnBody.includes(constName)) {
        missingHandler.push(`${toolValue} (${constName})`);
      }
    }

    const failures: string[] = [];

    if (missingFromMap.length > 0) {
      failures.push(
        `These tool string values are in RESTRICTED_SOFT_TOOL_NAMES but have no ` +
          `entry in TOOL_VALUE_TO_CONST_NAME at the top of this test file. ` +
          `Add them alongside the new constant import:\n  ${missingFromMap.join("\n  ")}`,
      );
    }

    if (missingHandler.length > 0) {
      failures.push(
        `These tools are in RESTRICTED_SOFT_TOOL_NAMES but have no ` +
          `\`if (name === CONST_NAME)\` branch inside executeRestrictedSoftTool ` +
          `in index.ts. Add a handler or move the name to ` +
          `RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED_SOURCE if it is handled ` +
          `by runRestrictedElaineTurn before the soft-tool dispatch:\n  ${missingHandler.join("\n  ")}`,
      );
    }

    if (failures.length > 0) {
      expect.fail(failures.join("\n\n"));
    }

    expect(missingHandler).toEqual([]);
    expect(missingFromMap).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Default-channel guard for read tools in research / travels / ornaments.
//
// These three domains are the most likely to grow new read tools via copy-paste
// from an existing policy row. The safe default is ALL_READ_CHANNELS so that
// restricted-channel users (SMS, voice, email, Slack) can also benefit. Any
// intentional narrowing must be recorded in NARROW_READ_CHANNEL_JUSTIFICATIONS
// in capability-registry.ts together with a plain-English reason.
// ---------------------------------------------------------------------------

const DOMAINS_WITH_ALL_READ_DEFAULT = new Set([
  "research",
  "travels",
  "ornaments",
  "pottery",
  "quilting",
  "memory",
]);
const ALL_READ_SET = new Set(["web", "sms", "voice", "email", "slack"]);

describe(
  "Read/utility tool default channel guard " +
    "(research / travels / ornaments / pottery / quilting / memory)",
  () => {
    const readToolsInScope = Object.entries(ELAINE_TOOL_POLICIES).filter(
      ([, policy]) =>
        DOMAINS_WITH_ALL_READ_DEFAULT.has(policy.domain) &&
        (policy.kind === "read" || policy.kind === "utility"),
    );

    it(
      "every read/utility tool in research/travels/ornaments/pottery/quilting/memory uses " +
        "ALL_READ_CHANNELS or has a NARROW_READ_CHANNEL_JUSTIFICATIONS entry",
      () => {
        const missing = readToolsInScope
          .filter(([name, policy]) => {
            const usesAllRead =
              policy.channels.length === ALL_READ_SET.size &&
              policy.channels.every((ch) => ALL_READ_SET.has(ch));
            const hasJustification = name in NARROW_READ_CHANNEL_JUSTIFICATIONS;
            return !usesAllRead && !hasJustification;
          })
          .map(([name]) => name)
          .sort();

        if (missing.length > 0) {
          expect.fail(
            `These read/utility tools in the ` +
              `research/travels/ornaments/pottery/quilting/memory ` +
              `domains use a narrower channel set than ALL_READ_CHANNELS but have ` +
              `no entry in NARROW_READ_CHANNEL_JUSTIFICATIONS in ` +
              `capability-registry.ts (restricted-channel users won't be able to ` +
              `use them):\n  ${missing.join("\n  ")}\n` +
              `Either change channels to ALL_READ_CHANNELS, or add an entry to ` +
              `NARROW_READ_CHANNEL_JUSTIFICATIONS with a plain-English reason.`,
          );
        }
        expect(missing).toEqual([]);
      },
    );

    it(
      "every entry in NARROW_READ_CHANNEL_JUSTIFICATIONS names a real read/utility tool " +
        "in research/travels/ornaments/pottery/quilting/memory (no stale entries)",
      () => {
        const stale = Object.keys(NARROW_READ_CHANNEL_JUSTIFICATIONS)
          .filter((name) => {
            const policy = ELAINE_TOOL_POLICIES[name];
            return (
              !policy ||
              !DOMAINS_WITH_ALL_READ_DEFAULT.has(policy.domain) ||
              (policy.kind !== "read" && policy.kind !== "utility")
            );
          })
          .sort();

        if (stale.length > 0) {
          expect.fail(
            `These entries in NARROW_READ_CHANNEL_JUSTIFICATIONS are stale — they no ` +
              `longer name a read/utility tool in the ` +
              `research/travels/ornaments/pottery/quilting/memory domain.\n` +
              `Remove them from capability-registry.ts:\n  ${stale.join("\n  ")}`,
          );
        }
        expect(stale).toEqual([]);
      },
    );

    it(
      "every entry in NARROW_READ_CHANNEL_JUSTIFICATIONS actually uses a " +
        "narrower channel set than ALL_READ_CHANNELS (no unnecessary justifications)",
      () => {
        const notActuallyNarrow = Object.keys(
          NARROW_READ_CHANNEL_JUSTIFICATIONS,
        )
          .filter((name) => {
            const policy = ELAINE_TOOL_POLICIES[name];
            if (!policy) return false;
            return (
              policy.channels.length === ALL_READ_SET.size &&
              policy.channels.every((ch) => ALL_READ_SET.has(ch))
            );
          })
          .sort();

        if (notActuallyNarrow.length > 0) {
          expect.fail(
            `These entries in NARROW_READ_CHANNEL_JUSTIFICATIONS are unnecessary — ` +
              `the tool already uses ALL_READ_CHANNELS.\n` +
              `Remove them from NARROW_READ_CHANNEL_JUSTIFICATIONS in capability-registry.ts:\n` +
              `  ${notActuallyNarrow.join("\n  ")}`,
          );
        }
        expect(notActuallyNarrow).toEqual([]);
      },
    );
  },
);
