import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@workspace/api-client-react";
import { AccountMenu } from "./application-header";

const OWNER: AuthUser = {
  id: 1,
  email: "owner@example.test",
  displayName: "App Owner",
  isOwner: true,
};

const MEMBER: AuthUser = {
  id: 2,
  email: "member@example.test",
  displayName: "Family Member",
  isOwner: false,
};

function openMenu(user: AuthUser, overrides = {}) {
  render(<AccountMenu user={user} {...overrides} />);
  fireEvent.pointerDown(
    screen.getByRole("button", {
      name: new RegExp(`open account menu for ${user.displayName}`, "i"),
    }),
    { button: 0, ctrlKey: false },
  );
}

afterEach(cleanup);

describe("AccountMenu", () => {
  it("shows the Owner Panel only for an owner account", () => {
    openMenu(OWNER);
    expect(screen.getByText("Owner Panel")).toBeInTheDocument();
  });

  it("hides the Owner Panel from non-owner accounts", () => {
    openMenu(MEMBER);
    expect(screen.queryByText("Owner Panel")).not.toBeInTheDocument();
  });

  it("routes shared account actions and invokes sign out", () => {
    const onNavigate = vi.fn();
    const onSignOut = vi.fn();
    openMenu(OWNER, { onNavigate, onSignOut });

    fireEvent.click(screen.getByText("Account settings"));
    expect(onNavigate).toHaveBeenCalledWith("/account");

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: /open account menu for App Owner/i,
      }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(screen.getByText("Sign out"));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
