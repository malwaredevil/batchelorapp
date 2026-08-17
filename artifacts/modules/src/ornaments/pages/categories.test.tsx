/**
 * SuggestCategoriesDialog — opening the dialog must trigger the AI
 * suggestion request.
 *
 * WHY: The dialog's `open` boolean is owned by the parent page (toggled by
 * the "Suggest Categories" button), so it is a *controlled* Radix Dialog.
 * A previous version tried to kick off the suggestion fetch from
 * `onOpenChange`, but Radix only calls `onOpenChange` for its own internal
 * close events (Escape, overlay click) — never when a parent flips the
 * `open` prop externally. That silently left the dialog stuck showing
 * nothing: no request ever fired, so `suggestions` stayed null forever.
 *
 * These tests assert:
 *   1. Opening the dialog (open=true from the start) fires the suggestion
 *      mutation and renders the returned category names.
 *   2. Rerendering from open=false to open=true — the actual production
 *      code path when the user clicks the button — also fires the
 *      suggestion mutation (this is the regression the bug review caught).
 *   3. Accepting suggestions calls the create-and-backfill mutation with
 *      the selected names.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ── Mock lucide-react ─────────────────────────────────────────────────────────
vi.mock("lucide-react", () => ({
  Loader2: () => null,
  Plus: () => null,
  Tags: () => null,
  Pencil: () => null,
  Trash2: () => null,
  Merge: () => null,
  Sparkles: () => null,
}));

// ── Mock shadcn/ui primitives (avoid Radix portal/pointer behavior in jsdom) ──
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
  }) =>
    React.createElement("input", {
      type: "checkbox",
      checked: !!checked,
      onChange: () => onCheckedChange?.(!checked),
    }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children?: React.ReactNode;
    open?: boolean;
  }) =>
    open
      ? React.createElement("div", { "data-testid": "dialog-open" }, children)
      : null,
  DialogContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogTitle: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("h2", null, children),
  DialogDescription: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("p", null, children),
  DialogFooter: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuItem: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuSeparator: () => null,
}));

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
  Input: (props: Record<string, unknown>) =>
    React.createElement("input", props),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("label", null, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
}));

// ── Mock react-hook-form / zod resolver (pulled in by the default export) ────
vi.mock("react-hook-form", () => ({
  useForm: () => ({
    register: () => ({}),
    handleSubmit: (fn: (...args: unknown[]) => void) => fn,
    reset: vi.fn(),
    formState: { errors: {} },
  }),
}));
vi.mock("@hookform/resolvers/zod", () => ({
  zodResolver: () => vi.fn(),
}));

// ── Mock sonner ───────────────────────────────────────────────────────────────
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Mock assistant context + elaine-ui helpers ────────────────────────────────
vi.mock("@/ornaments/lib/assistant-context", () => ({
  usePageAssistantContext: vi.fn(),
}));
vi.mock("@workspace/elaine-ui", () => ({
  formatElaineContextEntity: () => "",
  formatElaineContextList: () => "",
}));

// ── Mock React Query client ───────────────────────────────────────────────────
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── Mock api-client-react ─────────────────────────────────────────────────────
const mockSuggestMutateAsync = vi.fn();
const mockCreateAndBackfillMutateAsync = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListOrnamentCategories: () => ({ data: [], isLoading: false }),
  useCreateOrnamentCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateOrnamentCategoryColors: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRenameOrnamentCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteOrnamentCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteOrnamentUnusedCategories: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useMergeOrnamentCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSuggestOrnamentCategories: () => ({
    mutateAsync: mockSuggestMutateAsync,
    isPending: false,
  }),
  useCreateAndBackfillOrnamentCategories: () => ({
    mutateAsync: mockCreateAndBackfillMutateAsync,
    isPending: false,
  }),
  getListOrnamentCategoriesQueryKey: () => ["ornament-categories"],
  getListOrnamentsQueryKey: () => ["ornaments"],
  getGetOrnamentStatsQueryKey: () => ["ornament-stats"],
}));

// ── Import AFTER all mocks ─────────────────────────────────────────────────────
import { SuggestCategoriesDialog } from "./categories";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SuggestCategoriesDialog — fires the suggestion request on open", () => {
  it("requests suggestions and renders them when rendered already open", async () => {
    mockSuggestMutateAsync.mockResolvedValue({
      suggestions: ["Star Wars", "Snowmen"],
    });

    render(<SuggestCategoriesDialog open={true} onOpenChange={vi.fn()} />);

    await waitFor(() =>
      expect(mockSuggestMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("Star Wars")).toBeInTheDocument();
    expect(screen.getByText("Snowmen")).toBeInTheDocument();
  });

  it("requests suggestions when `open` transitions from false to true (the button-click path)", async () => {
    mockSuggestMutateAsync.mockResolvedValue({
      suggestions: ["Disney"],
    });

    const { rerender } = render(
      <SuggestCategoriesDialog open={false} onOpenChange={vi.fn()} />,
    );
    expect(mockSuggestMutateAsync).not.toHaveBeenCalled();

    rerender(<SuggestCategoriesDialog open={true} onOpenChange={vi.fn()} />);

    await waitFor(() =>
      expect(mockSuggestMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("Disney")).toBeInTheDocument();
  });

  it("does not re-request suggestions on every rerender while still open", async () => {
    mockSuggestMutateAsync.mockResolvedValue({ suggestions: ["Disney"] });

    const { rerender } = render(
      <SuggestCategoriesDialog open={true} onOpenChange={vi.fn()} />,
    );
    await waitFor(() =>
      expect(mockSuggestMutateAsync).toHaveBeenCalledTimes(1),
    );

    rerender(<SuggestCategoriesDialog open={true} onOpenChange={vi.fn()} />);
    await screen.findByText("Disney");
    expect(mockSuggestMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("submits selected names to create-and-backfill on accept", async () => {
    mockSuggestMutateAsync.mockResolvedValue({
      suggestions: ["Star Wars", "Snowmen"],
    });
    mockCreateAndBackfillMutateAsync.mockResolvedValue({
      categories: [],
      createdCount: 2,
      assignmentsCreated: 5,
    });

    render(<SuggestCategoriesDialog open={true} onOpenChange={vi.fn()} />);

    await screen.findByText("Star Wars");
    screen.getByRole("button", { name: /Create 2 Categories/i }).click();

    await waitFor(() =>
      expect(mockCreateAndBackfillMutateAsync).toHaveBeenCalledWith({
        data: { names: expect.arrayContaining(["Star Wars", "Snowmen"]) },
      }),
    );
  });
});
