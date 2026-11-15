/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MembersSection } from "./members-section";
import { expectEmptyState } from "@/test-utils/empty-state";

const useQueryMock = vi.hoisted(() => vi.fn());
const useProjectPermissionsMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    projects: { members: { list: "list", listAssignable: "listAssignable" } },
    users: { core: { current: "current" } },
  },
}));

vi.mock("@/lib/authz/use-project-permissions", () => ({
  useProjectPermissions: useProjectPermissionsMock,
}));

vi.mock("./project-member-row", () => ({
  ProjectMemberRow: ({ canManage }: { canManage: boolean }) => (
    <div>member row canManage={String(canManage)}</div>
  ),
}));

vi.mock("./add-project-member-dialog", () => ({
  AddProjectMemberDialog: () => null,
}));

const MEMBER = {
  _id: "pm_1",
  userId: "u_2",
  role: "member",
  name: "Ada",
  email: "ada@example.com",
};

function mockQueries() {
  useQueryMock.mockImplementation((ref: string) => {
    if (ref === "list") return [MEMBER];
    if (ref === "listAssignable") return [];
    return { _id: "u_1" };
  });
}

function renderSection(props?: { canManage?: boolean }) {
  return render(
    <MembersSection
      projectId={"p_1" as never}
      organizationId={"org_1" as never}
      {...props}
    />
  );
}

describe("project MembersSection", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    useProjectPermissionsMock.mockReset();
  });

  test("falls back to the project role when canManage is not passed", () => {
    mockQueries();
    useProjectPermissionsMock.mockReturnValue({
      myRole: "member",
      canManageMembers: false,
    });

    renderSection();

    expect(screen.getByText("member row canManage=false")).toBeDefined();
    expect(screen.queryByRole("button", { name: /add member/i })).toBeNull();
  });

  // Without the override, an org-settings caller holding `PROJECTS_MANAGE_ALL`
  // would lose every control: `getMyRole` reports null for them (OS-1536).
  test("canManage overrides a null project role (OS-1534)", () => {
    mockQueries();
    useProjectPermissionsMock.mockReturnValue({
      myRole: null,
      canManageMembers: false,
    });

    renderSection({ canManage: true });

    expect(screen.getByText("member row canManage=true")).toBeDefined();
    expect(screen.getByRole("button", { name: /add member/i })).toBeDefined();
  });

  test("canManage={false} overrides a project-admin role", () => {
    mockQueries();
    useProjectPermissionsMock.mockReturnValue({
      myRole: "project-admin",
      canManageMembers: true,
    });

    renderSection({ canManage: false });

    expect(screen.getByText("member row canManage=false")).toBeDefined();
  });

  test("renders no heading of its own, since the page shell owns the title", () => {
    mockQueries();
    useProjectPermissionsMock.mockReturnValue({
      myRole: "project-admin",
      canManageMembers: true,
    });

    renderSection({ canManage: true });
    expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
  });

  test("an empty member list is the shared empty state with the add action", () => {
    useQueryMock.mockImplementation((ref: string) => (ref === "list" ? [] : { _id: "u_1" }));
    useProjectPermissionsMock.mockReturnValue({ myRole: "admin", canManageMembers: true });

    const { container } = renderSection();

    expectEmptyState("No members yet", {
      boundary: container.firstElementChild as HTMLElement,
      action: { role: "button", name: /add member/i },
    });
    expect(screen.getAllByRole("button", { name: /add member/i })).toHaveLength(1);
  });
});
