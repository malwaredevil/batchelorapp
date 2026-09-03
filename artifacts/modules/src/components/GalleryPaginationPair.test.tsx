import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GalleryPaginationPair } from "./GalleryPaginationPair";

describe("GalleryPaginationPair", () => {
  it("renders matching top and bottom controls and synchronizes page changes", () => {
    const onPageChange = vi.fn();

    const { rerender } = render(
      <GalleryPaginationPair
        page={1}
        totalPages={8}
        onPageChange={onPageChange}
      >
        <div data-testid="gallery-results">Results</div>
      </GalleryPaginationPair>,
    );

    expect(screen.getAllByRole("button", { name: "Page 1" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Page 8" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Go" })).toHaveLength(2);
    expect(screen.getAllByPlaceholderText("/ 8")).toHaveLength(2);
    const results = screen.getByTestId("gallery-results");
    expect(
      screen
        .getAllByRole("button", { name: "Previous page" })[0]
        .compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      results.compareDocumentPosition(
        screen.getAllByRole("button", { name: "Previous page" })[1],
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Page 2" })[1]);
    expect(onPageChange).toHaveBeenCalledWith(2);
    fireEvent.change(screen.getAllByPlaceholderText("/ 8")[1], {
      target: { value: "8" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Go" })[1]);
    expect(onPageChange).toHaveBeenLastCalledWith(8);

    rerender(
      <GalleryPaginationPair
        page={2}
        totalPages={8}
        onPageChange={onPageChange}
      >
        <div data-testid="gallery-results">Results</div>
      </GalleryPaginationPair>,
    );
    expect(screen.getAllByRole("button", { name: "Page 2" })).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Page 2" })[0],
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getAllByRole("button", { name: "Page 2" })[1],
    ).toHaveAttribute("aria-current", "page");
  });

  it("hides both controls for a single page or empty results", () => {
    const onPageChange = vi.fn();

    const { rerender } = render(
      <GalleryPaginationPair
        page={1}
        totalPages={1}
        onPageChange={onPageChange}
      >
        <div>Results</div>
      </GalleryPaginationPair>,
    );
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();

    rerender(
      <GalleryPaginationPair
        page={1}
        totalPages={3}
        hasResults={false}
        onPageChange={onPageChange}
      >
        <div>Results</div>
      </GalleryPaginationPair>,
    );
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });
});
