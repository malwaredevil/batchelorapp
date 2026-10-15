import type OpenAI from "openai";

export const LIST_ELAINE_SUGGESTIONS_TOOL_NAME = "list_elaine_suggestions";
export const SAVE_ELAINE_SUGGESTION_TOOL_NAME = "save_elaine_suggestion";
export const GET_RECENT_ELAINE_DIAGNOSTICS_TOOL_NAME =
  "get_recent_elaine_diagnostics";

export const OWNER_SUPPORT_TOOL_NAMES = new Set([
  "list_sentry_issues",
  "list_elaine_suggestions",
  "save_elaine_suggestion",
  "get_recent_elaine_diagnostics",
]);

export const ownerSupportTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_elaine_suggestions",
      description:
        "Read Elaine Suggestions from the Owner Panel. Use to review saved recommendations or check for an existing suggestion. Owner-only; role comes from authenticated server context, not screen state.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "accepted", "dismissed"],
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_elaine_suggestion",
      description:
        "Save a recommendation directly to Elaine Suggestions for owner review. Use when the owner asks to save a recommendation, or a genuine app capability/reliability gap is discovered. Saving a pending suggestion needs no extra confirmation and never changes code, settings, or publishes anything. Distinguish observed evidence from an unverified recommendation. Never include credentials, raw logs, private reasoning, or unrelated personal data. Returns the saved suggestion ID; only claim saved after success.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 180 },
          recommendation: { type: "string", maxLength: 4000 },
        },
        required: ["title", "recommendation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_elaine_diagnostics",
      description:
        "Read this authenticated owner's recent Elaine execution results. Use when asked what failed, why a step was not completed, or whether a check really ran. Returns safe step labels, attempted/succeeded/failed/not-attempted states and recorded error categories, not raw logs or private reasoning. Never blame a service when its tool succeeded or was never attempted.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 5 } },
        required: [],
      },
    },
  },
];
