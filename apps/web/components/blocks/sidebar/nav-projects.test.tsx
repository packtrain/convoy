/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { NavProjects } from "./nav-projects";
import { withProjectRole } from "@/test-utils/project-role";
import { projectListCollapseStorageKey } from "./project-list-collapse-storage";
import { DEV_SETTINGS, DEV_SETTING_ENABLED_VALUE } from "@/lib/dev-mode/constants";

const pushMock = vi.fn();
const usePathnameMock = vi.fn();
const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const unpinListMock = vi.fn();
const unpinSystemListMock = vi.fn();
let useRealDropdowns = false;
let sidebarState: "expanded" | "collapsed" = "expanded";

// Convex mutation refs expose withOptimisticUpdate (used by the sidebar task
// drop hook), so the mock has to as well.
function createMutationMock() {
  const mutation = Object.assign(vi.fn(), {
    withOptimisticUpdate: vi.fn(),
  });
  mutation.withOptimisticUpdate.mockReturnValue(mutation);
  return mutation;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => usePathnameMock(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuAction: ({
    children,
    className,
    ...props
  }: {
    children: ReactNode;
    className?: string;
  } & ComponentProps<"button">) => (
    <button type="button" className={className} {...props}>
      {children}
    </button>
  ),
  SidebarMenuButton: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) =>
    isValidElement<{ className?: string }>(children)
      ? cloneElement(children, {
          className: [children.props.className, className].filter(Boolean).join(" "),
      })
      : <div className={className}>{children}</div>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <div data-slot="sidebar-menu-item">{children}</div>
  ),
  SidebarMenuSub: ({
    children,
    ...props
  }: {
    children: ReactNode;
  } & ComponentProps<"div">) =>
    sidebarState === "collapsed" ? null : <div {...props}>{children}</div>,
  SidebarMenuSubButton: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) =>
    isValidElement<{ className?: string }>(children)
      ? cloneElement(children, {
          className: [children.props.className, className].filter(Boolean).join(" "),
        })
      : <div className={className}>{children}</div>,
  SidebarMenuSubItem: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
  useSidebar: () => ({ isMobile: false, state: sidebarState }),
}));

vi.mock("@/components/ui/dropdown-menu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/dropdown-menu")>();
  return {
    ...actual,
    DropdownMenu: (props: ComponentProps<typeof actual.DropdownMenu>) => useRealDropdowns
      ? <actual.DropdownMenu {...props} /> : <div>{props.children}</div>,
    DropdownMenuContent: (props: ComponentProps<typeof actual.DropdownMenuContent>) => useRealDropdowns
      ? <actual.DropdownMenuContent {...props} /> : <div>{props.children}</div>,
    DropdownMenuItem: (props: ComponentProps<typeof actual.DropdownMenuItem>) => useRealDropdowns
      ? <actual.DropdownMenuItem {...props} /> : <div className={props.className}>{props.children}</div>,
    DropdownMenuTrigger: (props: ComponentProps<typeof actual.DropdownMenuTrigger>) => useRealDropdowns
      ? <actual.DropdownMenuTrigger {...props} /> : <>{props.children}</>,
  };
});

vi.mock("./nav-section", () => ({
  NavSection: ({
    title,
    children,
    actions,
  }: {
    title: string;
    children: ReactNode;
    actions?: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {actions}
      {children}
    </section>
  ),
  NavSectionButton: ({
    onClick,
    "aria-label": ariaLabel,
  }: {
    onClick: () => void;
    "aria-label"?: string;
  }) => <button type="button" onClick={onClick} aria-label={ariaLabel} />,
  NavItemsSkeleton: () => <div>Loading</div>,
  NavItemsEmptyState: ({
    title,
    onClick,
  }: {
    title: string;
    onClick: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {title}
    </button>
  ),
}));

vi.mock("@/components/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/dialog")>()),
  ConfirmDialog: ({
    open,
    title,
  }: {
    open: boolean;
    title: string;
  }) => (open ? <div role="alertdialog" aria-label={title}>{title}</div> : null),
}));

vi.mock("@/components/blocks/project/project-dialog", () => ({
  ProjectDialog: () => null,
}));


vi.mock("@/components/blocks/project/project-actions-dropdown", () => ({
  ProjectActionsDropdown: ({
    organizationSlug,
    projectAlias,
    onDelete,
  }: {
    organizationSlug: string;
    projectAlias: string;
    onDelete: () => void;
  }) => (
    <div>
      <a href={`/o/${organizationSlug}/${projectAlias}/settings/general`}>
        Open settings
      </a>
      <button type="button" onClick={onDelete}>
        Delete project
      </button>
    </div>
  ),
}));

const enableGithubIntegration = () =>
  window.localStorage.setItem(DEV_SETTINGS.githubIntegration.storageKey, DEV_SETTING_ENABLED_VALUE);

describe("NavProjects", () => {
  afterEach(() => {
    cleanup();
    useRealDropdowns = false;
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    pushMock.mockReset();
    usePathnameMock.mockReset();
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    unpinListMock.mockReset();
    unpinSystemListMock.mockReset();
    sidebarState = "expanded";
  });

  test("renders project links without a separate threads action", () => {
    usePathnameMock.mockReturnValue("/o/org/ABC/threads/thread_1");
    useQueryMock.mockImplementation(withProjectRole("member", () => ([
      {
        _id: "project_abc" as Id<"projects">,
        name: "Alpha",
        alias: "ABC",
      },
      {
        _id: "project_xyz" as Id<"projects">,
        name: "Beta",
        alias: "XYZ",
      },
    ])));
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    expect(screen.getByRole("link", { name: "Alpha" }).getAttribute("href")).toBe(
      "/o/org/ABC"
    );
    expect(screen.getByRole("link", { name: "Beta" }).getAttribute("href")).toBe(
      "/o/org/XYZ"
    );
    expect(screen.queryByLabelText("Threads for Alpha")).toBeNull();
    expect(screen.queryByLabelText("Threads for Beta")).toBeNull();
  });

  test("renders Threads as the first sub-item under every project", () => {
    enableGithubIntegration();
    usePathnameMock.mockReturnValue("/o/org/ABC/threads/thread_1");
    window.history.replaceState(null, "", "/o/org/ABC/threads/thread_1");
    useQueryMock.mockImplementation((fn: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(fn)) {
        case getFunctionName(api.projects.core.listByOrganization):
          return [
            { _id: "project_abc", name: "Alpha", alias: "ABC", myRole: "member" },
            { _id: "project_xyz", name: "Beta", alias: "XYZ", myRole: "member" },
          ];
        case getFunctionName(api.tasks.lists.listPinnedForOrganization):
          return [{ projectId: "project_abc", lists: [
            { type: "system", key: "backlog", ref: "BACKLOG", name: "Backlog" },
          ] }];
        default: return undefined;
      }
    });
    useMutationMock.mockReturnValue(createMutationMock());

    const view = render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    expect(screen.getAllByRole("link", { name: "Watch Tower" }).map((link) => link.getAttribute("href")))
      .toEqual(["/o/org/ABC/watch-tower", "/o/org/XYZ/watch-tower"]);
    const prLinks = screen.getAllByRole("link", { name: "Pull Requests" });
    expect(prLinks.map((link) => link.getAttribute("href"))).toEqual(["/o/org/ABC/pull-requests", "/o/org/XYZ/pull-requests"]);
    // A provider-neutral pull request icon: GitHub is one possible source.
    expect(prLinks[0].querySelector(".lucide-git-pull-request")).not.toBeNull();
    expect(
      screen.getAllByRole("link", { name: "Watch Tower" })[0].compareDocumentPosition(prLinks[0]) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const threadLinks = screen.getAllByRole("link", { name: "Threads" });
    expect(threadLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/o/org/ABC/threads",
      "/o/org/XYZ/threads",
    ]);
    expect(threadLinks[0].getAttribute("aria-current")).toBe("page");
    expect(threadLinks[1].getAttribute("aria-current")).toBeNull();
    const backlog = screen.getByRole("link", { name: "Backlog" });
    expect(
      threadLinks[0].compareDocumentPosition(backlog) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    usePathnameMock.mockReturnValue("/o/org/ABC/watch-tower");
    window.history.replaceState(null, "", "/o/org/ABC/watch-tower");
    view.rerender(<NavProjects organizationId={"org_1" as Id<"organizations">} organizationSlug="org" />);
    expect(screen.getAllByRole("link", { name: "Watch Tower" })[0].getAttribute("aria-current")).toBe("page");
    expect(screen.getAllByRole("link", { name: "Threads" })[0].getAttribute("aria-current")).toBeNull();
    usePathnameMock.mockReturnValue("/o/org/ABC/pull-requests");
    window.history.replaceState(null, "", "/o/org/ABC/pull-requests");
    view.rerender(<NavProjects organizationId={"org_1" as Id<"organizations">} organizationSlug="org" />);
    expect(screen.getAllByRole("link", { name: "Pull Requests" })[0].getAttribute("aria-current")).toBe("page");
  });

  test.each(["expanded", "collapsed"] as const)(
    "a viewer gets no Threads entry (%s sidebar)",
    (state) => {
      sidebarState = state;
      usePathnameMock.mockReturnValue("/o/org/ABC");
      useQueryMock.mockImplementation((fn: Parameters<typeof getFunctionName>[0]) => {
        switch (getFunctionName(fn)) {
          case getFunctionName(api.projects.core.listByOrganization):
            return [
              { _id: "project_abc", name: "Alpha", alias: "ABC", myRole: "viewer" },
              { _id: "project_xyz", name: "Beta", alias: "XYZ", myRole: "member" },
            ];
          case getFunctionName(api.tasks.lists.listPinnedForOrganization):
            return [];
          default: return undefined;
        }
      });
      useMutationMock.mockReturnValue(createMutationMock());

      render(
        <NavProjects
          organizationId={"org_1" as Id<"organizations">}
          organizationSlug="org"
        />
      );

      expect(
        screen.queryAllByRole("link", { name: "Threads" }).map((link) => link.getAttribute("href"))
      ).toEqual(["/o/org/XYZ/threads"]);
      expect(screen.queryAllByRole("link", { name: "Watch Tower" }).map((link) => link.getAttribute("href")))
        .toEqual(["/o/org/XYZ/watch-tower"]);
    }
  );

  test.each(["expanded", "collapsed"] as const)(
    "a viewer project with no pinned Lists still lists Pull Requests (%s sidebar)",
    (state) => {
      enableGithubIntegration();
      sidebarState = state;
      usePathnameMock.mockReturnValue("/o/org/ABC");
      useQueryMock.mockImplementation((fn: Parameters<typeof getFunctionName>[0]) => {
        switch (getFunctionName(fn)) {
          case getFunctionName(api.projects.core.listByOrganization):
            return [{ _id: "project_abc", name: "Alpha", alias: "ABC", myRole: "viewer" }];
          case getFunctionName(api.tasks.lists.listPinnedForOrganization):
            return [];
          default: return undefined;
        }
      });
      useMutationMock.mockReturnValue(createMutationMock());

      render(
        <NavProjects
          organizationId={"org_1" as Id<"organizations">}
          organizationSlug="org"
        />
      );

      if (state === "collapsed") {
        fireEvent.click(screen.getByRole("button", { name: "Open lists for Alpha" }));
      }
      expect(screen.getByRole("link", { name: "Pull Requests" }).getAttribute("href")).toBe("/o/org/ABC/pull-requests");
      expect(screen.queryByRole("link", { name: "Threads" })).toBeNull();
    }
  );

  test("hides Pull Requests while the GitHub integration toggle is off", () => {
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation((fn: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(fn)) {
        case getFunctionName(api.projects.core.listByOrganization):
          return [
            { _id: "project_abc", name: "Alpha", alias: "ABC", myRole: "member" },
            { _id: "project_xyz", name: "Beta", alias: "XYZ", myRole: "viewer" },
          ];
        case getFunctionName(api.tasks.lists.listPinnedForOrganization):
          return [];
        default: return undefined;
      }
    });
    useMutationMock.mockReturnValue(createMutationMock());

    render(<NavProjects organizationId={"org_1" as Id<"organizations">} organizationSlug="org" />);

    expect(screen.queryByRole("link", { name: "Pull Requests" })).toBeNull();
    expect(screen.getByRole("link", { name: "Threads" }).getAttribute("href")).toBe("/o/org/ABC/threads");
    // A viewer project with no pinned Lists has no sub-items, so no toggle.
    expect(screen.queryByRole("button", { name: /lists for Beta/ })).toBeNull();
  });

  test("project entry links follow a changed list grouping default", () => {
    usePathnameMock.mockReturnValue("/o/org/ABC");
    const project = { _id: "project_abc" as Id<"projects">, name: "Alpha", alias: "ABC", defaultViewMode: "list" };
    useQueryMock.mockImplementation(withProjectRole("member", () => ([{ ...project, defaultListGroupBy: "owner" }])));
    useMutationMock.mockReturnValue(createMutationMock());
    const props = { organizationId: "org_1" as Id<"organizations">, organizationSlug: "org" };
    const { rerender } = render(<NavProjects {...props} />);
    expect(screen.getByRole("link", { name: "Alpha" }).getAttribute("href")).toBe("/o/org/ABC?listGroupBy=owner");

    useQueryMock.mockImplementation(withProjectRole("member", () => ([{ ...project, defaultListGroupBy: "label" }])));
    // A new query arg re-renders the memoized content, as a live query update would.
    rerender(<NavProjects {...props} organizationId={"org_2" as Id<"organizations">} />);
    expect(screen.getByRole("link", { name: "Alpha" }).getAttribute("href")).toBe("/o/org/ABC?listGroupBy=label");
  });

  test("project entry links resolve the stored default view", () => {
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation(withProjectRole("member", () => ([
      {
        _id: "project_abc" as Id<"projects">,
        name: "Alpha",
        alias: "ABC",
        defaultViewMode: "board",
        defaultBoardGroupBy: "assignee",
      },
      {
        _id: "project_xyz" as Id<"projects">,
        name: "Beta",
        alias: "XYZ",
        defaultViewMode: "list",
      },
    ])));
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    expect(screen.getByRole("link", { name: "Alpha" }).getAttribute("href")).toBe(
      "/o/org/ABC/kanban?groupBy=assignee"
    );
    expect(screen.getByRole("link", { name: "Beta" }).getAttribute("href")).toBe(
      "/o/org/XYZ"
    );
  });


  test("the project row resolves the default List's own default view", () => {
    const projectId = "project_abc" as Id<"projects">;
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation((fn: unknown) => {
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );

      if (functionName === getFunctionName(api.projects.core.listByOrganization)) {
        return [
          {
            _id: projectId,
            name: "Alpha",
            alias: "ABC",
            // The project itself defaults to the table view...
            defaultViewMode: "list",
            defaultListId: "list_sprint_1" as Id<"taskLists">,
            // ...but its default List (Sprint 1) overrides to Board. Clicking
            // the project row opens that List, so the override must win.
            defaultListView: {
              defaultViewMode: "board",
              defaultBoardGroupBy: "label",
            },
          },
        ];
      }

      if (functionName === getFunctionName(api.projects.members.getMyRole)) {
        return "project-admin";
      }

      return undefined;
    });
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    expect(screen.getByRole("link", { name: "Alpha" }).getAttribute("href")).toBe(
      "/o/org/ABC/kanban?groupBy=label"
    );
  });

  test("pinned List links resolve that List's own default view", () => {
    const projectId = "project_abc" as Id<"projects">;
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation((fn: unknown) => {
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );

      if (functionName === getFunctionName(api.projects.core.listByOrganization)) {
        return [
          {
            _id: projectId,
            name: "Alpha",
            alias: "ABC",
            defaultViewMode: "list",
          },
        ];
      }

      if (functionName === getFunctionName(api.tasks.lists.listPinnedForOrganization)) {
        return [
          {
            projectId,
            lists: [
              {
                type: "list",
                _id: "list_sprint_1" as Id<"taskLists">,
                _creationTime: 1,
                projectId,
                name: "Sprint 1",
                ref: "SPRINT-1",
                isArchived: false,
                isDefault: false,
                isPinned: true,
                defaultViewMode: "board",
                defaultBoardGroupBy: "label",
                createdBy: "user_1" as Id<"users">,
                updatedBy: "user_1" as Id<"users">,
                createdAt: 1,
                updatedAt: 1,
              },
              {
                type: "list",
                _id: "list_sprint_2" as Id<"taskLists">,
                _creationTime: 1,
                projectId,
                name: "Sprint 2",
                ref: "SPRINT-2",
                isArchived: false,
                isDefault: false,
                isPinned: true,
                createdBy: "user_1" as Id<"users">,
                updatedBy: "user_1" as Id<"users">,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          },
        ];
      }

      if (functionName === getFunctionName(api.projects.members.getMyRole)) {
        return "project-admin";
      }

      return undefined;
    });
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    expect(
      screen.getByRole("link", { name: "Sprint 1" }).getAttribute("href")
    ).toBe("/o/org/ABC/kanban?list=SPRINT-1&groupBy=label");
    // No override: the List inherits the project default.
    expect(
      screen.getByRole("link", { name: "Sprint 2" }).getAttribute("href")
    ).toBe("/o/org/ABC?list=SPRINT-2");
  });

  test("lets the project title use full width until the overflow action is shown", () => {
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation(withProjectRole("member", () => ([
      {
        _id: "project_abc" as Id<"projects">,
        name: "Alpha project with a long name",
        alias: "ABC",
      },
    ])));
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    const projectLink = screen.getByRole("link", {
      name: "Alpha project with a long name",
    });

    expect(projectLink.className).toContain("group-hover/menu-item:pr-8");
    expect(projectLink.className).toContain("group-focus-within/menu-item:pr-8");
  });

  test("project actions link to settings sections and open delete confirmation", () => {
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation(withProjectRole("member", (fn) =>
      getFunctionName(fn as Parameters<typeof getFunctionName>[0]) ===
      getFunctionName(api.organizations.members.getMyRole)
        ? "admin"
        : [{ _id: "project_abc" as Id<"projects">, name: "Alpha", alias: "ABC" }]
    ));
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    expect(
      screen.getByRole("link", { name: "Open settings" }).getAttribute("href")
    ).toBe("/o/org/ABC/settings/general");

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(screen.getByRole("alertdialog", { name: "Delete project" })).toBeDefined();
  });

  test("pinned List rows expose a direct unpin action before overflow actions", () => {
    const projectId = "project_abc" as Id<"projects">;
    const listId = "list_sprint_1" as Id<"taskLists">;
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation((fn: unknown) => {
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );

      if (functionName === getFunctionName(api.projects.core.listByOrganization)) {
        return [
          {
            _id: projectId,
            name: "Alpha",
            alias: "ABC",
          },
        ];
      }

      if (functionName === getFunctionName(api.tasks.lists.listPinnedForOrganization)) {
        return [
          {
            projectId,
            lists: [
              {
                type: "list",
                _id: listId,
                _creationTime: 1,
                projectId,
                name: "Sprint 1",
                ref: "SPRINT-1",
                color: "#3b82f6",
                isArchived: false,
                isDefault: false,
                isPinned: true,
                createdBy: "user_1" as Id<"users">,
                updatedBy: "user_1" as Id<"users">,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          },
        ];
      }

      if (functionName === getFunctionName(api.projects.members.getMyRole)) {
        return "project-admin";
      }

      return undefined;
    });
    unpinListMock.mockResolvedValue(null);
    useMutationMock.mockImplementation((fn: unknown) => {
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );
      if (functionName === getFunctionName(api.tasks.lists.unpin)) {
        return unpinListMock;
      }
      return createMutationMock();
    });

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    const listLink = screen.getByRole("link", { name: "Sprint 1" });
    expect(listLink.getAttribute("href")).toBe("/o/org/ABC?list=SPRINT-1");
    expect(listLink.className).toContain("group-hover/menu-sub-item:pr-12");

    fireEvent.click(
      screen.getByRole("button", { name: "Unpin Sprint 1 from sidebar" })
    );

    expect(unpinListMock).toHaveBeenCalledWith({ id: listId });
  });

  test("a viewer's pinned List row is a plain link with no actions", () => {
    const projectId = "project_abc" as Id<"projects">;
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation(withProjectRole("viewer", (fn) => {
      switch (getFunctionName(fn as Parameters<typeof getFunctionName>[0])) {
        case getFunctionName(api.projects.core.listByOrganization):
          return [{ _id: projectId, name: "Alpha", alias: "ABC", myRole: "viewer" }];
        case getFunctionName(api.tasks.lists.listPinnedForOrganization):
          return [{ projectId, lists: [{
            type: "list", _id: "list_sprint_1", _creationTime: 1, projectId,
            name: "Sprint 1", ref: "SPRINT-1", isArchived: false, isDefault: false,
            isPinned: true, createdBy: "user_1", updatedBy: "user_1", createdAt: 1, updatedAt: 1,
          }] }];
        default: return undefined;
      }
    }));
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    expect(screen.getByRole("link", { name: "Sprint 1" }).className).not.toContain("pr-6");
    expect(screen.queryByLabelText("Actions for Sprint 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Unpin Sprint 1 from sidebar" })).toBeNull();
  });

  test("an open delete confirmation closes when the org delete permission goes away", () => {
    let orgRole = "admin";
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation(withProjectRole("viewer", (fn) => {
      switch (getFunctionName(fn as Parameters<typeof getFunctionName>[0])) {
        case getFunctionName(api.projects.core.listByOrganization):
          return [{ _id: "project_abc", name: "Alpha", alias: "ABC", myRole: "viewer" }];
        case getFunctionName(api.organizations.members.getMyRole):
          return orgRole;
        default: return undefined;
      }
    }));
    useMutationMock.mockReturnValue(createMutationMock());
    const view = render(
      <NavProjects organizationId={"org_1" as Id<"organizations">} organizationSlug="org" />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(screen.getByRole("alertdialog", { name: "Delete project" })).toBeDefined();

    orgRole = "member";
    view.rerender(
      <NavProjects organizationId={"org_1" as Id<"organizations">} organizationSlug="org" iconOnly />
    );
    expect(screen.queryByRole("alertdialog", { name: "Delete project" })).toBeNull();
  });

  test("marks a pinned List active on the kanban route when the list param matches", () => {
    const projectId = "project_abc" as Id<"projects">;
    const listId = "list_sprint_1" as Id<"taskLists">;
    window.history.replaceState(null, "", "/o/org/ABC/kanban?list=SPRINT-1");
    usePathnameMock.mockReturnValue("/o/org/ABC/kanban");
    useQueryMock.mockImplementation((fn: unknown) => {
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );

      if (functionName === getFunctionName(api.projects.core.listByOrganization)) {
        return [
          {
            _id: projectId,
            name: "Alpha",
            alias: "ABC",
          },
        ];
      }

      if (functionName === getFunctionName(api.tasks.lists.listPinnedForOrganization)) {
        return [
          {
            projectId,
            lists: [
              {
                type: "list",
                _id: listId,
                _creationTime: 1,
                projectId,
                name: "Sprint 1",
                ref: "SPRINT-1",
                color: "#3b82f6",
                isArchived: false,
                isDefault: false,
                isPinned: true,
                createdBy: "user_1" as Id<"users">,
                updatedBy: "user_1" as Id<"users">,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          },
        ];
      }

      if (functionName === getFunctionName(api.projects.members.getMyRole)) {
        return "project-admin";
      }

      return undefined;
    });
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    const listLink = screen.getByRole("link", { name: "Sprint 1" });
    expect(listLink.parentElement?.className).toContain("before:absolute");
    expect(listLink.parentElement?.className).not.toContain("hover:before:absolute");
  });

  test("pinned Backlog system row navigates and exposes only an unpin action", () => {
    const projectId = "project_abc" as Id<"projects">;
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation((fn: unknown) => {
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );

      if (functionName === getFunctionName(api.projects.core.listByOrganization)) {
        return [{ _id: projectId, name: "Alpha", alias: "ABC" }];
      }

      if (functionName === getFunctionName(api.tasks.lists.listPinnedForOrganization)) {
        return [
          {
            projectId,
            lists: [
              { type: "system", key: "backlog", ref: "BACKLOG", name: "Backlog" },
            ],
          },
        ];
      }

      if (functionName === getFunctionName(api.projects.members.getMyRole)) {
        return "project-admin";
      }

      return undefined;
    });
    unpinSystemListMock.mockResolvedValue(null);
    useMutationMock.mockImplementation((fn: unknown) => {
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );
      if (functionName === getFunctionName(api.tasks.lists.unpinSystemList)) {
        return unpinSystemListMock;
      }
      return createMutationMock();
    });

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    const backlogLink = screen.getByRole("link", { name: "Backlog" });
    expect(backlogLink.getAttribute("href")).toBe("/o/org/ABC?list=BACKLOG");

    // No `...` overflow actions menu for the system row.
    expect(
      screen.queryByRole("button", { name: "Actions for Backlog" })
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Unpin Backlog from sidebar" })
    );
    expect(unpinSystemListMock).toHaveBeenCalledWith({
      projectId,
      key: "backlog",
    });
  });

  test("the section's add button is named", () => {
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation(withProjectRole("member", () => ([])));
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    expect(screen.getByRole("button", { name: "New project" })).toBeDefined();
  });

  test("renders empty-state action when organization has no projects", () => {
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation(withProjectRole("member", () => ([])));
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    expect(screen.getByRole("button", { name: "+ New project" })).toBeDefined();
  });

  test("collapses pinned Lists per project and preserves the state across remounts", () => {
    const projectId = "project_abc" as Id<"projects">;
    const listId = "list_sprint_1" as Id<"taskLists">;
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation((fn: unknown) => {
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );

      if (functionName === getFunctionName(api.projects.core.listByOrganization)) {
        return [{ _id: projectId, name: "Alpha", alias: "ABC" }];
      }

      if (functionName === getFunctionName(api.tasks.lists.listPinnedForOrganization)) {
        return [
          {
            projectId,
            lists: [
              {
                type: "list",
                _id: listId,
                _creationTime: 1,
                projectId,
                name: "Sprint 1",
                ref: "SPRINT-1",
                color: "#3b82f6",
                isArchived: false,
                isDefault: false,
                isPinned: true,
                createdBy: "user_1" as Id<"users">,
                updatedBy: "user_1" as Id<"users">,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          },
        ];
      }

      if (functionName === getFunctionName(api.projects.members.getMyRole)) {
        return "project-admin";
      }

      return undefined;
    });
    useMutationMock.mockReturnValue(createMutationMock());

    const props = {
      organizationId: "org_1" as Id<"organizations">,
      organizationSlug: "org",
    };

    render(<NavProjects {...props} />);

    expect(screen.getByRole("link", { name: "Sprint 1" })).toBeDefined();
    const collapseButton = screen.getByRole("button", {
      name: "Collapse lists for Alpha",
    });
    expect(collapseButton.getAttribute("aria-expanded")).toBe("true");
    const controlledGroupId = collapseButton.getAttribute("aria-controls");
    expect(controlledGroupId).toBeTruthy();
    expect(document.getElementById(controlledGroupId ?? "")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open settings" })).toBeDefined();

    fireEvent.click(collapseButton);

    expect(screen.queryByRole("link", { name: "Sprint 1" })).toBeNull();
    expect(window.localStorage.getItem(projectListCollapseStorageKey)).toBe(
      JSON.stringify([projectId])
    );

    cleanup();
    useRealDropdowns = false;
    render(<NavProjects {...props} />);

    expect(screen.queryByRole("link", { name: "Sprint 1" })).toBeNull();
    const expandButton = screen.getByRole("button", {
      name: "Expand lists for Alpha",
    });
    expect(expandButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(expandButton);

    expect(screen.getByRole("link", { name: "Sprint 1" })).toBeDefined();
    expect(window.localStorage.getItem(projectListCollapseStorageKey)).toBeNull();
  });

  test("collapsed sidebar exposes pinned Lists from a click menu on the project icon", () => {
    const projectId = "project_abc" as Id<"projects">;
    const listId = "list_sprint_1" as Id<"taskLists">;
    sidebarState = "collapsed";
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation((fn: unknown) => {
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );

      if (functionName === getFunctionName(api.projects.core.listByOrganization)) {
        return [
          {
            _id: projectId,
            name: "Alpha",
            alias: "ABC",
          },
        ];
      }

      if (functionName === getFunctionName(api.tasks.lists.listPinnedForOrganization)) {
        return [
          {
            projectId,
            lists: [
              {
                type: "list",
                _id: listId,
                _creationTime: 1,
                projectId,
                name: "Sprint 1",
                ref: "SPRINT-1",
                color: "#3b82f6",
                isArchived: false,
                isDefault: false,
                isPinned: true,
                createdBy: "user_1" as Id<"users">,
                updatedBy: "user_1" as Id<"users">,
                createdAt: 1,
                updatedAt: 1,
              },
              { type: "system", key: "backlog", ref: "BACKLOG", name: "Backlog" },
            ],
          },
        ];
      }

      return undefined;
    });
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    const trigger = screen.getByRole("button", { name: "Open lists for Alpha" });
    expect(trigger.getAttribute("aria-label")).toBe("Open lists for Alpha");

    expect(screen.getByRole("link", { name: "Sprint 1" }).getAttribute("href")).toBe(
      "/o/org/ABC?list=SPRINT-1"
    );
    expect(screen.getByRole("link", { name: "Backlog" }).getAttribute("href")).toBe(
      "/o/org/ABC?list=BACKLOG"
    );
  });

  test("icon rail renders the project List menu without a hidden submenu row", () => {
    const projectId = "project_abc" as Id<"projects">;
    const listId = "list_sprint_1" as Id<"taskLists">;
    sidebarState = "expanded";
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation((fn: unknown) => {
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );

      if (functionName === getFunctionName(api.projects.core.listByOrganization)) {
        return [{ _id: projectId, name: "Alpha", alias: "ABC" }];
      }

      if (functionName === getFunctionName(api.tasks.lists.listPinnedForOrganization)) {
        return [
          {
            projectId,
            lists: [
              {
                type: "list",
                _id: listId,
                _creationTime: 1,
                projectId,
                name: "Sprint 1",
                ref: "SPRINT-1",
                color: "#3b82f6",
                isArchived: false,
                isDefault: false,
                isPinned: true,
                createdBy: "user_1" as Id<"users">,
                updatedBy: "user_1" as Id<"users">,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          },
        ];
      }

      return undefined;
    });
    useMutationMock.mockReturnValue(createMutationMock());

    const { container } = render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        iconOnly
      />
    );

    expect(
      screen.getByRole("button", { name: "Open lists for Alpha" })
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Collapse lists for Alpha" })
    ).toBeNull();
    expect(
      container.querySelectorAll('[data-slot="sidebar-menu-item"]')
    ).toHaveLength(1);
  });

  test("keeps an open project List menu when the notifications rail closes", () => {
    useRealDropdowns = true;
    sidebarState = "expanded";
    usePathnameMock.mockReturnValue("/o/org/ABC");
    window.history.replaceState(null, "", "/o/org/ABC");
    useQueryMock.mockImplementation((fn: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(fn)) {
        case getFunctionName(api.projects.core.listByOrganization):
          return [{ _id: "project_abc", name: "Alpha", alias: "ABC" }];
        case getFunctionName(api.tasks.lists.listPinnedForOrganization):
          return [{ projectId: "project_abc", lists: [
            { type: "system", key: "backlog", ref: "BACKLOG", name: "Backlog" },
          ] }];
        default: return undefined;
      }
    });
    useMutationMock.mockReturnValue(createMutationMock());
    const props = { organizationId: "org_1" as Id<"organizations">, organizationSlug: "org" };
    const { rerender, container } = render(<NavProjects {...props} iconOnly />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Open lists for Alpha" }), { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    expect(container.contains(menu)).toBe(false);

    rerender(<NavProjects {...props} iconOnly={false} />);

    expect(screen.getByRole("menu")).toBe(menu);
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog" }));
    expect(window.location.search).toBe("?list=BACKLOG");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("collapsed sidebar project menu starts with Threads", () => {
    sidebarState = "collapsed";
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation((fn: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(fn)) {
        case getFunctionName(api.projects.core.listByOrganization):
          return [{ _id: "project_abc", name: "Alpha", alias: "ABC", myRole: "member" }];
        case getFunctionName(api.tasks.lists.listPinnedForOrganization):
          return [];
        default: return undefined;
      }
    });
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    expect(screen.getByRole("button", { name: "Open lists for Alpha" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Threads" }).getAttribute("href")).toBe(
      "/o/org/ABC/threads"
    );
  });

  test("collapsed sidebar project menu is headed by the project name", () => {
    useRealDropdowns = true;
    sidebarState = "collapsed";
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation((fn: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(fn)) {
        case getFunctionName(api.projects.core.listByOrganization):
          return [{ _id: "project_abc", name: "Alpha", alias: "ABC", myRole: "member" }];
        case getFunctionName(api.tasks.lists.listPinnedForOrganization):
          return [];
        default: return undefined;
      }
    });
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Open lists for Alpha" }), { key: "ArrowDown" });

    expect(within(screen.getByRole("menu")).getByText("Alpha")).toBeDefined();
  });

  test("shows a collapse control for projects without pinned Lists", async () => {
    window.localStorage.setItem(
      projectListCollapseStorageKey,
      JSON.stringify(["project_abc", "project_old"])
    );
    usePathnameMock.mockReturnValue("/o/org/ABC");
    useQueryMock.mockImplementation((fn: unknown) => {
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );

      if (functionName === getFunctionName(api.projects.core.listByOrganization)) {
        return [
          {
            _id: "project_abc" as Id<"projects">,
            name: "Alpha",
            alias: "ABC",
            myRole: "member",
          },
        ];
      }

      if (functionName === getFunctionName(api.tasks.lists.listPinnedForOrganization)) {
        return [];
      }

      return undefined;
    });
    useMutationMock.mockReturnValue(createMutationMock());

    render(
      <NavProjects
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
      />
    );

    expect(screen.getByRole("link", { name: "Alpha" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Threads" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand lists for Alpha" }));
    expect(screen.getByRole("link", { name: "Threads" })).toBeDefined();
    // Ids of projects that no longer exist are pruned.
    await waitFor(() => {
      expect(window.localStorage.getItem(projectListCollapseStorageKey)).toBeNull();
    });
  });
});
