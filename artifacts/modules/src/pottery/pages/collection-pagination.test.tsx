import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PotteryPotteryItem } from "@workspace/api-client-react";
import Collection from "./collection";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  listPottery: mocks.list,
  useListPotteryCategories: () => ({
    data: [
      { id: 1, name: "Vases", bgColor: null, textColor: null },
      { id: 2, name: "Late pieces", bgColor: null, textColor: null },
    ],
  }),
}));
vi.mock("@/pottery/lib/assistant-context", () => ({
  usePageAssistantContext: vi.fn(),
}));
vi.mock("@workspace/elaine-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/elaine-ui")>()),
  useAppConfigSummary: () => undefined,
}));
vi.mock("@workspace/collection-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/collection-ui")>()),
  StaleThumbnailPrompt: () => null,
}));

// Every piece matches the same search/category/color; the special category
// occurs only beyond the former 200-record boundary.
const pieces: PotteryPotteryItem[] = Array.from(
  { length: 225 },
  (_, index) => ({
    id: index + 1,
    name: `Vase ${String(index + 1).padStart(3, "0")}`,
    quantity: 1,
    lockedFields: [],
    imageUrl: `/api/pottery/items/${index + 1}/image?v=test`,
    dominantColors: ["Blue"],
    motifs: ["Flowers"],
    maker: "Maker",
    categories: [
      { id: 1, name: "Vases", bgColor: null, textColor: null },
      ...(index >= 200
        ? [{ id: 2, name: "Late pieces", bgColor: null, textColor: null }]
        : []),
    ],
    images: [],
    recognitionRefreshStatus: null,
    createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
  }),
);

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Collection />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe("pottery gallery beyond 200 pieces", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    mocks.list.mockReset();
    mocks.list.mockImplementation(async ({ page, pageSize }) => ({
      items: pieces.slice((page - 1) * pageSize, page * pageSize),
      total: pieces.length,
      page,
      pageSize,
    }));
    window.scrollTo = vi.fn();
  });

  it("searches, filters, sorts, pages and selects across the entire collection", async () => {
    mount();
    await screen.findByTestId("card-piece-225");
    expect(mocks.list.mock.calls.map(([params]) => params)).toEqual(
      [1, 2, 3].map((page) => ({
        page,
        pageSize: 100,
        view: "gallery",
      })),
    );
    expect(screen.getByTestId("text-total-items").textContent).toBe("225");
    fireEvent.change(screen.getByTestId("input-search"), {
      target: { value: "Vase" },
    });
    expect(screen.getByTestId("text-total-items").textContent).toBe("225");

    fireEvent.click(screen.getByTestId("button-sort"));
    fireEvent.click(
      within(
        screen.getByText("Name", { exact: true }).parentElement!,
      ).getByRole("button", { name: "A → Z" }),
    );
    await screen.findByTestId("card-piece-1");
    fireEvent.click(screen.getByTestId("button-compare-mode"));
    fireEvent.click(
      within(screen.getByTestId("card-piece-1").parentElement!).getByRole(
        "button",
        { name: "Select for comparison" },
      ),
    );
    // Last-page navigation is the same control used by the real gallery.
    fireEvent.click(screen.getAllByRole("button", { name: "Page 12" })[0]!);
    await screen.findByTestId("card-piece-225");
    fireEvent.click(
      within(screen.getByTestId("card-piece-225").parentElement!).getByRole(
        "button",
        { name: "Select for comparison" },
      ),
    );
    expect(screen.getByText("2 pieces selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByText("Side-by-side comparison")).toBeTruthy();
    expect(screen.getAllByText("Vase 001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Vase 225").length).toBeGreaterThan(0);
  });

  it("finds a category and search that exist only after piece 200", async () => {
    mount();
    await screen.findByTestId("card-piece-225");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Filter by Blue" })[0]!,
    );
    expect(screen.getByTestId("text-total-items").textContent).toBe("225");
    fireEvent.click(screen.getByRole("button", { name: /Late pieces/ }));
    expect(screen.getByTestId("text-total-items").textContent).toBe("25");
    fireEvent.change(screen.getByTestId("input-search"), {
      target: { value: "Vase 225" },
    });
    expect(screen.getByTestId("text-total-items").textContent).toBe("1");
    expect(screen.getByTestId("card-piece-225")).toBeTruthy();
  });

  it("keeps All, maker grouping and bulk selections complete", async () => {
    mount();
    await screen.findByTestId("card-piece-225");
    // The page-size control precedes the category bar's separate "All" filter.
    fireEvent.click(screen.getAllByRole("button", { name: "All" })[0]!);
    expect(screen.getAllByTestId(/^card-piece-/)).toHaveLength(225);
    fireEvent.click(screen.getByTestId("button-group-by-maker"));
    expect(screen.getByText("225 pieces")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-bulk-reanalyze-mode"));
    fireEvent.click(
      within(screen.getByTestId("card-piece-225").parentElement!).getByRole(
        "button",
        { name: "Select for comparison" },
      ),
    );
    expect(screen.getByRole("button", { name: "Refresh AI (1)" })).toBeTruthy();
    expect(
      within(screen.getByTestId("card-piece-225").parentElement!).getByRole(
        "button",
        { name: "Deselect" },
      ),
    ).toBeTruthy();
  });

  it("shows a retryable error, not a partial gallery, if a later page fails", async () => {
    mocks.list.mockImplementation(async ({ page, pageSize }) => {
      if (page > 1) throw new Error("Network failed");
      return {
        items: pieces.slice(0, pageSize),
        total: pieces.length,
        page,
        pageSize,
      };
    });
    mount();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /retry|try again/i }),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId("card-piece-225")).toBeNull();
    expect(screen.queryByTestId("text-total-items")).toBeNull();
  });
});
