/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { clearLastResolvedRouteValueCacheForTests } from "@/lib/routing/use-last-resolved-route-value";
import {
  MobileNavBarProvider,
  useMobileNavBarState,
} from "@/components/blocks/mobile/mobile-nav-context";
import { useProjectTaskViews } from "./project-task-views-context";
import { ProjectTaskViewsShell } from "./project-task-views-shell";

const navigationPushMock = vi.fn();
const projectHeaderMock = vi.fn();
const taskListSelectorMock = vi.fn();
const useProjectNavigationStateMock = vi.fn();
const activeTaskResult = {
  tasks: [],
  isLoading: false,
  updateTask: vi.fn(),
};
const taskListResultsController = {
  query: "",
  setQuery: vi.fn(),
  resetQuery: vi.fn(),
  results: [{ _id: "list-1", ref: "INBOX", name: "Inbox", color: null }],
  isLoading: false,
  isLoadingMore: false,
  activeListLimitReached: false,
  hasMore: false,
  loadMore: vi.fn(),
};

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user-1" }),
}));

const projectLoadStateMock = vi.hoisted(() => ({ loading: false }));
const sectionsMock = vi.hoisted(() => ({ value: [] as unknown[] | undefined }));
const projectRoleMock = vi.hoisted(() => ({ value: "member" as string | undefined }));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  useQuery: (query: unknown, args?: Record<string, unknown> | "skip") => {
    if (projectLoadStateMock.loading || args === "skip") {
      return undefined;
    }
    if (getFunctionName(query as never) === "tasks/sections:list") {
      return sectionsMock.value;
    }
    if (getFunctionName(query as never) === "projects/members:getMyRole") {
      return projectRoleMock.value;
    }
    if (args && "slug" in args) {
      return { _id: "org-1" };
    }
    if (args && "organizationId" in args) {
      return {
        _id: "project-1",
        name: "Project",
        defaultListId: "list-1",
        defaultListGroupBy: "owner",
        defaultBoardGroupBy: "label",
      };
    }
    if (args && "projectId" in args) {
      return [];
    }
    return { _id: "user-1" };
  },
}));

vi.mock("@/components/blocks/project/project-header", () => ({
  ProjectHeader: (props: Record<string, unknown>) => {
    projectHeaderMock(props);
    return <div data-testid="project-header">{props.badge as React.ReactNode}</div>;
  },
}));


vi.mock("@/components/blocks/project/task-lists/project-task-list-dropdown", () => ({
  ProjectTaskListDropdown: (props: Record<string, unknown>) => {
    taskListSelectorMock(props);
    return <div data-testid="task-list-selector" />;
  },
}));

vi.mock("@/components/blocks/project/task-lists/use-selected-task-list", () => ({
  useSelectedTaskList: () => null,
}));

vi.mock("@/components/blocks/project/task-lists/use-task-list-results", () => ({
  useActiveTaskListResults: () => taskListResultsController,
}));

vi.mock("@/lib/tasks/hooks/use-tasks", () => ({
  useTasks: () => activeTaskResult,
}));

vi.mock("@/lib/dev-mode/use-dev-mode", () => ({
  useShowTaskListRank: () => false,
}));

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/navigation");
  return {
    ...actual,
    useRouteParams: () => ({ organizationSlug: "acme", projectAlias: "WEB" }),
    useNavigation: () => ({
      location: { pathname: "/o/acme/WEB/kanban", search: "", hash: "" },
      push: navigationPushMock,
      replace: vi.fn(),
    }),
    useProjectNavigationState: () => useProjectNavigationStateMock(),
  };
});

function makeNavigationState(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    viewMode: "board",
    isBoardViewAvailable: true,
    normalizedListTarget: () => ({ pathname: "/o/acme/WEB" }),
    listViewTarget: () => ({ pathname: "/o/acme/WEB" }),
    boardViewTarget: () => ({ pathname: "/o/acme/WEB/kanban" }),
    boardPreferredTarget: () => ({
      pathname: "/o/acme/WEB",
      query: { view: "board" },
    }),
    statusFilter: "all",
    assigneeFilter: null,
    archiveFilter: "active",
    selectedListRef: null,
    openTaskWithArchive: vi.fn(),
    openTaskInBoard: vi.fn(),
    taskWithArchiveHref: (taskRefId: string) => `/o/acme/WEB?task=${taskRefId}`,
    taskInBoardHref: (taskRefId: string) =>
      `/o/acme/WEB?task=${taskRefId}&view=board`,
    selectedListHref: () => "/o/acme/WEB",
    backlogHref: () => "/o/acme/WEB?list=BACKLOG",
    archivedHref: () => "/o/acme/WEB?archived=true",
    setStatusFilter: vi.fn(),
    setAssigneeFilter: vi.fn(),
    setArchiveFilter: vi.fn(),
    setSelectedListRef: vi.fn(),
    ...overrides,
  };
}

function ContextProbe() {
  const context = useProjectTaskViews();
  return (
    <div
      data-controller-shared={
        (context.taskListResultsController as unknown) === taskListResultsController
          ? "true"
          : "false"
      }
      data-active-tasks-shared={
        (context.activeTaskResult as unknown) === activeTaskResult ? "true" : "false"
      }
      data-testid="context-probe"
    />
  );
}

describe("ProjectTaskViewsShell", () => {
  beforeEach(() => {
    navigationPushMock.mockReset();
    projectHeaderMock.mockReset();
    taskListSelectorMock.mockReset();
    projectLoadStateMock.loading = false;
    sectionsMock.value = [];
    projectRoleMock.value = "member";
    clearLastResolvedRouteValueCacheForTests();
    // Like the real hook, return a fresh object with fresh callbacks on every
    // render — regression guard against identity-sensitive effects looping
    // (the mobile nav page config registration did exactly that).
    useProjectNavigationStateMock.mockImplementation(() => makeNavigationState());
    // The shell defers its heavy content past one painted frame via a double
    // requestAnimationFrame. Run rAF synchronously so the content branch
    // resolves within render()'s act() flush instead of after a real paint.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("renders one shared project header and provides the shared List controller to children", () => {
    render(
      <ProjectTaskViewsShell>
        <ContextProbe />
      </ProjectTaskViewsShell>
    );

    expect(screen.getByTestId("project-header")).toBeTruthy();
    expect(
      screen.getByTestId("context-probe").getAttribute("data-controller-shared")
    ).toBe("true");
    expect(
      screen.getByTestId("context-probe").getAttribute("data-active-tasks-shared")
    ).toBe("true");
    expect(projectHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskListResultsController,
        viewMode: "board",
        boardPath: "/o/acme/WEB/kanban",
        isBoardViewAvailable: true,
      })
    );
  });

  test.each([
    ["member", true],
    ["viewer", false],
  ])("gives the header an add task action only when a %s can create tasks", (role, hasAction) => {
    projectRoleMock.value = role;

    render(
      <ProjectTaskViewsShell>
        <ContextProbe />
      </ProjectTaskViewsShell>
    );

    expect(typeof projectHeaderMock.mock.calls.at(-1)?.[0].onAddTask).toBe(
      hasAction ? "function" : "undefined"
    );
  });

  test.each([
    ["a viewer", "viewer", 2],
    ["a member", "member", 0],
    // Members must not see it flash while the role loads.
    ["a loading role", undefined, 0],
  ])("shows the view-only badge in both headers for %s", (_label, role, count) => {
    projectRoleMock.value = role;

    render(
      <ProjectTaskViewsShell>
        <ContextProbe />
      </ProjectTaskViewsShell>
    );

    const badges = screen.queryAllByText("View only");
    expect(badges).toHaveLength(count);
    for (const badge of badges) {
      expect(badge.getAttribute("title")).toBe(
        "You're a Viewer in this project. Ask a project admin for edit access."
      );
    }
  });

  test("renders the shared List selector in the mobile header with the shared selection state", () => {
    render(
      <ProjectTaskViewsShell>
        <ContextProbe />
      </ProjectTaskViewsShell>
    );

    expect(screen.getByTestId("task-list-selector")).toBeTruthy();
    expect(taskListSelectorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        defaultListId: "list-1",
        archiveFilter: "active",
        selectedListRef: null,
        resultsController: taskListResultsController,
        backlogHref: "/o/acme/WEB?list=BACKLOG",
        archivedHref: "/o/acme/WEB?archived=true",
      })
    );
  });

  test("view switch links get the project's default grouping for each view", () => {
    const listViewTarget = vi.fn(() => ({ pathname: "/o/acme/WEB" }));
    const boardViewTarget = vi.fn(() => ({ pathname: "/o/acme/WEB/kanban" }));
    useProjectNavigationStateMock.mockImplementation(() =>
      makeNavigationState({ listViewTarget, boardViewTarget })
    );
    render(<ProjectTaskViewsShell><ContextProbe /></ProjectTaskViewsShell>);
    const defaults = expect.objectContaining({ listGroupBy: "owner", boardGroupBy: "label" });
    expect(listViewTarget).toHaveBeenCalledWith(defaults);
    expect(boardViewTarget).toHaveBeenCalledWith(defaults);
  });

  describe("list grouping when the URL names none", () => {
    function GroupingProbe() {
      const { navigationState, isListGroupingLoading } = useProjectTaskViews();
      return (
        <div
          data-testid="grouping-probe"
          data-group-by={navigationState.listGroupBy}
          data-loading={String(isListGroupingLoading)}
        />
      );
    }
    const renderList = (params: Record<string, unknown>) => {
      useProjectNavigationStateMock.mockImplementation(() =>
        makeNavigationState({ viewMode: "list", params, listGroupBy: params.listGroupBy ?? "none" })
      );
      render(<ProjectTaskViewsShell><GroupingProbe /></ProjectTaskViewsShell>);
      return screen.getByTestId("grouping-probe");
    };

    test("a List with sections groups by section in the page and header", () => {
      sectionsMock.value = [{ _id: "section-1", name: "Next", rank: "a" }];
      const probe = renderList({});
      expect(probe.getAttribute("data-group-by")).toBe("section");
      expect(projectHeaderMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ listGroupBy: "section" })
      );
    });

    test("a List without sections stays ungrouped", () => {
      expect(renderList({}).getAttribute("data-group-by")).toBe("none");
    });

    test("an explicit listGroupBy=none wins over sections", () => {
      sectionsMock.value = [{ _id: "section-1", name: "Next", rank: "a" }];
      expect(renderList({ listGroupBy: "none" }).getAttribute("data-group-by")).toBe("none");
    });

    test("grouping is loading until the List's sections load", () => {
      sectionsMock.value = undefined;
      expect(renderList({}).getAttribute("data-loading")).toBe("true");
    });
  });

  test("renders a board-shaped skeleton while loading the board route", () => {
    projectLoadStateMock.loading = true;
    useProjectNavigationStateMock.mockReturnValue(
      makeNavigationState({ viewMode: "board" })
    );

    render(
      <ProjectTaskViewsShell>
        <ContextProbe />
      </ProjectTaskViewsShell>
    );

    expect(screen.getByTestId("task-view-skeleton-board")).toBeTruthy();
    expect(screen.queryByTestId("task-view-skeleton-table")).toBeNull();
  });

  test("renders the table skeleton while loading the table route", () => {
    projectLoadStateMock.loading = true;
    useProjectNavigationStateMock.mockReturnValue(
      makeNavigationState({ viewMode: "list" })
    );

    render(
      <ProjectTaskViewsShell>
        <ContextProbe />
      </ProjectTaskViewsShell>
    );

    expect(screen.getByTestId("task-view-skeleton-table")).toBeTruthy();
    expect(screen.queryByTestId("task-view-skeleton-board")).toBeNull();
  });

  test("registers its page config with the global mobile nav bar and hides the bar while a detail surface is open", () => {
    function DetailSurfaceProbe() {
      const { setDetailSurfaceOpen } = useProjectTaskViews();
      return (
        <button
          type="button"
          onClick={() => setDetailSurfaceOpen(true)}
          data-testid="open-detail-surface"
        />
      );
    }

    function NavBarStateProbe() {
      const { hiddenCount, pageConfig } = useMobileNavBarState();
      return (
        <div
          data-testid="nav-bar-state"
          data-hidden-count={hiddenCount}
          data-has-search-override={pageConfig?.search ? "true" : "false"}
        />
      );
    }

    render(
      <MobileNavBarProvider>
        <ProjectTaskViewsShell>
          <DetailSurfaceProbe />
        </ProjectTaskViewsShell>
        <NavBarStateProbe />
      </MobileNavBarProvider>
    );

    // The per-page tools moved to the mobile header's Filters drawer trigger.
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
    const probe = screen.getByTestId("nav-bar-state");
    expect(probe.getAttribute("data-has-search-override")).toBe("true");
    expect(probe.getAttribute("data-hidden-count")).toBe("0");

    fireEvent.click(screen.getByTestId("open-detail-surface"));

    expect(
      screen.getByTestId("nav-bar-state").getAttribute("data-hidden-count")
    ).toBe("1");
  });

  test("keeps the shared header mounted when switching between Table and Board children", () => {
    useProjectNavigationStateMock.mockReturnValue(
      makeNavigationState({ viewMode: "list" })
    );

    const { rerender } = render(
      <ProjectTaskViewsShell>
        <div data-testid="table-view" />
      </ProjectTaskViewsShell>
    );

    const headerNode = screen.getByTestId("project-header");
    expect(screen.getByTestId("table-view")).toBeTruthy();

    useProjectNavigationStateMock.mockReturnValue(
      makeNavigationState({ viewMode: "board" })
    );
    rerender(
      <ProjectTaskViewsShell>
        <div data-testid="board-view" />
      </ProjectTaskViewsShell>
    );

    expect(screen.getByTestId("board-view")).toBeTruthy();
    expect(screen.queryByTestId("table-view")).toBeNull();
    // Same DOM node: the header re-rendered in place instead of remounting.
    expect(screen.getByTestId("project-header")).toBe(headerNode);
  });

  test("redirects direct board navigation when the current state is table-only", async () => {
    const normalizedListTarget = () => ({ pathname: "/o/acme/WEB" });
    useProjectNavigationStateMock.mockReturnValue(
      makeNavigationState({
        isBoardViewAvailable: false,
        normalizedListTarget,
        archiveFilter: "archived",
      })
    );

    render(
      <ProjectTaskViewsShell>
        <ContextProbe />
      </ProjectTaskViewsShell>
    );

    await waitFor(() =>
      expect(navigationPushMock).toHaveBeenCalledWith(normalizedListTarget())
    );
    expect(projectHeaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isBoardViewAvailable: false,
      })
    );
  });

});
