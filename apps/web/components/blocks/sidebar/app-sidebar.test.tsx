/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  cloneElement,
  isValidElement,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { getFunctionName, type FunctionReference } from "convex/server";
import { AppSidebar } from "./app-sidebar";
import { emitNavigationLocationChange } from "@/lib/navigation/core";
import { CreateTaskDialogProvider } from "@/components/blocks/tasks/create-task-dialog-context";

const usePathnameMock = vi.fn();
const toggleSidebarMock = vi.fn();
const routerPushMock = vi.fn();
const mutationMock = vi.fn();
const setChannelMock = vi.fn();
const loadMoreMock = vi.fn();
const usePaginatedQueryMock = vi.fn();
let sidebarState: "expanded" | "collapsed" = "expanded";
let isMobileSidebar = false;
let routeParams: { projectAlias?: string } = {};

function setPathname(pathname: string) {
  usePathnameMock.mockReturnValue(pathname);
  window.history.pushState({}, "", pathname);
}

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => routeParams,
}));

// The settings Back target hook subscribes to org/project queries to resolve
// the project's default view. These tests don't exercise that path (no
// remembered project), so undefined results are enough to keep the hook from
// crashing without a ConvexProvider. The project list only feeds the Add task
// entry, which needs one project the user can create tasks in.
// The project settings nav resolves the project and both roles to gate sections.
const queryResults: Record<string, unknown> = {
  "projects/core:listByOrganization": [{ _id: "project_abc", alias: "ABC", myRole: "member" }],
  "organizations/core:getBySlug": { _id: "org_1" },
  "projects/core:getByAlias": { _id: "project_web" },
  "projects/members:getMyRole": "member",
  "organizations/members:getMyRole": "member",
};

vi.mock("convex/react", () => ({
  useQuery: (query: FunctionReference<"query">) =>
    queryResults[getFunctionName(query)],
  useMutation: () => mutationMock,
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));

vi.mock("@/lib/notifications/hooks/use-notification-preferences", () => ({
  useNotificationPreferences: () => ({
    loading: false,
    isEnabled: () => true,
    setChannel: setChannelMock,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  } & ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/environment/config", () => ({
  getEnvironmentConfig: () => ({
    label: "Development",
    description: "You are on the dev environment",
    showCard: true,
    cardClassName: "bg-amber-50",
    titleClassName: "text-amber-900",
    descriptionClassName: "text-amber-700",
  }),
}));

vi.mock("./nav-projects", () => ({
  NavProjects: ({ iconOnly }: { iconOnly?: boolean }) => (
    <div data-testid="nav-projects" data-icon-only={iconOnly ? "true" : "false"}>
      Projects
    </div>
  ),
}));

vi.mock("./nav-user", () => ({
  NavUser: ({ currentOrgId }: { currentOrgId: string }) => (
    <div>User {currentOrgId}</div>
  ),
}));

vi.mock("./keyboard-shortcuts-dialog", () => ({
  KeyboardShortcutsButton: () => {
    const [open, setOpen] = useState(false);
    return <>
      <button type="button" onClick={() => setOpen(true)}>Shortcuts</button>
      {open && <div role="dialog" aria-label="Keyboard shortcuts" />}
    </>;
  },
}));

vi.mock("./workspace-footer-actions", () => ({
  WorkspaceFooterActions: ({
    settingsActive,
  }: {
    settingsActive?: boolean;
  }) => (
    <div>
      Workspace footer actions {settingsActive ? "settings active" : ""}
    </div>
  ),
}));

vi.mock("@/components/blocks/tasks/create-task-dialog", () => ({
  CreateTaskDialog: ({
    dialog,
    activeListRef,
  }: {
    dialog: { isOpen: boolean };
    activeListRef?: string | null;
  }) =>
    dialog.isOpen ? (
      <div data-list-ref={activeListRef ?? ""}>Create task dialog</div>
    ) : null,
}));

vi.mock("@/components/ui/sidebar", () => ({
  Sidebar: ({
    children,
    className,
    forceExpanded,
    onClick,
  }: {
    children: ReactNode;
    className?: string;
    forceExpanded?: boolean;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
  }) => (
    <aside
      className={className}
      data-force-expanded={forceExpanded ? "true" : "false"}
      data-testid="app-sidebar-shell"
      onClick={onClick}
    >
      {children}
    </aside>
  ),
  SidebarHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarSeparator: () => <hr />,
  SidebarRail: () => <div>Rail</div>,
  SidebarGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarGroupContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuAction: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({
    asChild,
    children,
    className,
    disabled,
    isActive,
    onClick,
    ...props
  }: {
    asChild?: boolean;
    children: ReactNode;
    className?: string;
    disabled?: boolean;
    isActive?: boolean;
    onClick?: () => void;
  } & ComponentProps<"button">) =>
    asChild && isValidElement<{ className?: string; "data-active"?: string }>(children)
      ? cloneElement(children, {
          "data-active": isActive ? "true" : "false",
          className: [children.props.className, className].filter(Boolean).join(" "),
        })
      : (
        <button
          className={className}
          data-active={isActive ? "true" : "false"}
          disabled={disabled}
          type="button"
          onClick={onClick}
          {...props}
        >
          {children}
        </button>
      ),
  useSidebar: () => ({
    isMobile: isMobileSidebar,
    state: sidebarState,
    toggleSidebar: toggleSidebarMock,
  }),
}));

describe("AppSidebar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    usePathnameMock.mockReset();
    toggleSidebarMock.mockReset();
    routerPushMock.mockReset();
    mutationMock.mockReset();
    setChannelMock.mockReset();
    usePaginatedQueryMock.mockReset();
    loadMoreMock.mockReset();
    window.localStorage.clear();
    sidebarState = "expanded";
    isMobileSidebar = false;
    routeParams = {};
    window.history.pushState({}, "", "/");
  });

  function openNotifications(outside?: ReactNode) {
    usePaginatedQueryMock.mockReturnValue({
      results: [{
        _id: "notification_1",
        _creationTime: Date.now(),
        type: "task.created",
        read: false,
        subject: { kind: "task", id: "task_1" },
        orgSlug: "org",
        projectAlias: "ABC",
        snapshot: { actorName: "Alice", taskRef: "ABC-1", taskTitle: "Example task" },
      }],
      status: "CanLoadMore",
      loadMore: loadMoreMock,
    });
    const view = render(
      <CreateTaskDialogProvider organizationId={"org_1" as Id<"organizations">} organizationSlug="org" activeProjectAlias="ABC">
        <AppSidebar organizationId={"org_1" as Id<"organizations">} organizationSlug="org" />
        {outside}
      </CreateTaskDialogProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeDefined();
    return view;
  }

  async function click(element: Element) {
    fireEvent.pointerDown(element, { button: 0 });
    fireEvent.pointerUp(element, { button: 0 });
    await act(async () => {
      fireEvent.click(element);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
  }

  test.each(["expanded", "collapsed"] as const)("closes the inbox on outside clicks without changing %s preference", async (state) => {
    setPathname("/o/org/ABC");
    sidebarState = state;
    const onClick = vi.fn();
    openNotifications(<button onClick={(event) => { event.stopPropagation(); onClick(); }}>Outside action</button>);

    await click(screen.getByRole("button", { name: "Outside action" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
    expect(screen.getByTestId("app-sidebar-shell").dataset.forceExpanded).toBe("false");
    expect(toggleSidebarMock).not.toHaveBeenCalled();
    expect(mutationMock).not.toHaveBeenCalled();
  });

  test.each([
    ["project", "/o/org/DEF", "app"],
    ["task query", "/o/org/ABC?task=ABC-1", "app"],
    ["browser history", "/o/org/ABC?task=ABC-2", "history"],
  ])("closes the inbox on %s navigation", async (_name, next, source) => {
    setPathname("/o/org/ABC");
    openNotifications();

    await act(async () => {
      window.history.pushState({}, "", next);
      if (source === "history") window.dispatchEvent(new PopStateEvent("popstate"));
      else emitNavigationLocationChange();
    });

    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
  });

  test("runs the rail link on the first click before dismissing", async () => {
    setPathname("/o/org/ABC");
    openNotifications();
    await click(screen.getByRole("link", { name: "Watch Tower" }));
    expect(routerPushMock).toHaveBeenCalledExactlyOnceWith("/o/org/watch-tower", { scroll: false });
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
  });

  test("keeps the dialog opened by a rail action when dismissing", async () => {
    setPathname("/o/org/ABC");
    openNotifications();
    await click(screen.getByRole("button", { name: "Shortcuts" }));
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeDefined();
  });

  test.each([
    ["/o/org/settings/general", "Settings"],
    ["/o/org/ABC/settings/general", "Project settings"],
  ])("restores the settings sidebar at %s", async (path, title) => {
    setPathname(path);
    openNotifications();
    await click(document.body);
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
    expect(screen.getByRole("heading", { name: title })).toBeDefined();
  });

  test.each(["Filter notifications", "Notification settings"])(
    "keeps the inbox interactive while opening %s with the pointer",
    async (label) => {
      setPathname("/o/org/ABC");
      openNotifications();
      const trigger = screen.getByRole("button", { name: label });
      // jsdom has no PointerEvent constructor, so supply the mouse fields Radix reads.
      fireEvent(trigger, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      expect(screen.getByRole("menu")).toBeDefined();
      expect(window.getComputedStyle(trigger).pointerEvents).not.toBe("none");
      await act(async () => {
        fireEvent.pointerUp(trigger);
        fireEvent.click(trigger);
        vi.runOnlyPendingTimers();
      });
      expect(screen.getByRole("heading", { name: "Notifications" })).toBeDefined();
      expect(screen.getByRole("menu")).toBeDefined();
    }
  );

  test("preserves inbox controls and real portalled filter and settings menus", async () => {
    setPathname("/o/org/ABC");
    const { container } = openNotifications();
    await click(screen.getByRole("heading", { name: "Notifications" }));
    await click(screen.getByRole("button", { name: "Show more" }));
    expect(loadMoreMock).toHaveBeenCalledWith(20);
    await click(screen.getByRole("button", { name: "Mark as read" }));
    expect(mutationMock).toHaveBeenCalledExactlyOnceWith({ id: "notification_1" });

    fireEvent.keyDown(screen.getByRole("button", { name: "Filter notifications" }), { key: "ArrowDown" });
    const filter = screen.getByRole("menuitemradio", { name: "Unread & read" });
    expect(container.contains(filter)).toBe(false);
    await click(filter);
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeDefined();
    expect(usePaginatedQueryMock.mock.lastCall?.[1]).toEqual({ organizationId: "org_1", unreadOnly: false });

    fireEvent.keyDown(screen.getByRole("button", { name: "Notification settings" }), { key: "ArrowDown" });
    const setting = screen.getAllByRole("menuitemcheckbox")[0];
    expect(container.contains(setting)).toBe(false);
    await click(setting);
    expect(setChannelMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Notifications", hidden: true })).toBeDefined();
    expect(screen.getByRole("menu")).toBeDefined();
  });

  test("bell toggles, reopening survives, and notification links close without marking read", async () => {
    setPathname("/o/org/ABC");
    openNotifications();
    await click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
    await click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeDefined();
    await click(screen.getByRole("link", { name: /Example task/ }));
    expect(window.location.search).toBe("?task=ABC-1");
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
    expect(mutationMock).not.toHaveBeenCalled();
  });

  test("cancels pending dismissal when closing and reopening or unmounting", async () => {
    setPathname("/o/org/ABC");
    const { unmount } = openNotifications();
    fireEvent.click(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeDefined();

    fireEvent.click(document.body);
    unmount();
    openNotifications();
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeDefined();
  });

  test("leaves the mobile inbox to its sheet dismissal", async () => {
    setPathname("/o/org/ABC");
    isMobileSidebar = true;
    openNotifications();
    await click(document.body);
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeDefined();
    await click(screen.getByRole("button", { name: "Back from notifications" }));
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
  });

  test("renders organization settings sub-sidebar from settings routes", () => {
    setPathname("/o/org/settings/general");

    render(
      <CreateTaskDialogProvider
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      >
        <AppSidebar
          organizationId={"org_1" as Id<"organizations">}
          organizationSlug="org"
        />
      </CreateTaskDialogProvider>
    );

    expect(screen.getByTestId("app-sidebar-shell").dataset.forceExpanded).toBe(
      "true"
    );
    expect(screen.getByTestId("nav-projects").dataset.iconOnly).toBe("true");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Back from Settings" }).getAttribute("href")
    ).toBe("/o/org/");

    const generalLink = screen.getByRole("link", { name: "General" });
    const membersLink = screen.getByRole("link", { name: "Members" });
    const projectsLink = screen.getByRole("link", { name: "Projects" });
    const promptsLink = screen.getByRole("link", { name: "Prompts" });
    const agentsLink = screen.getByRole("link", { name: "Agents" });
    const skillsLink = screen.getByRole("link", { name: "Skills" });

    expect(generalLink.getAttribute("href")).toBe("/o/org/settings/general");
    expect(membersLink.getAttribute("href")).toBe("/o/org/settings/members");
    expect(projectsLink.getAttribute("href")).toBe("/o/org/settings/projects");
    expect(promptsLink.getAttribute("href")).toBe("/o/org/settings/prompts");
    expect(agentsLink.getAttribute("href")).toBe("/o/org/settings/agents");
    expect(skillsLink.getAttribute("href")).toBe("/o/org/settings/skills");
    expect(generalLink.getAttribute("data-active")).toBe("true");
    expect(membersLink.getAttribute("data-active")).toBe("false");
    expect(promptsLink.getAttribute("data-active")).toBe("false");
    expect(agentsLink.getAttribute("data-active")).toBe("false");
    for (const label of [
      "Workflows",
      "Task templates",
      "Project templates",
    ]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    expect(screen.getByText(/settings active/)).toBeDefined();
  });

  test("renders project settings sub-sidebar from project settings routes", () => {
    setPathname("/o/org/WEB/settings/labels");

    render(
      <CreateTaskDialogProvider
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="WEB"
      >
        <AppSidebar
          organizationId={"org_1" as Id<"organizations">}
          organizationSlug="org"
        />
      </CreateTaskDialogProvider>
    );

    expect(screen.getByTestId("app-sidebar-shell").dataset.forceExpanded).toBe(
      "true"
    );
    expect(
      screen.getByRole("heading", { name: "Project settings" })
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Back from Project settings" })
        .getAttribute("href")
    ).toBe("/o/org/WEB");

    const generalLink = screen.getByRole("link", { name: "General" });
    const promptsLink = screen.getByRole("link", { name: "Prompts" });
    const labelsLink = screen.getByRole("link", { name: "Labels" });
    const usageLink = screen.getByRole("link", { name: "Usage" });

    expect(generalLink.getAttribute("href")).toBe("/o/org/WEB/settings/general");
    expect(promptsLink.getAttribute("href")).toBe("/o/org/WEB/settings/prompts");
    expect(labelsLink.getAttribute("href")).toBe("/o/org/WEB/settings/labels");
    expect(labelsLink.getAttribute("data-active")).toBe("true");
    expect(usageLink.getAttribute("href")).toBe("/o/org/WEB/settings/usage");
    // Dev-gated sections are hidden while their toggle is off.
    expect(screen.queryByRole("button", { name: "Templates" })).toBeNull();
    // Project delete needs the org permission an org member lacks.
    expect(screen.queryByRole("link", { name: "Danger zone" })).toBeNull();
  });

  test("settings sub-sidebar is temporary and does not expand collapsed state", () => {
    setPathname("/o/org/settings/members");
    sidebarState = "collapsed";

    render(
      <CreateTaskDialogProvider
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      >
        <AppSidebar
          organizationId={"org_1" as Id<"organizations">}
          organizationSlug="org"
        />
      </CreateTaskDialogProvider>
    );

    fireEvent.click(screen.getByTestId("app-sidebar-shell"));

    expect(screen.getByTestId("app-sidebar-shell").dataset.forceExpanded).toBe(
      "true"
    );
    expect(screen.getByRole("link", { name: "Members" }).getAttribute("data-active"))
      .toBe("true");
    expect(toggleSidebarMock).not.toHaveBeenCalled();
  });

  test("dismisses settings sub-sidebar immediately when back is clicked", () => {
    setPathname("/o/org/settings/general");

    render(
      <CreateTaskDialogProvider
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      >
        <AppSidebar
          organizationId={"org_1" as Id<"organizations">}
          organizationSlug="org"
        />
      </CreateTaskDialogProvider>
    );

    expect(screen.getByRole("heading", { name: "Settings" })).toBeDefined();
    expect(screen.getByTestId("app-sidebar-shell").dataset.forceExpanded).toBe(
      "true"
    );

    fireEvent.click(screen.getByRole("link", { name: "Back from Settings" }));

    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
    expect(screen.getByTestId("app-sidebar-shell").dataset.forceExpanded).toBe(
      "false"
    );
  });

  test("does not render settings sub-sidebar on mobile", () => {
    setPathname("/o/org/settings/general");
    isMobileSidebar = true;

    render(
      <CreateTaskDialogProvider
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      >
        <AppSidebar
          organizationId={"org_1" as Id<"organizations">}
          organizationSlug="org"
        />
      </CreateTaskDialogProvider>
    );

    expect(screen.getByTestId("app-sidebar-shell").dataset.forceExpanded).toBe(
      "false"
    );
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
  });

  test("opens the create task dialog from the sidebar action", () => {
    usePathnameMock.mockReturnValue("/o/org/ABC");
    window.history.pushState({}, "", "/o/org/ABC?list=SPRINT-1");

    render(
      <CreateTaskDialogProvider
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      >
        <AppSidebar
          organizationId={"org_1" as Id<"organizations">}
          organizationSlug="org"
        />
      </CreateTaskDialogProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    expect(screen.getByText("Create task dialog").dataset.listRef).toBe(
      "SPRINT-1"
    );
  });

  test("expands when clicking collapsed sidebar background", () => {
    setPathname("/o/org/ABC");
    sidebarState = "collapsed";

    render(
      <CreateTaskDialogProvider
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      >
        <AppSidebar
          organizationId={"org_1" as Id<"organizations">}
          organizationSlug="org"
        />
      </CreateTaskDialogProvider>
    );

    fireEvent.click(screen.getByTestId("app-sidebar-shell"));

    expect(toggleSidebarMock).toHaveBeenCalledTimes(1);
  });

  test("does not expand collapsed sidebar from button clicks", () => {
    setPathname("/o/org/ABC");
    sidebarState = "collapsed";

    render(
      <CreateTaskDialogProvider
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      >
        <AppSidebar
          organizationId={"org_1" as Id<"organizations">}
          organizationSlug="org"
        />
      </CreateTaskDialogProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    expect(toggleSidebarMock).not.toHaveBeenCalled();
  });

  describe("G chords", () => {
    function renderSidebar() {
      usePaginatedQueryMock.mockReturnValue({ results: [], status: "Exhausted", loadMore: loadMoreMock });
      render(
        <CreateTaskDialogProvider organizationId={"org_1" as Id<"organizations">} organizationSlug="org" activeProjectAlias="ABC">
          <AppSidebar organizationId={"org_1" as Id<"organizations">} organizationSlug="org" />
        </CreateTaskDialogProvider>
      );
    }
    function chord(key: string) {
      fireEvent.keyDown(document.body, { key: "g" });
      fireEvent.keyDown(document.body, { key });
    }

    test("G then I opens the inbox", () => {
      setPathname("/o/org/ABC");
      renderSidebar();

      chord("i");

      expect(screen.getByRole("heading", { name: "Notifications" })).toBeDefined();
    });

    test.each([
      ["w", "/o/org/watch-tower"],
      ["s", "/o/org/settings/general"],
      ["t", "/o/org/ABC/threads"],
    ])("G then %s goes to %s", (key, pathname) => {
      setPathname("/o/org/ABC");
      routeParams = { projectAlias: "ABC" };
      renderSidebar();

      chord(key);

      expect(routerPushMock).toHaveBeenCalledExactlyOnceWith(pathname, { scroll: false });
    });

    test("G then T outside a project opens the last project's threads, or does nothing", () => {
      setPathname("/o/org/watch-tower");
      renderSidebar();
      chord("t");
      expect(routerPushMock).not.toHaveBeenCalled();

      window.localStorage.setItem("convoy.last-project:org", "WEB");
      chord("t");
      expect(routerPushMock).toHaveBeenCalledExactlyOnceWith("/o/org/WEB/threads", { scroll: false });
    });
  });

  test("shows the environment notice at the bottom and dismisses it for the session", () => {
    setPathname("/o/org/ABC");

    render(
      <CreateTaskDialogProvider
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      >
        <AppSidebar
          organizationId={"org_1" as Id<"organizations">}
          organizationSlug="org"
        />
      </CreateTaskDialogProvider>
    );

    const notice = screen.getByText("Development").parentElement?.parentElement;

    expect(screen.getByText("You are on the dev environment")).toBeDefined();
    expect(notice?.getAttribute("class")).toContain("border-0");

    fireEvent.click(
      screen.getByRole("button", { name: /dismiss environment notice/i })
    );

    expect(screen.queryByText("Development")).toBeNull();
  });
});
