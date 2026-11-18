/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MembersSection } from "./members-section";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: () => vi.fn(),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    organizations: {
      members: { list: "list", getMyRole: "getMyRole" },
      invitations: { listPending: "listPending", resend: "resend", revoke: "revoke" },
    },
    users: { core: { current: "current" } },
  },
}));

vi.mock("../member-row", () => ({
  MemberRow: ({ member }: { member: { name: string } }) => <div>{member.name}</div>,
}));
vi.mock("../invite-member-dialog", () => ({ InviteMemberDialog: () => null }));

const MEMBERS = [
  { _id: "u_1", name: "Ada Lovelace", email: "ada@example.com", role: "owner" },
  { _id: "u_2", name: "Grace Hopper", email: "grace@navy.mil", role: "member" },
];

function renderSection() {
  useQueryMock.mockImplementation((ref: string) => {
    if (ref === "list") return MEMBERS;
    if (ref === "getMyRole") return "owner";
    if (ref === "listPending") return [];
    return { _id: "u_1" };
  });
  render(<MembersSection organizationId={"org_1" as never} organization={undefined} />);
}

describe("organization MembersSection", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
  });

  test("puts search and a settings-size Add member in one toolbar row, button on the right", () => {
    renderSection();

    const search = screen.getByRole("searchbox", { name: "Search members" });
    const button = screen.getByRole("button", { name: /add member/i });
    expect(button.getAttribute("data-size")).toBe("settings");
    const toolbar = button.parentElement;
    expect(toolbar?.contains(search)).toBe(true);
    expect(toolbar?.className).toContain("sm:justify-between");
  });

  test("filters members by name or email", () => {
    renderSection();
    const search = screen.getByRole("searchbox", { name: "Search members" });

    fireEvent.change(search, { target: { value: "navy" } });
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
    expect(screen.getByText("Grace Hopper")).toBeDefined();

    fireEvent.change(search, { target: { value: "ADA" } });
    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    expect(screen.queryByText("Grace Hopper")).toBeNull();
  });

  test("says so when no member matches", () => {
    renderSection();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search members" }), { target: { value: "zzz" } });

    expect(screen.getByText("No members match this search.")).toBeDefined();
  });
});
