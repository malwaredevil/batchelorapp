import type OpenAI from "openai";
import type { ElainePlannerTool } from "./runtime";

export type ElaineCapabilityDomain =
  | "travels"
  | "pottery"
  | "quilting"
  | "ornaments"
  | "office"
  | "notifications"
  | "hub"
  | "memory"
  | "research"
  | "widgets"
  | "navigation"
  | "admin";

export type ElaineCapabilityPolicy = {
  toolName: string;
  domain: ElaineCapabilityDomain;
  kind: "read" | "action" | "utility";
  risk: "none" | "low" | "medium" | "high";
  auth: "session" | "session_and_owner" | "session_and_user_oauth";
  confirmation: "never" | "action_mode";
  executor: string;
  audit: "runtime_observation" | "runtime_action_result";
  retry: "safe" | "read_only" | "never_automatic";
  channels: readonly ("web" | "sms" | "voice" | "email")[];
};

export type ElaineCapability = ElaineCapabilityPolicy & {
  capabilityId: `elaine.tool.${string}`;
  description: string;
  parameters: unknown;
};

type PolicyDefaults = Omit<ElaineCapabilityPolicy, "toolName" | "executor"> & {
  executorPrefix: string;
};

function policies(
  names: readonly string[],
  defaults: PolicyDefaults,
): ElaineCapabilityPolicy[] {
  return names.map((toolName) => ({
    toolName,
    domain: defaults.domain,
    kind: defaults.kind,
    risk:
      defaults.kind === "action" &&
      /^(?:cancel_|delete_|disconnect_|forget_|remove_|revoke_)/.test(toolName)
        ? "high"
        : defaults.risk,
    auth: defaults.auth,
    confirmation: defaults.confirmation,
    executor: `${defaults.executorPrefix}.${toolName}`,
    audit: defaults.audit,
    retry: defaults.retry,
    channels: defaults.channels,
  }));
}

const WEB_AND_TRUSTED_CHANNELS = ["web", "sms", "voice"] as const;
const ALL_READ_CHANNELS = ["web", "sms", "voice", "email"] as const;

const ACTION_DEFAULTS = {
  kind: "action",
  risk: "medium",
  auth: "session",
  confirmation: "action_mode",
  audit: "runtime_action_result",
  retry: "never_automatic",
  channels: WEB_AND_TRUSTED_CHANNELS,
} as const;

const POLICY_ROWS: ElaineCapabilityPolicy[] = [
  ...policies(
    [
      "create_trip",
      "add_wishlist",
      "add_packing_item",
      "update_trip_status",
      "update_trip_details",
      "cancel_trip",
      "mark_wishlist_done",
      "remove_wishlist_item",
      "update_wishlist_item",
      "remove_packing_item",
      "add_reminder",
      "sync_reminder_to_calendar",
      "edit_reminder",
      "delete_reminder",
      "add_itinerary_day",
      "regenerate_itinerary_day",
      "add_connected_calendar",
      "disconnect_calendar",
      "rescan_document",
      "generate_itinerary",
      "confirm_itinerary_activity",
      "remove_itinerary_activity",
      "generate_trip_share_link",
      "revoke_trip_share_link",
      "delete_trip_photo",
      "update_card_layout",
      "update_trip_card_collapse",
    ],
    { ...ACTION_DEFAULTS, domain: "travels", executorPrefix: "travelAction" },
  ),
  ...policies(
    [
      "update_pottery_item",
      "delete_pottery_item",
      "create_pottery_category",
      "delete_pottery_category",
      "lock_pottery_field",
      "update_pottery_item_categories",
      "delete_pottery_photo",
      "promote_pottery_photo",
      "merge_pottery_categories",
      "bulk_reanalyze_pottery",
    ],
    { ...ACTION_DEFAULTS, domain: "pottery", executorPrefix: "potteryAction" },
  ),
  ...policies(
    [
      "update_fabric",
      "delete_fabric",
      "update_pattern",
      "delete_pattern",
      "create_shopping_item",
      "update_shopping_item",
      "delete_shopping_item",
      "create_quilting_category",
      "delete_quilting_category",
      "create_pattern",
      "delete_quilt",
      "rename_quilting_category",
      "merge_quilting_categories",
      "create_block",
      "delete_block",
      "create_layout",
      "delete_layout",
      "bulk_reanalyze_quilting",
      "remove_fabric_creases",
    ],
    {
      ...ACTION_DEFAULTS,
      domain: "quilting",
      executorPrefix: "quiltingAction",
    },
  ),
  ...policies(
    [
      "update_ornament_item",
      "delete_ornament_item",
      "create_ornament_category",
      "delete_ornament_category",
      "lock_ornament_field",
      "update_ornament_item_categories",
      "delete_ornament_photo",
      "promote_ornament_photo",
      "merge_ornament_categories",
      "bulk_reanalyze_ornaments",
    ],
    {
      ...ACTION_DEFAULTS,
      domain: "ornaments",
      executorPrefix: "ornamentAction",
    },
  ),
  ...policies(["create_note", "update_note", "delete_note", "send_email"], {
    ...ACTION_DEFAULTS,
    domain: "office",
    executorPrefix: "officeAction",
  }),
  // call_contact / message_contact are web-only: they send real outbound calls
  // and SMS to other household members, so they must not be auto-triggered by
  // an inbound SMS/voice identity (broken-access-control risk).
  ...policies(["call_contact", "message_contact"], {
    ...ACTION_DEFAULTS,
    domain: "office",
    executorPrefix: "communicationAction",
    channels: ["web"] as const,
  }),
  // cancel_scheduled_contact: safe cancel action; web-only to stay consistent
  // with the schedule tools it pairs with.
  ...policies(["cancel_scheduled_contact"], {
    ...ACTION_DEFAULTS,
    domain: "office",
    executorPrefix: "communicationAction",
    channels: ["web"] as const,
  }),
  // continue_in_channel: sends a message to THE SAME USER on another channel
  // (self-directed channel-switching). Unlike call_contact/message_contact
  // (which target other household members), this always sends to the requesting
  // user themselves, so it is safe on all trusted channels (web, SMS, voice).
  // Email is excluded because email action tools are intentionally disabled
  // (weaker identity) and sending email-to-email would be circular.
  ...policies(["continue_in_channel"], {
    ...ACTION_DEFAULTS,
    domain: "office",
    executorPrefix: "communicationAction",
    channels: WEB_AND_TRUSTED_CHANNELS,
  }),
  // list_scheduled_contacts: read-only soft tool; web-only (same scope as schedule/cancel).
  ...policies(["list_scheduled_contacts"], {
    domain: "office",
    kind: "read",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "communicationRead",
    audit: "runtime_observation",
    retry: "read_only",
    channels: ["web"] as const,
  }),
  ...policies(
    [
      "update_notification_state",
      "bulk_update_notifications",
      "update_notification_preferences",
    ],
    {
      ...ACTION_DEFAULTS,
      domain: "notifications",
      executorPrefix: "notificationAction",
      channels: ["web"],
    },
  ),
  ...policies(
    [
      "send_test_email",
      "send_test_sms",
      "send_phone_verification_code",
      "verify_phone_code",
      "update_elaine_settings",
    ],
    {
      ...ACTION_DEFAULTS,
      domain: "hub",
      executorPrefix: "accountAction",
      channels: ["web"],
    },
  ),
  {
    ...policies(["update_app_config"], {
      ...ACTION_DEFAULTS,
      domain: "hub",
      executorPrefix: "ownerAction",
      auth: "session_and_owner",
      channels: ["web"],
    })[0]!,
    risk: "high",
  },
  {
    ...policies(["execute_app_operation"], {
      ...ACTION_DEFAULTS,
      domain: "hub",
      executorPrefix: "appOperation",
      channels: ["web"],
    })[0]!,
    risk: "high",
  },
  ...policies(
    [
      "search_trip_documents",
      "search_flights",
      "get_weather_forecast",
      "find_nearby_places",
      "get_route_info",
      "get_air_quality",
      "get_pollen_forecast",
      "get_exchange_rate",
      "search_household_data",
      "query_household_data",
      "suggest_clothing_layers",
    ],
    {
      domain: "travels",
      kind: "read",
      risk: "none",
      auth: "session",
      confirmation: "never",
      executorPrefix: "travelRead",
      audit: "runtime_observation",
      retry: "read_only",
      channels: ALL_READ_CHANNELS,
    },
  ),
  ...policies(["show_trip_card", "show_destination_card"], {
    domain: "widgets",
    kind: "utility",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "widget",
    audit: "runtime_observation",
    retry: "safe",
    channels: ["web"],
  }),
  ...policies(["show_pottery_item"], {
    domain: "pottery",
    kind: "read",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "collectionRead",
    audit: "runtime_observation",
    retry: "read_only",
    channels: ["web", "sms", "voice"],
  }),
  ...policies(["show_fabric_swatch", "calculate_yardage"], {
    domain: "quilting",
    kind: "read",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "quiltingRead",
    audit: "runtime_observation",
    retry: "read_only",
    channels: ["web", "sms", "voice", "email"],
  }),
  ...policies(
    ["show_ornament_item", "search_hallmark", "lookup_product_barcode"],
    {
      domain: "ornaments",
      kind: "read",
      risk: "none",
      auth: "session",
      confirmation: "never",
      executorPrefix: "ornamentRead",
      audit: "runtime_observation",
      retry: "read_only",
      channels: ALL_READ_CHANNELS,
    },
  ),
  ...policies(["list_notes", "get_note"], {
    domain: "office",
    kind: "read",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "officeRead",
    audit: "runtime_observation",
    retry: "read_only",
    channels: ["web"],
  }),
  ...policies(
    ["summarize_inbox", "find_emails_about_topic", "get_email_detail"],
    {
      domain: "office",
      kind: "read",
      risk: "low",
      auth: "session_and_user_oauth",
      confirmation: "never",
      executorPrefix: "gmailRead",
      audit: "runtime_observation",
      retry: "read_only",
      channels: ["web"],
    },
  ),
  ...policies(
    [
      "list_notifications",
      "get_notification_counts",
      "get_notification_preferences",
    ],
    {
      domain: "notifications",
      kind: "read",
      risk: "none",
      auth: "session",
      confirmation: "never",
      executorPrefix: "notificationRead",
      audit: "runtime_observation",
      retry: "read_only",
      channels: ["web"],
    },
  ),
  ...policies(["remember_household_fact"], {
    domain: "memory",
    kind: "utility",
    risk: "low",
    auth: "session",
    confirmation: "never",
    executorPrefix: "memory",
    audit: "runtime_observation",
    retry: "safe",
    channels: ["web", "sms", "voice"],
  }),
  ...policies(["correct_memory", "forget_memory"], {
    ...ACTION_DEFAULTS,
    domain: "memory",
    executorPrefix: "memoryAction",
    channels: ["web"],
  }),
  ...policies(["queue_research_task", "cancel_elaine_task"], {
    ...ACTION_DEFAULTS,
    domain: "research",
    executorPrefix: "researchTaskAction",
    channels: ["web"],
  }),
  ...policies(["list_memories"], {
    domain: "memory",
    kind: "read",
    risk: "low",
    auth: "session",
    confirmation: "never",
    executorPrefix: "memoryRead",
    audit: "runtime_observation",
    retry: "read_only",
    channels: ["web"],
  }),
  ...policies(["list_elaine_tasks", "get_elaine_task"], {
    domain: "research",
    kind: "read",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "researchTaskRead",
    audit: "runtime_observation",
    retry: "read_only",
    channels: ["web"],
  }),
  ...policies(["web_search", "fetch_page", "consult_experts", "ebay_search"], {
    domain: "research",
    kind: "read",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "research",
    audit: "runtime_observation",
    retry: "read_only",
    channels: ALL_READ_CHANNELS,
  }),
  ...policies(["discover_app_operations"], {
    domain: "hub",
    kind: "utility",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "appOperation",
    audit: "runtime_observation",
    retry: "safe",
    channels: ["web"],
  }),
  ...policies(["read_app_operation"], {
    domain: "hub",
    kind: "read",
    risk: "low",
    auth: "session",
    confirmation: "never",
    executorPrefix: "appOperation",
    audit: "runtime_observation",
    retry: "read_only",
    channels: ["web"],
  }),
  ...policies(["show_data_card"], {
    domain: "widgets",
    kind: "utility",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "widget",
    audit: "runtime_observation",
    retry: "safe",
    channels: ["web"],
  }),
  ...policies(["suggest_navigation"], {
    domain: "navigation",
    kind: "utility",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "navigation",
    audit: "runtime_observation",
    retry: "safe",
    channels: ["web"],
  }),
  ...policies(["set_action_confirmation_mode"], {
    domain: "hub",
    kind: "utility",
    risk: "low",
    auth: "session",
    confirmation: "never",
    executorPrefix: "settings",
    audit: "runtime_observation",
    retry: "safe",
    channels: ["web"],
  }),
  ...policies(["check_integrations_health"], {
    domain: "admin",
    kind: "read",
    risk: "none",
    auth: "session_and_owner",
    confirmation: "never",
    executorPrefix: "adminRead",
    audit: "runtime_observation",
    retry: "read_only",
    channels: ["web"],
  }),
];

const policyPairs = POLICY_ROWS.map(
  (policy) => [policy.toolName, policy] as const,
);
const policyNames = new Set(policyPairs.map(([name]) => name));
if (policyNames.size !== policyPairs.length) {
  throw new Error("Elaine capability policy contains duplicate tool names");
}

export const ELAINE_TOOL_POLICIES: Readonly<
  Record<string, ElaineCapabilityPolicy>
> = Object.freeze(Object.fromEntries(policyPairs));

function functionTools(
  tools: readonly OpenAI.Chat.Completions.ChatCompletionTool[],
) {
  return tools.filter(
    (tool): tool is OpenAI.Chat.Completions.ChatCompletionFunctionTool =>
      tool.type === "function",
  );
}

export function buildElaineCapabilityRegistry(
  tools: readonly OpenAI.Chat.Completions.ChatCompletionTool[],
): ElaineCapability[] {
  const seen = new Set<string>();
  return functionTools(tools).map((tool) => {
    const { name, description, parameters } = tool.function;
    if (seen.has(name)) {
      throw new Error(`Elaine tool registry contains duplicate tool "${name}"`);
    }
    seen.add(name);
    const policy = ELAINE_TOOL_POLICIES[name];
    if (!policy) {
      throw new Error(
        `Elaine tool "${name}" has no explicit capability policy. Add it to capability-registry.ts before exposing it.`,
      );
    }
    return {
      ...policy,
      capabilityId: `elaine.tool.${name}`,
      description: description ?? "Elaine capability",
      parameters,
    };
  });
}

export function buildPlannerCatalogFromCapabilities(
  registry: readonly ElaineCapability[],
): ElainePlannerTool[] {
  return registry.map((capability) => ({
    name: capability.toolName,
    description: capability.description,
    consequential: capability.kind === "action",
  }));
}
