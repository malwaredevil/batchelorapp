/**
 * Elaine widget hide/re-enable integration tests (task: widget close control).
 *
 * WHY: The floating bubble can now be hidden "forever" (account-level
 * widgetHidden setting) or "for this session" (sessionStorage). The settings
 * card's "Show bubble" action must restore an ALREADY-MOUNTED widget in the
 * same page/session — without a reload — by clearing the session flag,
 * dispatching the unhide event, and updating the shared settings query cache.
 * A regression here means the success toast lies and the bubble stays gone
 * until the next navigation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";

const SETTINGS_KEY = ["/api/elaine/settings"] as const;
const SESSION_KEY = "elaineWidgetSessionHidden";

const mutateSpy = vi.fn();

vi.mock("lucide-react", () => {
  const Icon = () => null;
  return {
    MessageCircle: Icon,
    X: Icon,
    MessageSquarePlus: Icon,
    Maximize2: Icon,
    History: Icon,
    GripVertical: Icon,
    Brain: Icon,
    ArrowRight: Icon,
    ChevronDown: Icon,
    ChevronUp: Icon,
    Check: Icon,
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetElaineSettingsQueryKey: () => SETTINGS_KEY,
  useGetElaineSettings: () => {
    const q = useQuery({
      queryKey: SETTINGS_KEY,
      // Data is seeded into the cache by each test; never fetch.
      queryFn: async () => {
        throw new Error("unexpected fetch");
      },
      staleTime: Infinity,
      retry: false,
      enabled: false,
    });
    return { data: q.data, isLoading: false, queryKey: SETTINGS_KEY };
  },
  useUpdateElaineSettings: () => ({
    mutate: (
      vars: Record<string, unknown>,
      opts?: { onSuccess?: (r: unknown) => void },
    ) => {
      mutateSpy(vars);
      opts?.onSuccess?.({
        enabled: true,
        actionConfirmationMode: "one_by_one",
        chatWindowSize: "compact",
        widgetHidden: vars.widgetHidden ?? false,
      });
    },
    isPending: false,
  }),
  useGetElaineNudgesUnseenCount: () => ({ data: { count: 0 } }),
  getGetElaineNudgesUnseenCountQueryKey: () => ["nudges-unseen"] as const,
  useListElaineMemory: () => ({ data: [], isLoading: false }),
}));

// The chat hook drags in the whole streaming stack — the widget only needs
// `settings` (from the same shared query) while collapsed.
vi.mock("../../../lib/elaine-ui/src/useElaineChat", () => ({
  useElaineChat: () => {
    const q = useQuery<{ enabled: boolean; widgetHidden: boolean }>({
      queryKey: SETTINGS_KEY,
      queryFn: async () => {
        throw new Error("unexpected fetch");
      },
      staleTime: Infinity,
      retry: false,
      enabled: false,
    });
    return { settings: q.data, beginHandoff: async () => ({}) };
  },
}));
vi.mock("../../../lib/elaine-ui/src/ElaineChatPanel", () => ({
  ElaineChatPanel: () => null,
}));
vi.mock("../../../lib/elaine-ui/src/ElaineHistoryPanel", () => ({
  ElaineHistoryPanel: () => null,
}));

import { ElaineWidget } from "../../../lib/elaine-ui/src/ElaineWidget";
import { ElaineSettingsCard } from "../../../lib/elaine-ui/src/ElaineSettingsCard";

function renderBoth(settings: { enabled: boolean; widgetHidden: boolean }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(SETTINGS_KEY, {
    enabled: settings.enabled,
    actionConfirmationMode: "one_by_one",
    chatWindowSize: "compact",
    widgetHidden: settings.widgetHidden,
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ElaineSettingsCard />
      <ElaineWidget appId="hub" />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

const bubble = () => screen.queryByLabelText(/Open Elaine assistant/);

// jsdom has no matchMedia — the widget uses it for its desktop breakpoint.
window.matchMedia = ((query: string) => ({
  matches: true,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  onchange: null,
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

beforeEach(() => {
  sessionStorage.clear();
  mutateSpy.mockClear();
});

describe("Elaine widget hide/re-enable", () => {
  it("hide-forever + session flag → 'Show bubble' restores the bubble without a reload", () => {
    sessionStorage.setItem(SESSION_KEY, "1");
    renderBoth({ enabled: true, widgetHidden: true });

    expect(bubble()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show bubble" }));

    expect(mutateSpy).toHaveBeenCalledWith({ widgetHidden: false });
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(bubble()).not.toBeNull();
  });

  it("'Hide forever' from the close prompt hides immediately and persists", () => {
    renderBoth({ enabled: true, widgetHidden: false });
    expect(bubble()).not.toBeNull();

    fireEvent.click(screen.getByLabelText("Hide Elaine assistant bubble"));
    fireEvent.click(screen.getByRole("button", { name: "Hide forever" }));

    expect(bubble()).toBeNull();
    expect(mutateSpy).toHaveBeenCalledWith({ widgetHidden: true });
  });

  it("'Hide for this session' hides immediately and only sets the session flag", () => {
    renderBoth({ enabled: true, widgetHidden: false });

    fireEvent.click(screen.getByLabelText("Hide Elaine assistant bubble"));
    fireEvent.click(
      screen.getByRole("button", { name: "Hide for this session" }),
    );

    expect(bubble()).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBe("1");
    expect(mutateSpy).not.toHaveBeenCalled();
  });

  it("renders hidden from the start when the session flag is already set (no flash)", () => {
    sessionStorage.setItem(SESSION_KEY, "1");
    renderBoth({ enabled: true, widgetHidden: false });
    expect(bubble()).toBeNull();
  });
});
