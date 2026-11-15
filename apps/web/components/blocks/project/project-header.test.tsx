/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { ProjectHeader } from "./project-header";

const filterDropdownMock = vi.fn();
const projectTaskListDropdownMock = vi.fn();
const settingsDropdownMock = vi.fn();

vi.mock("./filter-dropdown", () => ({
  FilterDropdown: (props: { isActive?: boolean }) => {
    filterDropdownMock(props);
    return <div data-testid="filter-dropdown" data-active={String(Boolean(props.isActive))} />;
  },
}));

vi.mock("./settings-dropdown", () => ({
  SettingsDropdown: (props: Record<string, unknown>) => {
    settingsDropdownMock(props);
    return <div data-testid="settings-dropdown" />;
  },
}));

vi.mock("./project-members-avatar-group", () => ({
  ProjectMembersAvatarGroup: () => <div data-testid="project-members-avatar-group" />,
}));

vi.mock("./task-search-dropdown", () => ({
  TaskSearchDropdown: () => <div data-testid="task-search-dropdown" />,
}));

vi.mock("./task-lists/project-task-list-dropdown", () => ({
  ProjectTaskListDropdown: (props: {
    archiveFilter: string;
  }) => {
    projectTaskListDropdownMock(props);
    return <div data-testid="project-task-list-dropdown" />;
  },
}));

vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const noop = vi.fn();

function renderProjectHeader(overrides: Partial<ComponentProps<typeof ProjectHeader>> = {}) {
  return render(
    <ProjectHeader
      projectName="Project"
      statusFilter="all"
      assigneeFilter={null}
      archiveFilter="active"
      viewMode="list"
      listPath="/o/acme/ABC"
      boardPath="/o/acme/ABC/kanban"
      onStatusFilterChange={noop}
      onAssigneeFilterChange={noop}
      onArchiveFilterChange={noop}
      onSearchTaskSelect={noop}
      getSearchTaskHref={(taskRefId) => `/o/acme/ABC?task=${taskRefId}`}
      onAddTask={noop}
      {...overrides}
    />
  );
}

describe("ProjectHeader view controls", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("shows the add task button only with an add task action", () => {
    renderProjectHeader();
    expect(screen.getByRole("button", { name: "Add task" })).toBeTruthy();
    cleanup();

    renderProjectHeader({ onAddTask: undefined });
    expect(screen.queryByRole("button", { name: "Add task" })).toBeNull();
  });

  test("allows long project titles to truncate within the available header space", () => {
    const longProjectName =
      "A very long project name that should truncate instead of wrapping or overflowing";

    renderProjectHeader({
      projectName: longProjectName,
      boardPath: undefined,
    });

    const title = screen.getByText(longProjectName);
    expect(title.className).toContain("truncate");
    expect(title.getAttribute("title")).toBe(longProjectName);

    const leftHeaderSection = title.closest("div");
    expect(leftHeaderSection?.className).toContain("min-w-0");
    expect(leftHeaderSection?.className).toContain("flex-1");
  });

  test("does not render the app sidebar toggle in the project header", () => {
    renderProjectHeader();

    expect(screen.queryByRole("button", { name: /sidebar/i })).toBeNull();
  });

  test("does not render a Threads link (it lives in the sidebar)", () => {
    renderProjectHeader({ organizationSlug: "acme", projectAlias: "ABC" });

    expect(screen.queryByRole("link", { name: "Threads" })).toBeNull();
  });

  test("highlights Board button when board view is active", () => {
    renderProjectHeader({
      viewMode: "board",
    });

    const boardLink = screen.getByRole("link", { name: "Board" });
    expect(boardLink.className).toContain("bg-muted");
    expect(boardLink.getAttribute("aria-current")).toBe("page");
  });

  test("marks List as active only for the default all-list state", () => {
    renderProjectHeader({
      viewMode: "list",
    });

    expect(filterDropdownMock).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false })
    );

    const listLink = screen.getByRole("link", { name: "List" });
    expect(listLink.getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("project-task-list-dropdown")).toBeDefined();
  });

  test("keeps the filter trigger neutral for filtered list states", () => {
    renderProjectHeader({
      viewMode: "list",
      statusFilter: "active",
    });

    expect(filterDropdownMock).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false })
    );

    const listLink = screen.getByRole("link", { name: "List" });
    expect(listLink.getAttribute("aria-current")).toBeNull();
  });

  test("routes backlog state through the List dropdown", () => {
    renderProjectHeader({
      viewMode: "list",
      statusFilter: "all",
      selectedListRef: "BACKLOG",
    });

    expect(filterDropdownMock).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false })
    );
    expect(projectTaskListDropdownMock).toHaveBeenCalledWith(
      expect.objectContaining({
        archiveFilter: "active",
        selectedListRef: "BACKLOG",
      })
    );

    const listLink = screen.getByRole("link", { name: "List" });
    expect(listLink.getAttribute("aria-current")).toBe("page");
  });

  test("keeps Board available in list-only states", () => {
    renderProjectHeader({
      statusFilter: "all",
      selectedListRef: "BACKLOG",
      archiveFilter: "active",
    });

    const boardLink = screen.getByRole("link", { name: "Board" });
    expect(boardLink.getAttribute("href")).toBe("/o/acme/ABC/kanban");
    expect(boardLink.getAttribute("aria-current")).toBeNull();
  });

  test("disables Board in archived state", () => {
    renderProjectHeader({
      archiveFilter: "archived",
      isBoardViewAvailable: false,
    });

    expect(screen.queryByRole("link", { name: "Board" })).toBeNull();
    const boardButton = screen.getByRole("button", { name: "Board" });
    expect(boardButton.hasAttribute("disabled")).toBe(true);
    expect(boardButton.getAttribute("aria-disabled")).toBe("true");
    expect(projectTaskListDropdownMock).toHaveBeenCalledWith(
      expect.objectContaining({ archiveFilter: "archived" })
    );
  });

  test("always shows the settings trigger", () => {
    renderProjectHeader();

    expect(screen.getByTestId("settings-dropdown")).toBeDefined();
  });

  test("passes project settings actions to the settings dropdown", () => {
    const onMembersClick = vi.fn();
    const onAiAgentsClick = vi.fn();

    renderProjectHeader({
      projectId: "project_123" as Id<"projects">,
      hiddenTaskTableColumns: ["assignee"],
      organizationSlug: "acme",
      projectAlias: "ABC",
      onMembersClick,
      onAiAgentsClick,
    });

    expect(settingsDropdownMock).toHaveBeenCalledWith(
      expect.objectContaining({
        onAddMembers: onMembersClick,
        onOpenAiAgents: onAiAgentsClick,
        projectPath: "/o/acme/ABC",
        projectId: "project_123",
        hiddenTaskTableColumns: ["assignee"],
        organizationSlug: "acme",
        projectAlias: "ABC",
      })
    );
  });

  test("shows Board grouping settings only on Board routes", () => {
    const onBoardGroupByChange = vi.fn();

    renderProjectHeader({
      viewMode: "board",
      boardGroupBy: "assignee",
      onBoardGroupByChange,
    });

    expect(settingsDropdownMock).toHaveBeenCalledWith(
      expect.objectContaining({
        showBoardGroupBy: true,
        boardGroupBy: "assignee",
        onBoardGroupByChange,
      })
    );

    cleanup();
    settingsDropdownMock.mockReset();

    renderProjectHeader({
      viewMode: "list",
      boardGroupBy: "assignee",
      onBoardGroupByChange,
    });

    expect(settingsDropdownMock).toHaveBeenCalledWith(
      expect.objectContaining({
        showBoardGroupBy: false,
        boardGroupBy: "assignee",
        onBoardGroupByChange,
      })
    );
  });
});
