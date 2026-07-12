/**
 * Tests for the ControlPanel page — owner-only access gate.
 *
 * The page must redirect non-owner authenticated users to "/" instead of
 * rendering the settings UI.  These tests verify that the gate works as
 * written and can't be skipped by passing an isOwner=false user through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import type { AuthUser } from "@workspace/api-client-react";

// ── Mock wouter (capture Redirect target) ────────────────────────────────────

let redirectTarget: string | null = null;

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) =>
    React.createElement("a", { href }, children),
  Redirect: ({ to }: { to: string }) => {
    redirectTarget = to;
    return null;
  },
}));

// ── Mock auth ────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

// ── Mock API client ───────────────────────────────────────────────────────────

const mockGetAppConfig = vi.fn(() => ({
  data: undefined as
    | { config: import("@workspace/api-client-react").ConfigAppConfigRow[] }
    | undefined,
  isLoading: false,
  isError: false,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetAppConfig: mockGetAppConfig,
  useUpdateAppConfigValue: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  getGetAppConfigQueryKey: vi.fn(() => ["config"]),
}));

// ── Mock assistant context ────────────────────────────────────────────────────

vi.mock("@/lib/assistant-context", () => ({
  usePageAssistantContext: vi.fn(),
}));

// ── Mock React Query ──────────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => ({
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  })),
}));

// ── Mock toast ────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Mock icons ────────────────────────────────────────────────────────────────

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  ArrowLeft: () => null,
  Check: () => null,
  DatabaseZap: () => null,
  Loader2: () => null,
  RefreshCw: () => null,
  RotateCcw: () => null,
  SlidersHorizontal: () => null,
  X: () => null,
}));

// ── Mock UI components ────────────────────────────────────────────────────────

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => React.createElement("button", { onClick, disabled }, children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    React.createElement("input", props),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
}));

vi.mock("@/components/app-logo", () => ({
  AppLogo: () => null,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { useAuth } from "@/lib/auth";

const NON_OWNER_USER: AuthUser = {
  id: 88,
  email: "guest@example.com",
  name: "Guest",
  isOwner: false,
} as unknown as AuthUser;

const OWNER_USER: AuthUser = {
  id: 99,
  email: "owner@example.com",
  name: "Owner",
  isOwner: true,
} as unknown as AuthUser;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ControlPanel — owner-only gate", () => {
  beforeEach(() => {
    redirectTarget = null;
    vi.clearAllMocks();
    mockGetAppConfig.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
  });

  it("redirects a non-owner authenticated user to /", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: NON_OWNER_USER,
      isLoading: false,
    });

    const { default: ControlPanel } = await import("./control-panel");
    render(React.createElement(ControlPanel));

    expect(redirectTarget).toBe("/");
  });

  it("does NOT redirect an owner to /", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: OWNER_USER,
      isLoading: false,
    });

    const { default: ControlPanel } = await import("./control-panel");
    render(React.createElement(ControlPanel));

    expect(redirectTarget).toBeNull();
  });

  it("does NOT redirect while the config data is still loading", async () => {
    // The gate condition in control-panel.tsx is:
    //   `if (!isLoading && !user?.isOwner)` where `isLoading` comes from
    //   useGetAppConfig, not useAuth.  While the config fetch is in flight,
    //   the redirect must not fire — otherwise a non-owner user who hasn't
    //   finished loading would see a premature flash redirect.
    vi.mocked(useAuth).mockReturnValue({
      user: NON_OWNER_USER,
      isLoading: false,
    });
    mockGetAppConfig.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    const { default: ControlPanel } = await import("./control-panel");
    render(React.createElement(ControlPanel));

    expect(redirectTarget).toBeNull();
  });
});
