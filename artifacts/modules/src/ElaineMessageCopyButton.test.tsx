import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageCopyButton, MessageText } from "@workspace/elaine-ui";
import { MarkdownMessage } from "@workspace/elaine-ui";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

describe("Elaine message copy control", () => {
  it("copies only the supplied message text and confirms success", async () => {
    writeText.mockResolvedValue(undefined);
    render(<MessageCopyButton text="Original **message** text" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Original **message** text"),
    );
    expect(
      screen.getByRole("button", { name: "Message copied" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Message copied");
  });

  it("withholds the control from incomplete and empty messages", () => {
    const { rerender } = render(
      <MessageCopyButton text="Still streaming" complete={false} />,
    );
    expect(
      screen.queryByRole("button", { name: /copy/i }),
    ).not.toBeInTheDocument();

    rerender(<MessageCopyButton text="   " />);
    expect(
      screen.queryByRole("button", { name: /copy/i }),
    ).not.toBeInTheDocument();
  });

  it("reports clipboard failures without throwing or removing the control", async () => {
    writeText.mockRejectedValue(new Error("Permission denied"));
    render(<MessageCopyButton text="Keep the conversation rendered" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    expect(
      await screen.findByRole("button", { name: "Copy failed — try again" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn't copy message",
    );
  });

  it("handles an unavailable clipboard API", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    render(<MessageCopyButton text="Message text" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    expect(
      await screen.findByRole("button", { name: "Copy failed — try again" }),
    ).toBeInTheDocument();
  });
});

describe("Elaine code block copy control", () => {
  it("copies only one code block's raw text and leaves inline code unchanged", async () => {
    writeText.mockResolvedValue(undefined);
    render(
      <MarkdownMessage
        text={
          "Use `inline()` here.\n\n```ts\nconst answer = 42;\n  return answer;\n```\n\n```sh\npnpm test\n```"
        }
      />,
    );

    expect(
      screen.getByText("inline()", { selector: "code" }),
    ).toBeInTheDocument();
    const copyButtons = screen.getAllByRole("button", { name: "Copy code" });
    expect(copyButtons).toHaveLength(2);
    fireEvent.click(copyButtons[0]!);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "const answer = 42;\n  return answer;",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Code copied" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("status")
        .some((status) => status.textContent === "Code copied"),
    ).toBe(true);
  });

  it("reports code-block clipboard failures with matching feedback", async () => {
    writeText.mockRejectedValue(new Error("Permission denied"));
    render(<MarkdownMessage text={"```\nconsole.log('nope');\n```"} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

    expect(
      await screen.findByRole("button", { name: "Copy failed — try again" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't copy code");
  });

  it("preserves citation-shaped text inside a cited reply's code block", async () => {
    writeText.mockResolvedValue(undefined);
    render(
      <MessageText
        text={"Source [1]\n\n```ts\nconst item = values[1];\n```"}
        citations={["https://example.com/source"]}
      />,
    );

    expect(screen.getByRole("link", { name: "[1]" })).toHaveAttribute(
      "href",
      "https://example.com/source",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("const item = values[1];"),
    );
  });
});
