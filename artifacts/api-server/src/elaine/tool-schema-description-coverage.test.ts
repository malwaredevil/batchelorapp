/**
 * Elaine tool schema ↔ description coverage guard.
 *
 * Background
 * ----------
 * A live Sentry incident (2026-08-12) was caused by a mismatch between a
 * field's natural-language description examples and the actual Zod schema
 * enum values:  `RelativeTimeSpecZod` had no minutes/hours granularity yet
 * `scheduleAt`'s JSON-schema description said "in an hour" as an example.
 * The model invented `{"kind":"relative_minutes","minutes":120}`, Zod
 * rejected it at the discriminated-union level with a ZodError, and the
 * user-facing action failed.  See `.agents/memory/relative-time-spec-
 * sibling-description-gap.md` for the full write-up.
 *
 * What this file checks
 * ---------------------
 * 1. `RELATIVE_TIME_SPEC_JSON_SCHEMA.properties.kind.enum` (the array the
 *    model sees as "valid kinds") is the exact same set as the discriminant
 *    literals in `RelativeTimeSpecZod` (the array the server validates
 *    against).  Divergence here is the direct cause of the original bug.
 *
 * 2. `MESSAGE_CONTACT_CHANNEL_ENUM` (the Zod enum source of truth for
 *    `message_contact`'s `channel` field) is reflected verbatim in the JSON
 *    tool-schema enum the model sees.  Because both the Zod schema and the
 *    JSON schema now use the same exported constant, divergence is already
 *    structurally prevented — but the test documents the invariant
 *    explicitly and will catch any future refactor that inlines the array
 *    again.
 *
 * 3. Same check for `CONTINUE_IN_CHANNEL_ENUM` / `continue_in_channel`'s
 *    `targetChannel` field.
 *
 * Manual audit (2026-08-13)
 * -------------------------
 * Every other Elaine action tool file was audited for the same class of bug
 * (description mentions an example phrase or value that isn't representable
 * by the field's Zod schema/enum).  No additional gaps were found:
 *
 *   - reminder-actions.ts: status ["active","done","cancelled","all"] and
 *     when ["upcoming","overdue","all"] in JSON schema match Zod enums ✓
 *   - quilting-actions.ts: status ["want","bought"] and entityType
 *     ["fabric","pattern","quilt"] match Zod enums ✓
 *   - pottery-actions.ts / ornaments-actions.ts: lockable-field examples
 *     are members of the LOCKABLE_FIELDS const ✓
 *   - universal-actions.ts: notification status ["read","unread","dismissed",
 *     "acknowledged"] and scope ["global","module","event_type"] match ✓
 *   - universal-read-tools.ts: severity ["informational","attention",
 *     "important","critical"] matches ✓
 *   - app-operation-tools.ts: access ["read","action"] matches ✓
 *   - planner-tool-catalog.ts: TRIP_STATUS_ENUM is a shared const used in
 *     both the Zod route handler and the JSON tool schema ✓
 *
 * Lower-priority (can't cause Zod rejection, only model confusion):
 *   - Many date fields are described as "YYYY-MM-DD" but have unconstrained
 *     z.string() schemas — these can't cause a discriminator mismatch, so
 *     they are noted but not blocked on.
 *
 * When adding a new Elaine action tool, run through this checklist:
 *   □ Every field description that gives an example value (e.g. "'active' or
 *     'inactive'", "one of: X, Y, Z", "use 'foo' for …") has that value in
 *     the corresponding Zod enum/literal.
 *   □ Every JSON-schema `enum` array is either (a) derived from a shared
 *     exported const array (preferred) or (b) verified equal to the
 *     corresponding Zod enum here in this file.
 *   □ `RELATIVE_TIME_SPEC_JSON_SCHEMA` is used as-is (not copied inline)
 *     for any `scheduleAt`/`when`/`remindAt` field that accepts
 *     RelativeTimeSpec.
 */

import { describe, expect, it } from "vitest";
import {
  RelativeTimeSpecZod,
  RELATIVE_TIME_SPEC_JSON_SCHEMA,
} from "../lib/relative-time-resolver";
import {
  MESSAGE_CONTACT_CHANNEL_ENUM,
  CONTINUE_IN_CHANNEL_ENUM,
  communicationActionTools,
} from "./communication-actions";

// ---------------------------------------------------------------------------
// Helper: extract discriminant literal values from a ZodDiscriminatedUnion.
// We intentionally cast through `any` rather than depending on the exact
// shape of Zod's internal `_def` — all that matters here is that the test
// fails loudly if the options change, which is the invariant we want.
// ---------------------------------------------------------------------------
function extractDiscriminantKinds(
  schema: typeof RelativeTimeSpecZod,
): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: any[] =
    (schema as any).options ?? (schema as any)._def?.options ?? [];
  return options.map((opt: any) => {
    const kindField = opt?.shape?.kind ?? opt?._def?.shape?.()?.kind;
    return kindField?.value ?? kindField?._def?.value;
  });
}

describe("Elaine tool schema ↔ description coverage", () => {
  // -------------------------------------------------------------------------
  // 1. RelativeTimeSpec — the original bug case.
  // -------------------------------------------------------------------------
  describe("RelativeTimeSpec JSON schema ↔ Zod discriminated union", () => {
    it("RELATIVE_TIME_SPEC_JSON_SCHEMA kind enum covers every Zod variant (no missing model-visible kind)", () => {
      const zodKinds = new Set(extractDiscriminantKinds(RelativeTimeSpecZod));
      const jsonKinds = new Set(
        RELATIVE_TIME_SPEC_JSON_SCHEMA.properties.kind.enum,
      );

      // Every Zod variant must be in the JSON schema so the model can produce it.
      for (const k of zodKinds) {
        expect(
          jsonKinds,
          `Zod variant "${k}" is missing from the JSON-schema enum`,
        ).toContain(k);
      }
    });

    it("RELATIVE_TIME_SPEC_JSON_SCHEMA kind enum has no values absent from the Zod schema (no phantom model hints)", () => {
      const zodKinds = new Set(extractDiscriminantKinds(RelativeTimeSpecZod));
      const jsonKinds = new Set(
        RELATIVE_TIME_SPEC_JSON_SCHEMA.properties.kind.enum,
      );

      // Every JSON-schema kind must map to a real Zod variant so the model
      // never invents a value that passes the JSON hint but fails Zod.
      for (const k of jsonKinds) {
        expect(
          zodKinds,
          `JSON-schema kind "${k}" has no matching Zod variant`,
        ).toContain(k);
      }
    });

    it("both sets are identical (combined sanity check)", () => {
      const zodKinds = new Set(extractDiscriminantKinds(RelativeTimeSpecZod));
      const jsonKinds = new Set(
        RELATIVE_TIME_SPEC_JSON_SCHEMA.properties.kind.enum,
      );
      expect(zodKinds).toEqual(jsonKinds);
    });
  });

  // -------------------------------------------------------------------------
  // 2. message_contact channel enum.
  // -------------------------------------------------------------------------
  describe("message_contact channel enum", () => {
    it("JSON tool schema uses MESSAGE_CONTACT_CHANNEL_ENUM verbatim", () => {
      const messageContactTool = communicationActionTools.find(
        (t) => t.type === "function" && t.function.name === "message_contact",
      );
      expect(
        messageContactTool,
        "message_contact tool must exist in communicationActionTools",
      ).toBeDefined();

      const channelProp = (messageContactTool as any)?.function?.parameters
        ?.properties?.channel;
      expect(
        channelProp?.enum,
        "message_contact.channel must have a JSON-schema enum",
      ).toBeDefined();

      expect(new Set(channelProp.enum)).toEqual(
        new Set(MESSAGE_CONTACT_CHANNEL_ENUM),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. continue_in_channel targetChannel enum.
  // -------------------------------------------------------------------------
  describe("continue_in_channel targetChannel enum", () => {
    it("JSON tool schema uses CONTINUE_IN_CHANNEL_ENUM verbatim", () => {
      const continueInChannelTool = communicationActionTools.find(
        (t) =>
          t.type === "function" && t.function.name === "continue_in_channel",
      );
      expect(
        continueInChannelTool,
        "continue_in_channel tool must exist in communicationActionTools",
      ).toBeDefined();

      const targetChannelProp = (continueInChannelTool as any)?.function
        ?.parameters?.properties?.targetChannel;
      expect(
        targetChannelProp?.enum,
        "continue_in_channel.targetChannel must have a JSON-schema enum",
      ).toBeDefined();

      expect(new Set(targetChannelProp.enum)).toEqual(
        new Set(CONTINUE_IN_CHANNEL_ENUM),
      );
    });
  });
});
