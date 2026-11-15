/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NoAccess } from "./no-access";

const signOutMock = vi.fn();

vi.mock("@/lib/auth/hooks", () => ({
  supportsSignOut: true,
  useAppSignOut: () => signOutMock,
}));

describe("NoAccess", () => {
  beforeEach(() => {
    signOutMock.mockReset();
  });

  test("lets the user return to an accessible organization through the root route", () => {
    render(<NoAccess organizationSlug="removed-org" />);

    expect(
      screen
        .getByRole("link", { name: "Go to another organization" })
        .getAttribute("href")
    ).toBe("/");
  });
});
