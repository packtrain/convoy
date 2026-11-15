/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DangerSection } from "./danger-section";

const leaveMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: () => "owner",
  useMutation: () => leaveMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { organizations: { members: { leave: "leave", getMyRole: "getMyRole" } } },
}));

vi.mock("@/lib/navigation", () => ({
  appRoute: { organizations: () => ({ pathname: "/o" }) },
  useNavigation: () => ({ push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

describe("DangerSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("shows a failed leave's server message without the Convex prefix", async () => {
    const error = new ConvexError("You are the last owner");
    error.message = "[CONVEX M(organizations/members:leave)] Server Error Uncaught ConvexError: You are the last owner";
    leaveMock.mockRejectedValue(error);
    render(
      <DangerSection
        organizationId={"org_1" as never}
        organization={{ name: "Acme" } as never}
        onOrganizationLeft={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Leave organization" }));
    });

    expect(toastErrorMock).toHaveBeenCalledWith("You are the last owner");
  });
});
