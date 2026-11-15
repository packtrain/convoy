/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { InvitationStateCard } from "./invitation-state-card";

describe("InvitationStateCard", () => {
  afterEach(() => {
    cleanup();
  });

  test("uses generic copy before invitation ownership is verified", () => {
    render(<InvitationStateCard displayState="not-authenticated" />);

    expect(screen.getByText("Sign in required")).toBeDefined();
    expect(
      screen.getByText("Sign in with the account this invitation was sent to.")
    ).toBeDefined();
    expect(screen.queryByText("You're invited!")).toBeNull();
  });

  test("does not expose invitation details for unauthorized accounts", () => {
    render(
      <InvitationStateCard
        displayState="unauthorized"
        invitation={{
          email: "i***d@e***e.com",
          inviterName: "Pat Admin",
          organizationName: "Private Org",
          role: "admin",
        }}
        onGoDashboard={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    expect(screen.getByText("Unauthorized")).toBeDefined();
    expect(
      screen.getByText(
        "This invitation is not available for the account you're signed in with."
      )
    ).toBeDefined();
    expect(screen.queryByText("Private Org")).toBeNull();
    expect(screen.queryByText("Pat Admin")).toBeNull();
    expect(screen.queryByText("i***d@e***e.com")).toBeNull();
  });

  test("uses neutral copy for an already accepted invitation", () => {
    render(
      <InvitationStateCard
        displayState="already-accepted"
        onGoOrganizations={vi.fn()}
      />
    );

    expect(screen.getByText("Invitation already accepted")).toBeDefined();
    expect(
      screen.getByText("This invitation has already been accepted.")
    ).toBeDefined();
    expect(
      screen.queryByText("You've already accepted this invitation.")
    ).toBeNull();
  });
});
