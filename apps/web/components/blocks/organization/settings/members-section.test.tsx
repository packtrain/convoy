/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MembersSection } from "./members-section";

const { useQueryMock, resendMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  resendMock: vi.fn(async () => null),
}));

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: (ref: string) => (ref === "resend" ? resendMock : vi.fn()),
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

function invitation(inviteUrl: string | null) {
  return {
    _id: "inv_1", email: "robin@example.com", role: "member", status: "pending",
    createdAt: Date.now(), expiresAt: Date.now() + 86_400_000,
    invitedBy: { _id: "u_1", name: "Ada Lovelace", email: "ada@example.com" }, inviteUrl,
  };
}

function renderSection(pending: unknown[] = []) {
  useQueryMock.mockImplementation((ref: string) => {
    if (ref === "list") return MEMBERS;
    if (ref === "getMyRole") return "owner";
    if (ref === "listPending") return pending;
    return { _id: "u_1" };
  });
  render(<MembersSection organizationId={"org_1" as never} organization={undefined} />);
}

describe("organization MembersSection", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    resendMock.mockClear();
    vi.restoreAllMocks();
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

  test("a deployment without email offers Copy link instead of Resend", () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    renderSection([invitation("https://app.example.com/auth/invite/tok")]);

    expect(screen.queryByRole("button", { name: /resend/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith("https://app.example.com/auth/invite/tok");
  });

  test("Copy link renews the invitation, so an expired one works again", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
    renderSection([invitation("https://app.example.com/auth/invite/tok")]);

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() => expect(resendMock).toHaveBeenCalledWith({ organizationInvitationId: "inv_1" }));
  });

  test("without clipboard access the link is shown for copying by hand", async () => {
    Object.assign(navigator, { clipboard: undefined });
    const promptMock = vi.spyOn(window, "prompt").mockReturnValue(null);
    renderSection([invitation("https://app.example.com/auth/invite/tok")]);

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() =>
      expect(promptMock).toHaveBeenCalledWith(expect.any(String), "https://app.example.com/auth/invite/tok")
    );
  });

  test("a deployment with email keeps Resend", () => {
    renderSection([invitation(null)]);

    expect(screen.getByRole("button", { name: /resend/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /copy link/i })).toBeNull();
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
