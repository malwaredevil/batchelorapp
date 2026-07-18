import { z } from "zod/v4";
import type OpenAI from "openai";
import {
  getMessage,
  getMessageSummary,
  parseGmailMessage,
  searchMessages,
} from "../lib/gmail-api";
import { getValidAppGmailAccessToken } from "../lib/app-gmail-tokens";

export const SUMMARIZE_INBOX_TOOL_NAME = "summarize_inbox";
export const FIND_EMAILS_ABOUT_TOPIC_TOOL_NAME = "find_emails_about_topic";
export const GET_EMAIL_DETAIL_TOOL_NAME = "get_email_detail";

export const SummarizeInboxPayload = z.object({
  maxMessages: z.number().int().min(1).max(20).default(10),
});

export const FindEmailsAboutTopicPayload = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(10).default(5),
});

export const GetEmailDetailPayload = z.object({
  messageId: z.string().min(1).max(200),
});

export const officeActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: SUMMARIZE_INBOX_TOOL_NAME,
      description:
        'Read-only Office/Gmail tool. Count unread messages in the current user\'s own connected Gmail inbox and return recent unread subjects/snippets for you to summarize. Use this for questions like "do I have unread email?" or "summarize my inbox". Gmail access is always scoped to the requesting user.',
      parameters: {
        type: "object",
        properties: {
          maxMessages: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description:
              "How many recent unread messages to include. Default 10.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: FIND_EMAILS_ABOUT_TOPIC_TOOL_NAME,
      description:
        "Read-only Office/Gmail tool. Search the current user's own connected Gmail inbox for a topic, sender, or simple Gmail query. Use this before get_email_detail when the user asks what a specific email says. Do not include raw access_token or refresh_token strings in the query.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Gmail search query, e.g. from:doctor@clinic.com, subject:insurance, is:unread after:2026/01/01. Keep it simple.",
          },
          maxResults: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Maximum messages to return. Default 5.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: GET_EMAIL_DETAIL_TOOL_NAME,
      description:
        "Read-only Office/Gmail tool. Fetch the full plain-text body for one Gmail message ID. NEVER guess the messageId; it must come from a summarize_inbox or find_emails_about_topic tool result already present in this conversation.",
      parameters: {
        type: "object",
        properties: {
          messageId: {
            type: "string",
            description:
              "Gmail message ID returned by a prior Office/Gmail tool result in this conversation.",
          },
        },
        required: ["messageId"],
      },
    },
  },
];

function formatDate(value: Date | null): string {
  return value ? value.toISOString() : "unknown date";
}

function containsTokenLikeSecret(value: string): boolean {
  return /(?:access_token|refresh_token|ya29\.|1\/\/)/i.test(value);
}

async function requireGmailToken(userId: number): Promise<string | null> {
  return getValidAppGmailAccessToken(userId);
}

async function summarizeMessages(
  accessToken: string,
  messageIds: string[],
): Promise<string[]> {
  const summaries = await Promise.allSettled(
    messageIds.map((id) => getMessageSummary(accessToken, id)),
  );
  return summaries
    .map((result, index) => {
      if (result.status !== "fulfilled") return null;
      const summary = result.value;
      return [
        `${index + 1}. messageId: ${summary.id}`,
        `Subject: ${summary.subject ?? "(no subject)"}`,
        `From: ${summary.from ?? "unknown sender"}`,
        `Date: ${formatDate(summary.date)}`,
        `Snippet: ${summary.snippet}`,
      ].join("\n");
    })
    .filter((line): line is string => line !== null);
}

export async function executeSummarizeInbox(
  input: z.infer<typeof SummarizeInboxPayload>,
  userId: number,
): Promise<string> {
  const accessToken = await requireGmailToken(userId);
  if (!accessToken) {
    return "You don't have a Gmail account connected to this app. Visit the Office page to connect your Gmail.";
  }

  const messages = await searchMessages(
    accessToken,
    "is:unread",
    input.maxMessages,
  );
  if (messages.length === 0) return "You have 0 unread messages.";

  const lines = await summarizeMessages(
    accessToken,
    messages.map((message) => message.id),
  );
  return `You have ${messages.length} unread messages. Here are the most recent ${lines.length}:\n\n${lines.join("\n\n")}`;
}

export async function executeFindEmailsAboutTopic(
  input: z.infer<typeof FindEmailsAboutTopicPayload>,
  userId: number,
): Promise<string> {
  if (containsTokenLikeSecret(input.query)) {
    return "I can't search Gmail with a query that appears to contain a token or credential.";
  }

  const accessToken = await requireGmailToken(userId);
  if (!accessToken) {
    return "You don't have a Gmail account connected to this app. Visit the Office page to connect your Gmail.";
  }

  const messages = await searchMessages(
    accessToken,
    input.query,
    input.maxResults,
  );
  if (messages.length === 0) {
    return `No emails matched "${input.query}".`;
  }

  const lines = await summarizeMessages(
    accessToken,
    messages.map((message) => message.id),
  );
  return `Emails matching "${input.query}":\n\n${lines.join("\n\n")}`;
}

export function extractOfficeMessageIds(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    const content =
      typeof message.content === "string" ? message.content : undefined;
    if (!content) continue;
    for (const match of content.matchAll(/\bmessageId:\s*([A-Za-z0-9_-]+)/g)) {
      if (match[1]) ids.add(match[1]);
    }
  }
  return ids;
}

export async function executeGetEmailDetail(
  input: z.infer<typeof GetEmailDetailPayload>,
  userId: number,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<string> {
  const priorMessageIds = extractOfficeMessageIds(messages);
  if (!priorMessageIds.has(input.messageId)) {
    return "I can only retrieve details for emails that appeared in this conversation. Please search for emails first.";
  }

  const accessToken = await requireGmailToken(userId);
  if (!accessToken) {
    return "You don't have a Gmail account connected to this app. Visit the Office page to connect your Gmail.";
  }

  const message = await getMessage(accessToken, input.messageId);
  const parsed = parseGmailMessage(message);
  const body = parsed.textBody.replace(/\s+/g, " ").trim().slice(0, 3000);

  return [
    `messageId: ${input.messageId}`,
    `Subject: ${parsed.subject ?? "(no subject)"}`,
    `From: ${parsed.from ?? "unknown sender"}`,
    `Date: ${formatDate(parsed.date)}`,
    "",
    body || message.snippet || "(No plain-text body found.)",
  ].join("\n");
}

export async function executeOfficeTool(
  name: string,
  args: string,
  userId: number,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<string | null> {
  if (name === SUMMARIZE_INBOX_TOOL_NAME) {
    const parsed = SummarizeInboxPayload.safeParse(JSON.parse(args || "{}"));
    return parsed.success
      ? executeSummarizeInbox(parsed.data, userId)
      : "Invalid inbox summary request.";
  }

  if (name === FIND_EMAILS_ABOUT_TOPIC_TOOL_NAME) {
    const parsed = FindEmailsAboutTopicPayload.safeParse(
      JSON.parse(args || "{}"),
    );
    return parsed.success
      ? executeFindEmailsAboutTopic(parsed.data, userId)
      : "Invalid email search request.";
  }

  if (name === GET_EMAIL_DETAIL_TOOL_NAME) {
    const parsed = GetEmailDetailPayload.safeParse(JSON.parse(args || "{}"));
    return parsed.success
      ? executeGetEmailDetail(parsed.data, userId, messages)
      : "Invalid email detail request.";
  }

  return null;
}
