import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SingleValueAutocomplete } from "@workspace/collection-ui";

function AutocompleteHarness() {
  const [value, setValue] = useState("");

  return (
    <>
      <SingleValueAutocomplete
        id="series"
        value={value}
        onValueChange={setValue}
        suggestions={["Frosty Friends", "frosty friends", "Star Wars", "  "]}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("ornament series autocomplete interaction", () => {
  it("opens on focus and removes duplicate casing from the suggestions", () => {
    render(<AutocompleteHarness />);

    fireEvent.focus(screen.getByRole("combobox"));

    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(
      screen.getByRole("option", { name: "Frosty Friends" }),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: "Star Wars" })).toBeVisible();
  });

  it("filters case-insensitively and uses the stored spelling on keyboard selection", () => {
    render(<AutocompleteHarness />);
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "FRO" } });

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(
      screen.getByRole("option", { name: "Frosty Friends" }),
    ).toBeVisible();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Frosty Friends" }).id,
    );
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("value")).toHaveTextContent("Frosty Friends");
  });

  it("keeps unmatched text as a valid controlled value", () => {
    render(<AutocompleteHarness />);
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    fireEvent.change(input, {
      target: { value: "Series Autocomplete QA 1195" },
    });

    expect(input).toHaveValue("Series Autocomplete QA 1195");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
