import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentType } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ElainePageContextProvider,
  ElaineWidget,
  ElaineChatPanel,
  useElaineChat,
} from "@workspace/elaine-ui";
import { getElaineDailyBriefQueryKey } from "@workspace/api-client-react";

// Opening a chat normally captures background page context. Never capture or
// upload anything in this regression suite.
vi.mock("html2canvas", () => ({
  default: vi.fn(async () => ({
    toBlob: (callback: BlobCallback) => callback(null),
  })),
}));

// importActual lets this suite load the other app's real page without making
// Modules' TypeScript project typecheck Elaine with Modules' @ path mapping.
const { default: Chat } = await vi.importActual<{ default: ComponentType }>(
  "../../elaine/src/pages/Chat",
);

describe("Elaine morning brief removal", () => {
  it.each([
    "../../lib/elaine-ui/src/ElaineChatPanel.tsx",
    "../elaine/src/pages/Chat.tsx",
  ])("does not render or automatically request a brief in %s", (path) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    expect(source).not.toMatch(/use(?:Get|Dismiss|Regenerate)ElaineDailyBrief/);
    expect(source).not.toMatch(/brief\.content|Preparing your morning brief/);
    expect(source).not.toContain("showBrief");
  });

  it("preserves the separate cross-channel summary and its full-page suppression", () => {
    const panel = readFileSync(
      resolve(process.cwd(), "../../lib/elaine-ui/src/ElaineChatPanel.tsx"),
      "utf8",
    );
    const full = readFileSync(
      resolve(process.cwd(), "../elaine/src/components/FullChatPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("!hideCrossChannel && recentEntries.length > 0");
    expect(panel).toContain("Recent on other channels");
    expect(full).toContain("hideCrossChannel={true}");
  });
});

describe("mounted signed-in Elaine chats", () => {
  const oldBrief = {
    id: 17,
    content: "LEGACY DAILY BRIEF: review today's appointments",
    generatedAt: "2025-01-01T08:00:00.000Z",
    dismissed: false,
  };
  const requests: { path: string; method: string }[] = [];
  const clients: QueryClient[] = [];
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView",
  );

  beforeEach(() => {
    requests.length = 0;
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          "http://localhost",
        );
        const method = init?.method ?? "GET";
        requests.push({ path: url.pathname, method });
        if (method !== "GET")
          throw new Error(`Unexpected mutation: ${method} ${url.pathname}`);
        let body: unknown;
        switch (url.pathname) {
          case "/api/elaine/settings":
            body = {
              enabled: true,
              widgetHidden: false,
              chatWindowSize: "compact",
            };
            break;
          case "/api/elaine/conversation":
            body = {
              conversationId: 42,
              hasMore: false,
              messages: [
                { id: 1, role: "user", content: "Keep my existing question." },
                {
                  id: 2,
                  role: "assistant",
                  content: "Keep Elaine's existing answer.",
                },
              ],
            };
            break;
          case "/api/elaine/conversations":
            body = { conversations: [], nextCursor: null };
            break;
          case "/api/elaine/communication-receipts":
            body = { receipts: [] };
            break;
          case "/api/elaine/nudges/unseen-count":
            body = { count: 0 };
            break;
          case "/api/elaine/cross-channel-context":
            body = {
              entries: [
                {
                  channel: "sms",
                  gist: "We discussed a fabric purchase by SMS.",
                  ts: "Today",
                  iso: new Date().toISOString(),
                },
              ],
              updatedAt: new Date().toISOString(),
            };
            break;
          case "/api/elaine/daily-brief":
            // If a future mount restores the query, return visible content so
            // both the request and banner assertions catch the regression.
            body = oldBrief;
            break;
          default:
            throw new Error(`Unexpected request: ${url.pathname}`);
        }
        return new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalScrollIntoView) {
      Object.defineProperty(
        Element.prototype,
        "scrollIntoView",
        originalScrollIntoView,
      );
    } else {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("renders a saved scheduled text without a false Failed result", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    clients.push(client);
    function ScheduledTextFixture() {
      const chat = useElaineChat({ appId: "travels", active: true });
      return (
        <ElaineChatPanel
          chat={{
            ...chat,
            actionDone: true,
            executedActions: [
              {
                type: "message_contact",
                label: "Schedule a test text",
                payload: {},
                status: 200,
                result: {
                  type: "message_contact",
                  result: {
                    scheduled: true,
                    recipients: ["Test recipient"],
                    receipts: [
                      {
                        id: "test-receipt",
                        channel: "sms",
                        status: "scheduled",
                      },
                    ],
                  },
                },
              },
            ],
          }}
        />
      );
    }
    render(
      <QueryClientProvider client={client}>
        <ElainePageContextProvider>
          <ScheduledTextFixture />
        </ElainePageContextProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Test recipient.*scheduled/i)).toBeVisible();
    expect(screen.queryByText(/Failed/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Provider accepted.*delivery pending/),
    ).not.toBeInTheDocument();
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  });

  it.each([
    { surface: "shared widget", legacyBrief: false },
    { surface: "shared widget", legacyBrief: true },
    { surface: "full Elaine page", legacyBrief: false },
    { surface: "full Elaine page", legacyBrief: true },
  ])(
    "$surface keeps briefs absent (legacy cache: $legacyBrief)",
    async ({ surface, legacyBrief }) => {
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      clients.push(client);
      if (legacyBrief)
        client.setQueryData(getElaineDailyBriefQueryKey(), oldBrief);

      render(
        <QueryClientProvider client={client}>
          <ElainePageContextProvider>
            {surface === "shared widget" ? (
              <ElaineWidget appId="travels" />
            ) : (
              <Chat />
            )}
          </ElainePageContextProvider>
        </QueryClientProvider>,
      );
      if (surface === "shared widget") {
        fireEvent.click(
          await screen.findByRole("button", { name: /open.*elaine/i }),
        );
      }

      expect(
        await screen.findByText("Keep Elaine's existing answer."),
      ).toBeVisible();
      expect(screen.getByText("Keep my existing question.")).toBeVisible();
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(requests).toContainEqual({
        path: "/api/elaine/cross-channel-context",
        method: "GET",
      });

      if (surface === "shared widget") {
        expect(screen.getByText("Recent on other channels")).toBeVisible();
        expect(
          screen.getByText("We discussed a fabric purchase by SMS."),
        ).toBeVisible();
      } else {
        // Chat mounts the real FullChatPanel, including its hideCrossChannel prop.
        expect(
          screen.queryByText("Recent on other channels"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText("We discussed a fabric purchase by SMS."),
        ).not.toBeInTheDocument();
        expect(
          screen.getByTitle("Check if you already have this magnet"),
        ).toBeEnabled();
      }

      expect(screen.queryByText(/morning brief/i)).not.toBeInTheDocument();
      expect(screen.queryByText(oldBrief.content)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/preparing your morning brief/i),
      ).not.toBeInTheDocument();
      const composer = screen.getByPlaceholderText("Message Elaine…");
      expect(composer).toBeEnabled();
      // The send icon has no accessible name yet; scope to the composer's row.
      const send = within(composer.parentElement!).getByRole("button");
      expect(send).toBeDisabled();
      fireEvent.change(composer, { target: { value: "An unsent draft" } });
      expect(composer).toHaveValue("An unsent draft");
      expect(send).toBeEnabled();
      expect(screen.getByTitle("Attach an image")).toBeEnabled();
      expect(screen.getByTitle("Scan a barcode")).toBeEnabled();
      expect(requests.some(({ path }) => path.includes("daily-brief"))).toBe(
        false,
      );
      expect(requests.every(({ method }) => method === "GET")).toBe(true);
      expect(
        client
          .getQueryCache()
          .findAll()
          .every((query) => query.state.status !== "error"),
      ).toBe(true);
      if (legacyBrief) {
        expect(client.getQueryData(getElaineDailyBriefQueryKey())).toEqual(
          oldBrief,
        );
      }
    },
  );
});
