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
  channels: readonly ("web" | "sms" | "voice" | "email" | "slack")[];
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

/**
 * Read tools in the "research", "travels", "ornaments", "pottery", or
 * "quilting" domains that intentionally use a narrower channel set than
 * ALL_READ_CHANNELS.
 *
 * Every entry must carry a plain-English reason so a reviewer can judge
 * whether the restriction still makes sense when the tool is later modified.
 * The CI test in restricted-channel-coverage.test.ts enforces that any read
 * tool in those five domains either uses ALL_READ_CHANNELS or appears here.
 *
 * To add a new narrow-channel read tool in these domains:
 *   1. Add a row to NARROW_READ_CHANNEL_JUSTIFICATIONS with a reason string.
 *   2. Set channels to the appropriate subset in the policy row below.
 * To widen an existing tool back to ALL_READ_CHANNELS:
 *   1. Remove its entry from NARROW_READ_CHANNEL_JUSTIFICATIONS.
 *   2. Update its channels in the policy row.
 */
export const NARROW_READ_CHANNEL_JUSTIFICATIONS: Readonly<
  Record<string, string>
> = {
  // Task management UIs (progress view, cancel button) only exist on the web;
  // a structured task-list or task-detail response cannot be rendered usefully
  // over SMS / voice / email / Slack.
  list_elaine_tasks:
    "Task list UI only exists on the web; the structured list response cannot " +
    "be rendered usefully over SMS/voice/email/Slack.",
  get_elaine_task:
    "Task detail UI only exists on the web; the structured detail response " +
    "cannot be rendered usefully over SMS/voice/email/Slack.",
};

const WEB_AND_TRUSTED_CHANNELS = ["web", "sms", "voice"] as const;
// Slack identity is verified by the Slack API OAuth flow: only a workspace
// member with a real Slack account can send events to the Elaine bot.
const WEB_TRUSTED_AND_SLACK_CHANNELS = [
  "web",
  "sms",
  "voice",
  "slack",
] as const;
const ALL_READ_CHANNELS = ["web", "sms", "voice", "email", "slack"] as const;

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
      "add_diary_entry",
      "delete_diary_entry",
      "edit_diary_entry",
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
  // call_contact / message_contact: available on web, SMS, voice, and Slack.
  // Email is excluded: inbound email From headers are spoofable and do not
  // constitute strong sender authentication. SMS/voice use E.164-verified phone
  // numbers matched against app_users before the turn runs. Slack identity is
  // verified by the Slack API OAuth flow.
  ...policies(["call_contact", "message_contact"], {
    ...ACTION_DEFAULTS,
    domain: "office",
    executorPrefix: "communicationAction",
    channels: WEB_TRUSTED_AND_SLACK_CHANNELS,
  }),
  // cancel_scheduled_contact: same trust-boundary reasoning as above.
  // Executor scopes every query by initiatedByUserId — no IDOR risk.
  ...policies(["cancel_scheduled_contact"], {
    ...ACTION_DEFAULTS,
    domain: "office",
    executorPrefix: "communicationAction",
    channels: WEB_TRUSTED_AND_SLACK_CHANNELS,
  }),
  // list_contact_channels: read-only — returns which channels are reachable for
  // a given household member. Available on web/SMS/voice/Slack so Elaine can
  // ask for clarification before picking a delivery channel.
  // Email excluded (outbound actions it leads to are not available on email).
  ...policies(["list_contact_channels"], {
    domain: "office",
    kind: "read",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "communicationRead",
    audit: "runtime_observation",
    retry: "read_only",
    channels: WEB_TRUSTED_AND_SLACK_CHANNELS,
  }),
  // continue_in_channel: sends a message to THE SAME USER on another channel
  // (self-directed channel-switching). Unlike call_contact/message_contact
  // (which target other household members), this always sends to the requesting
  // user themselves. Email channel inclusion is safe because:
  // 1. The inbound sender is verified against app_users.email before the turn runs.
  // 2. The executor resolves the target from userId (the verified DB record),
  //    never from the inbound From address itself.
  // 3. Worst-case spoofed From: the legitimate account owner receives an
  //    unexpected Slack/SMS from Elaine — not a privilege-escalation risk.
  // 4. email→email is not circular: email users typically switch to SMS/Slack,
  //    and even if they request email, the outbound goes to the verified address.
  ...policies(["continue_in_channel"], {
    ...ACTION_DEFAULTS,
    domain: "office",
    executorPrefix: "communicationAction",
    channels: ALL_READ_CHANNELS,
  }),
  // call_me: initiates an outbound call to THE REQUESTING USER'S OWN verified
  // phone. Always resolves to userId (never a contact name), so it is safe on
  // SMS/voice — the identity is already verified before the turn runs.
  // Excluded from email because outbound calls are disruptive and email is
  // async; users who want a callback should switch to SMS or the web app.
  ...policies(["call_me"], {
    ...ACTION_DEFAULTS,
    domain: "office",
    executorPrefix: "communicationAction",
    channels: ["web", "sms"] as const,
  }),
  // broadcast_message: fans out a message to ALL of the requesting user's own
  // connected channels simultaneously. Web-only to prevent delivery loops
  // (an inbound SMS/Slack/email broadcast would echo back to that same channel)
  // and because the confirmation UI is needed to make the multi-channel blast
  // intentional.
  ...policies(["broadcast_message"], {
    ...ACTION_DEFAULTS,
    domain: "office",
    executorPrefix: "communicationAction",
    channels: ["web"] as const,
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
    channels: ALL_READ_CHANNELS,
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
    channels: ALL_READ_CHANNELS,
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
    channels: ALL_READ_CHANNELS,
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
    channels: ALL_READ_CHANNELS,
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
  ...policies(["generate_document"], {
    domain: "office",
    kind: "utility",
    risk: "low",
    auth: "session",
    confirmation: "never",
    executorPrefix: "documentGeneration",
    audit: "runtime_observation",
    retry: "safe",
    channels: ALL_READ_CHANNELS,
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
