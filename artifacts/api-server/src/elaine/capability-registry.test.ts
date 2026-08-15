import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import { RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE } from "./restricted-channel-config";
import {
  buildElaineCapabilityRegistry,
  buildPlannerCatalogFromCapabilities,
  ELAINE_TOOL_POLICIES,
} from "./capability-registry";

function tool(
  name: string,
): OpenAI.Chat.Completions.ChatCompletionFunctionTool {
  return {
    type: "function",
    function: {
      name,
      description: `Description for ${name}`,
      parameters: { type: "object", properties: {} },
    },
  };
}

describe("Elaine capability registry", () => {
  it("builds typed, stable metadata for every explicitly approved tool", () => {
    const names = Object.keys(ELAINE_TOOL_POLICIES);
    const registry = buildElaineCapabilityRegistry(names.map(tool));
    expect(registry).toHaveLength(names.length);
    expect(new Set(registry.map((entry) => entry.capabilityId)).size).toBe(
      names.length,
    );
    expect(registry.every((entry) => entry.executor.length > 0)).toBe(true);
    expect(registry.every((entry) => entry.channels.length > 0)).toBe(true);
  });

  it("fails closed when a new model tool lacks reviewed policy metadata", () => {
    expect(() =>
      buildElaineCapabilityRegistry([tool("unreviewed_write_everything")]),
    ).toThrow("has no explicit capability policy");
  });

  it("rejects duplicate tool names before they reach the model", () => {
    expect(() =>
      buildElaineCapabilityRegistry([tool("create_trip"), tool("create_trip")]),
    ).toThrow('duplicate tool "create_trip"');
  });

  it("derives planner consequence flags from the registry kind", () => {
    const registry = buildElaineCapabilityRegistry([
      tool("create_note"),
      tool("list_notes"),
    ]);
    expect(buildPlannerCatalogFromCapabilities(registry)).toEqual([
      expect.objectContaining({ name: "create_note", consequential: true }),
      expect.objectContaining({ name: "list_notes", consequential: false }),
    ]);
  });

  it("marks destructive operations high-risk and Gmail reads user-OAuth scoped", () => {
    expect(ELAINE_TOOL_POLICIES["delete_note"]?.risk).toBe("high");
    expect(ELAINE_TOOL_POLICIES["cancel_trip"]?.risk).toBe("high");
    expect(ELAINE_TOOL_POLICIES["summarize_inbox"]?.auth).toBe(
      "session_and_user_oauth",
    );
    expect(ELAINE_TOOL_POLICIES["forget_memory"]).toMatchObject({
      kind: "action",
      risk: "high",
      confirmation: "action_mode",
      channels: ["web"],
    });
    expect(ELAINE_TOOL_POLICIES["queue_research_task"]).toMatchObject({
      kind: "action",
      confirmation: "action_mode",
      channels: ["web"],
    });
    expect(ELAINE_TOOL_POLICIES["discover_app_operations"]).toMatchObject({
      kind: "utility",
      channels: ["web"],
    });
    expect(ELAINE_TOOL_POLICIES["read_app_operation"]).toMatchObject({
      kind: "read",
      channels: ["web"],
    });
    expect(ELAINE_TOOL_POLICIES["execute_app_operation"]).toMatchObject({
      kind: "action",
      risk: "high",
      confirmation: "action_mode",
      channels: ["web"],
    });
  });

  it("registers estimate_pottery_market_value as web-only action", () => {
    expect(ELAINE_TOOL_POLICIES["estimate_pottery_market_value"]).toMatchObject(
      {
        kind: "action",
        channels: ["web"],
      },
    );
  });

  it("registers ornament_ebay_price_lookup as web-only action", () => {
    expect(ELAINE_TOOL_POLICIES["ornament_ebay_price_lookup"]).toMatchObject({
      kind: "action",
      channels: ["web"],
    });
  });

  it("excludes eBay lookup tools from restricted channels (SMS/voice/email/Slack)", () => {
    expect(RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE).toContain(
      "estimate_pottery_market_value",
    );
    expect(RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE).toContain(
      "ornament_ebay_price_lookup",
    );
  });
});
