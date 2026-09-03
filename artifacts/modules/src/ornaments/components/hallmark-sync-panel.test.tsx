import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import {
  type HallmarkSyncResult,
  type HallmarkSyncStatus,
} from "@workspace/api-client-react";

const mockUseGetHallmarkEventSyncStatus = vi.fn();
const mockUseRunHallmarkEventSync = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock("lucide-react", () => ({
  Loader2: () => null,
  RefreshCw: () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getHallmarkEventSyncStatusQueryKey: () => ["/sync"],
  useGetHallmarkEventSyncStatus: (...args: unknown[]) =>
    mockUseGetHallmarkEventSyncStatus(...args),
  useRunHallmarkEventSync: (...args: unknown[]) =>
    mockUseRunHallmarkEventSync(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    children,
    open,
  }: {
    children?: React.ReactNode;
    open?: boolean;
  }) => (open ? <div data-testid="confirm-dialog">{children}</div> : null),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

import { HallmarkSyncPanel } from "./hallmark-sync-panel";

const status: HallmarkSyncStatus = {
  id: 1,
  sourceUrl: "https://www.hallmark.com/keepsake-ornament-events/",
  sourceFetchedAt: "2026-09-02T12:00:00.000Z",
  sourceFingerprint: "1234567890abcdef1234567890abcdef",
  lastRunAt: "2026-09-02T12:01:00.000Z",
  lastSuccessAt: "2026-08-26T12:01:00.000Z",
  lastStatus: "success",
  lastError: null,
  candidateCount: 2,
  rejectedCount: 1,
  candidates: [
    {
      sourceKey: "ornament-premiere:2026",
      title: "Hallmark Keepsake Ornament Premiere",
      startDate: "2026-07-11",
      endDate: "2026-07-19",
      details: "Shop the new Keepsake ornaments.",
      sourceUrl: "https://www.hallmark.com/keepsake-ornament-events/",
      year: 2026,
    },
  ],
  rejected: [
    {
      sourceKey: "artist-signing",
      title: "Artist signing",
      reason: "Unsupported event category",
    },
  ],
  updatedAt: "2026-09-02T12:01:00.000Z",
};

const dryRunResult: HallmarkSyncResult = {
  mode: "dry-run",
  status: "dry_run",
  sourceUrl: status.sourceUrl,
  sourceFingerprint: "fedcba0987654321fedcba0987654321",
  fetchedAt: "2026-09-02T12:02:00.000Z",
  candidateCount: 2,
  rejectedCount: 0,
  candidates: [],
  rejected: [],
  actions: [
    {
      action: "create",
      sourceKey: "ornament-premiere:2026",
      title: "Hallmark Keepsake Ornament Premiere",
      startDate: "2026-07-11",
      endDate: "2026-07-19",
    },
    {
      action: "update",
      sourceKey: "ornament-debut:2026",
      title: "Hallmark Keepsake Ornament Debut",
      startDate: "2026-10-10",
      endDate: "2026-10-18",
    },
    {
      action: "delete",
      sourceKey: "retired-event:2026",
      title: "Retired event",
    },
    { action: "unchanged", sourceKey: "unchanged:2026" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseGetHallmarkEventSyncStatus.mockReturnValue({
    data: status,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockUseRunHallmarkEventSync.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue(dryRunResult),
  });
});

describe("HallmarkSyncPanel", () => {
  it("does not expose health or sync controls to regular household users", () => {
    render(<HallmarkSyncPanel isOwner={false} />);

    expect(screen.queryByText("Hallmark sync health")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Preview sync" }),
    ).not.toBeInTheDocument();
  });

  it("shows status details and rejected records to the owner", () => {
    render(<HallmarkSyncPanel isOwner />);

    expect(screen.getByText("Hallmark sync health")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("2", { selector: "dd" })).toBeInTheDocument();
    expect(
      screen.getByText("Candidates from the last run (1)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Hallmark Keepsake Ornament Premiere"),
    ).toBeInTheDocument();
    expect(screen.getByText("Artist signing")).toBeInTheDocument();
    expect(screen.getByText("Unsupported event category")).toBeInTheDocument();
  });

  it("requires an explicit confirmation after a dry-run before applying", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(dryRunResult);
    mockUseRunHallmarkEventSync.mockReturnValue({
      isPending: false,
      mutateAsync,
    });
    render(<HallmarkSyncPanel isOwner />);

    expect(
      screen.queryByRole("button", { name: "Apply preview" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview sync" }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ dryRun: true }),
    );
    expect(screen.getByText("Dry-run result")).toBeInTheDocument();
    expect(screen.getByText("Planned calendar changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply preview" }));
    expect(screen.getByText("Apply this Hallmark sync?")).toBeInTheDocument();
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Apply sync" }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        dryRun: false,
        sourceFingerprint: dryRunResult.sourceFingerprint,
      }),
    );
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("clears a stale preview and asks the owner to preview again", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValueOnce(dryRunResult)
      .mockRejectedValueOnce(
        Object.assign(new Error("STALE_PREVIEW"), {
          status: 409,
          data: {
            code: "STALE_PREVIEW",
            error:
              "The Hallmark source changed after this preview. Run a new preview before applying.",
          },
        }),
      );
    mockUseRunHallmarkEventSync.mockReturnValue({
      isPending: false,
      mutateAsync,
    });
    render(<HallmarkSyncPanel isOwner />);

    fireEvent.click(screen.getByRole("button", { name: "Preview sync" }));
    await waitFor(() =>
      expect(screen.getByText("Dry-run result")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply sync" }));

    await waitFor(() =>
      expect(screen.queryByText("Dry-run result")).not.toBeInTheDocument(),
    );
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });
});
