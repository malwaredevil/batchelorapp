import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PotteryPotteryItem } from "@workspace/api-client-react";
import { QuickEditSheet } from "./quick-edit-sheet";

const mocks = vi.hoisted(() => ({
  detail: { data: undefined as PotteryPotteryItem | undefined, isError: false },
  mutate: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  useGetPottery: () => ({ ...mocks.detail, refetch: mocks.retry }),
  useListPotteryCategories: () => ({ data: [] }),
  useUpdatePottery: () => ({ mutate: mocks.mutate, isPending: false }),
  useDeletePottery: () => ({ mutate: vi.fn(), isPending: false }),
}));

const galleryItem: PotteryPotteryItem = {
  id: 225,
  name: "Vase",
  quantity: 1,
  lockedFields: [],
  imageUrl: "/image",
  dominantColors: [],
  motifs: [],
  categories: [],
  images: [],
  recognitionRefreshStatus: null,
  createdAt: "2026-01-01T00:00:00Z",
};
function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <QuickEditSheet
        item={galleryItem}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("quick edit from a lightweight gallery record", () => {
  beforeEach(() => {
    cleanup();
    mocks.mutate.mockReset();
    mocks.retry.mockReset();
    mocks.detail = { data: undefined, isError: false };
  });
  it("does not allow saving until the full record has loaded", () => {
    mount();
    expect(screen.getByRole("status").textContent).toBe("Loading piece…");
    expect(screen.queryByTestId("button-quickedit-save")).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("preserves full notes when only the name is changed", () => {
    mocks.detail.data = { ...galleryItem, notes: "Important original notes" };
    mount();
    expect(screen.getByTestId("input-quickedit-notes")).toHaveValue(
      "Important original notes",
    );
    fireEvent.change(screen.getByTestId("input-quickedit-name"), {
      target: { value: "Renamed vase" },
    });
    fireEvent.click(screen.getByTestId("button-quickedit-save"));
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: 225,
      data: {
        name: "Renamed vase",
        notes: "Important original notes",
        categoryIds: [],
      },
    });
  });
  it("offers retry instead of an empty editable form when detail loading fails", () => {
    mocks.detail.isError = true;
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("button-quickedit-save")).toBeNull();
  });
  it("does not replace unsaved edits if a detail refresh arrives", () => {
    mocks.detail.data = { ...galleryItem, notes: "Original notes" };
    const view = mount();
    fireEvent.change(screen.getByTestId("input-quickedit-notes"), {
      target: { value: "Unsaved notes" },
    });
    mocks.detail.data = { ...galleryItem, notes: "Refreshed server notes" };
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <QuickEditSheet
          item={galleryItem}
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("input-quickedit-notes")).toHaveValue(
      "Unsaved notes",
    );
  });
});
