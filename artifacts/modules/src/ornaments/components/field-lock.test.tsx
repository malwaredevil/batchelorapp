import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CollectionDetailField,
  CollectionDetailLayout,
  CollectionFieldLock,
} from "@workspace/collection-ui";

afterEach(cleanup);

describe("collection field lock", () => {
  it("gives the ornament title its own row while other headers stay unchanged", () => {
    const props = {
      onBack: vi.fn(),
      gallery: null,
      titleSlot: <h1>Ornament name</h1>,
      actions: <button>Edit</button>,
      fields: null,
    };
    const { rerender } = render(
      <CollectionDetailLayout {...props} headerLayout="stacked" />,
    );
    const header = screen.getByRole("heading", { name: "Ornament name" })
      .parentElement?.parentElement;
    expect(header).toHaveClass("flex-col");
    expect(
      screen.getByRole("button", { name: "Edit" }).parentElement,
    ).toHaveClass("flex-wrap");
    rerender(<CollectionDetailLayout {...props} />);
    expect(header).not.toHaveClass("flex-col");
    expect(header).toHaveClass("items-start", "justify-between");
  });

  it("offers a visible, touch-sized name lock even when unlocked", () => {
    const onToggleLock = vi.fn();
    render(
      <CollectionFieldLock
        label="Name"
        onToggleLock={onToggleLock}
        touchTarget
      />,
    );
    const button = screen.getByRole("button", { name: "Lock name" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveClass("h-11", "w-11", "text-muted-foreground");
    fireEvent.click(button);
    expect(onToggleLock).toHaveBeenCalledOnce();
  });

  it("announces the saved locked state and allows unlocking", () => {
    const onToggleLock = vi.fn();
    render(
      <CollectionFieldLock
        label="Name"
        locked
        onToggleLock={onToggleLock}
        touchTarget
      />,
    );
    const button = screen.getByRole("button", { name: "Unlock name" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveClass("text-primary");
    fireEvent.click(button);
    expect(onToggleLock).toHaveBeenCalledOnce();
  });

  it("prevents repeat toggles while saving", () => {
    const onToggleLock = vi.fn();
    render(
      <CollectionFieldLock label="Name" disabled onToggleLock={onToggleLock} />,
    );
    const button = screen.getByRole("button", { name: "Lock name" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onToggleLock).not.toHaveBeenCalled();
  });

  it("preserves existing field layout, custom help text, and non-submit behavior", () => {
    render(
      <CollectionDetailField
        label="Brand"
        value="Example"
        onToggleLock={vi.fn()}
        lockTitle="Keep my corrected brand"
      />,
    );
    const button = screen.getByRole("button", { name: "Lock brand" });
    expect(button).toHaveClass("h-6", "w-6");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("title", "Keep my corrected brand");
    expect(screen.getByText("Example")).toBeVisible();
  });
});
