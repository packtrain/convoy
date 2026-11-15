/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProjectsSection } from "./projects-section";
import { expectEmptyState, expectVerticallyCentered } from "@/test-utils/empty-state";

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    projects: { core: { listAllForOrganization: "listAll", remove: "remove" } },
    organizations: { members: { getMyRole: "getMyRole" } },
  },
}));

vi.mock("@/lib/navigation", () => ({
  appRoute: {
    organizationProjectDetail: (slug: string, projectId: string) => ({
      pathname: `/o/${slug}/settings/projects/${projectId}`,
    }),
  },
  useNavigation: () => ({ push: pushMock }),
}));

vi.mock("@/components/blocks/project/project-dialog", () => ({
  ProjectDialog: () => <div data-testid="project-dialog" />,
}));

const THREE_DAYS_AGO = Date.now() - 3 * 24 * 60 * 60 * 1000;

const PROJECTS = [
  {
    _id: "p_1",
    name: "Website Redesign",
    alias: "WEB",
    isArchived: false,
    createdAt: THREE_DAYS_AGO,
    creator: { name: "Ada Lovelace" },
  },
  {
    _id: "p_2",
    name: "Mobile App",
    alias: "MOB",
    isArchived: true,
    createdAt: THREE_DAYS_AGO,
    creator: null,
  },
];

function mockQueries({ role, projects }: { role: unknown; projects: unknown }) {
  useQueryMock.mockImplementation((ref: string) =>
    ref === "listAll" ? projects : role
  );
}

function renderSection() {
  return render(
    <ProjectsSection
      organizationId={"org_1" as never}
      organizationSlug="acme"
    />
  );
}

describe("ProjectsSection", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    pushMock.mockReset();
  });

  test("renders one row per project without a member count", () => {
    mockQueries({ role: "owner", projects: PROJECTS });

    renderSection();

    expect(screen.getByText("Website Redesign")).toBeDefined();
    expect(screen.getByText("WEB")).toBeDefined();
    expect(screen.getByText("Archived")).toBeDefined();
    // memberCount was dropped: one membership read per row is not worth it.
    expect(screen.queryByText(/member/)).toBeNull();
  });

  test("puts creator and relative created date on a second line", () => {
    mockQueries({ role: "owner", projects: PROJECTS });

    renderSection();

    expect(
      screen.getByText(/^created by Ada Lovelace, .* days? ago$/)
    ).toBeDefined();
    // No creator name recorded — still says when it was created.
    expect(screen.getByText(/^created 3 days ago$/)).toBeDefined();
  });

  test("offers manage and delete in the row actions menu", () => {
    mockQueries({ role: "owner", projects: PROJECTS });

    renderSection();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Website Redesign actions" })
    );

    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeDefined();
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage" }));
    expect(pushMock).toHaveBeenCalledWith({
      pathname: "/o/acme/settings/projects/p_1",
    });
  });

  test("hides delete from an admin without project:delete", () => {
    // No org role grants PROJECTS_MANAGE_ALL without PROJECT_DELETE today, so
    // drive the guard directly: a member sees the denial, not a delete action.
    mockQueries({ role: "member", projects: PROJECTS });

    renderSection();

    expect(screen.queryByRole("button", { name: /actions/ })).toBeNull();
  });

  test("does not render its own header — the settings shell owns the title", () => {
    mockQueries({ role: "owner", projects: PROJECTS });

    renderSection();

    // Row names are h3; a section-level h1/h2 would be the duplicate header.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(
      screen.queryByText("Every project in this organization.", { exact: false })
    ).toBeNull();
  });

  test("navigates into the project instead of expanding it", () => {
    mockQueries({ role: "owner", projects: PROJECTS });

    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Open Website Redesign" }));

    expect(pushMock).toHaveBeenCalledWith({
      pathname: "/o/acme/settings/projects/p_1",
    });
  });

  test("offers a create action when the list has projects", () => {
    mockQueries({ role: "owner", projects: PROJECTS });

    renderSection();

    expect(screen.getByRole("button", { name: /new project/i })).toBeDefined();
  });

  test("shows an empty state with a create action", () => {
    mockQueries({ role: "owner", projects: [] });

    renderSection();

    expect(screen.getByText("No projects yet")).toBeDefined();
    expect(screen.getByRole("button", { name: /create project/i })).toBeDefined();
  });

  test("the empty state is the shared unframed pattern, centered in the section", () => {
    mockQueries({ role: "owner", projects: [] });

    renderSection();

    const section = screen.getByTestId("organization-projects-section");
    const empty = expectEmptyState("No projects yet", { boundary: section, action: { role: "button", name: /create project/i } });
    expectVerticallyCentered(empty, section);
  });

  test("tells a plain member they cannot manage projects", () => {
    mockQueries({ role: "member", projects: [] });

    renderSection();

    const message = screen.getByText("Only organization owners and admins can manage projects.");
    expect(message.closest('[data-slot="empty"]')).not.toBeNull();
    expect(screen.queryByText("No projects yet")).toBeNull();
  });

  test("renders a skeleton while either query loads", () => {
    mockQueries({ role: undefined, projects: undefined });

    const { container } = renderSection();

    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText("No projects yet")).toBeNull();
  });
});
