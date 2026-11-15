/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Children, cloneElement, isValidElement } from "react";
import type {
  AnchorHTMLAttributes,
  ReactNode,
} from "react";
import type { RouteTarget } from "@/lib/navigation";
import { WatchTowerPage } from "./index";

const useWatchTowerSectionMock = vi.fn();
const batchMutationMock = vi.fn();
let routeOrganization = "acme";
let routeProject: string | undefined;

vi.mock("convex/react", () => ({
  useMutation: () => batchMutationMock,
}));

vi.mock("@tanstack/react-hotkeys", () => ({
  useHotkey: vi.fn(),
}));

vi.mock("@/lib/auth/hooks", () => ({
  useAppConvexAuth: () => ({ isAuthenticated: true }),
}));

// Render the dropdown's contents inline: Radix needs pointer-event plumbing
// jsdom lacks, and these tests care about the settings it holds, not the popover.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => (
    <>{children}</>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    className?: string;
    onSelect?: (event: { preventDefault: () => void }) => void;
  }) => (
    <div role="menuitem" onClick={() => onSelect?.({ preventDefault: () => {} })}>
      {children}
    </div>
  ),
  DropdownMenuRadioGroup: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <div data-testid="layout-radio-group" data-value={value}>
      {/* Hand each item the group's callback, like Radix's context does. */}
      {Children.map(children, (child) =>
        isValidElement<{ value: string }>(child)
          ? cloneElement(child, {
              onSelectValue: onValueChange,
              checked: child.props.value === value,
            } as never)
          : child
      )}
    </div>
  ),
  DropdownMenuRadioItem: ({
    children,
    value,
    checked,
    onSelectValue,
  }: {
    children: ReactNode;
    value: string;
    checked?: boolean;
    onSelectValue?: (value: string) => void;
  }) => (
    <div
      role="menuitemradio"
      aria-checked={checked ? "true" : "false"}
      onClick={() => onSelectValue?.(value)}
    >
      {children}
    </div>
  ),
}));

vi.mock("@/lib/watch-tower/use-watch-tower-threads", () => ({
  useWatchTowerSection: (...args: unknown[]) =>
    useWatchTowerSectionMock(...args),
}));

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/navigation")>();

  return {
    ...actual,
    AppLink: ({
      href,
      children,
      ...props
    }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
      href: RouteTarget | string;
      children: ReactNode;
    }) => (
      <a
        href={typeof href === "string" ? href : actual.href(href)}
        {...props}
      >
        {children}
      </a>
    ),
    useRouteParams: () => ({ organizationSlug: routeOrganization, projectAlias: routeProject }),
  };
});

const associatedThread = {
  isOwner: true,
  _id: "thread_1",
  title: "Allow forking the conversation mid-thread",
  cliType: "claude-code",
  status: "completed",
  processingState: "idle",
  lastActivityAt: Date.now(),
  branch: "main",
  pullRequest: null,
  linesAdded: 532,
  linesRemoved: 12,
  location: {
    projectAlias: "OS",
    projectName: "Contoso",
  },
  associatedTask: {
    refId: "OS-1397",
    name: "Allow conversation forks",
    taskType: {
      name: "Task",
      icon: "SquareCheckBig",
      color: "#3b82f6",
    },
  },
};

/** The board, excluding the always-rendered settings dropdown that repeats section titles. */
function board() {
  return within(screen.getByTestId("watch-tower-board"));
}

describe("WatchTowerPage", () => {
  beforeEach(() => {
    useWatchTowerSectionMock.mockImplementation(
      (_organizationSlug: string, section: string) => ({
        threads: section === "needs_review" ? [associatedThread] : [],
        status: "Exhausted",
        loadMore: vi.fn(),
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  test("links an associated task to its project task while the thread title still links to the thread", () => {
    render(<WatchTowerPage />);

    expect(
      screen.getByText("OS-1397").closest("a")?.getAttribute("href")
    ).toBe("/o/acme/OS?task=OS-1397");
    expect(
      screen
        .getByRole("link", {
          name: "Open thread Allow forking the conversation mid-thread",
        })
        .getAttribute("href")
    ).toBe("/o/acme/OS/threads/thread_1");
  });

  test("defaults to the list layout and switches to the board on demand", async () => {
    render(<WatchTowerPage />);

    // The list omits empty sections; the board renders every visible column.
    expect(screen.queryByTestId("watch-tower-board")).toBeNull();
    expect(screen.getByRole("heading", { name: "Needs your review" })).toBeDefined();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Board" }));

    expect(board().getByText("Running")).toBeDefined();
    expect(board().getByText("Failed")).toBeDefined();
    expect(board().getByText("Done")).toBeDefined();
    // The board drops the list's table chrome.
    expect(screen.queryByText("Changes")).toBeNull();
  });

  test("restores the persisted board layout on load", () => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", "board");

    render(<WatchTowerPage />);

    expect(
      screen.getByRole("menuitemradio", { name: "Board" }).getAttribute("aria-checked")
    ).toBe("true");
    expect(board().getByText("Running")).toBeDefined();
  });

  test("persists the chosen layout", () => {
    render(<WatchTowerPage />);

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Board" }));
    expect(window.localStorage.getItem("convoy.watch-tower.view-mode")).toBe("board");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "List" }));
    expect(window.localStorage.getItem("convoy.watch-tower.view-mode")).toBe("list");
  });

  test("hides a filtered-out section's board column", () => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", "board");
    window.localStorage.setItem(
      "convoy.watch-tower.hidden-sections",
      JSON.stringify(["done"])
    );

    render(<WatchTowerPage />);

    expect(board().getByText("Running")).toBeDefined();
    expect(board().queryByText("Done")).toBeNull();
  });

  test("swaps a board column header for bulk actions scoped to that column", () => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", "board");

    render(<WatchTowerPage />);

    fireEvent.click(
      screen.getByLabelText("Select Allow forking the conversation mid-thread")
    );

    // The owning column's title gives way to its selection actions.
    expect(board().queryByText("Needs your review")).toBeNull();
    expect(board().getByText("1 selected")).toBeDefined();
    expect(board().getByRole("button", { name: "Delete" })).toBeDefined();
    // Other columns keep their titles — selection is one column at a time.
    expect(board().getByText("Running")).toBeDefined();

    fireEvent.click(board().getByRole("button", { name: "Clear selection" }));
    expect(board().getByText("Needs your review")).toBeDefined();
  });

  test("offers no selection in the Running column", () => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", "board");
    useWatchTowerSectionMock.mockImplementation(
      (_organizationSlug: string, section: string) => ({
        threads: section === "running" ? [associatedThread] : [],
        status: "Exhausted",
        loadMore: vi.fn(),
      })
    );

    render(<WatchTowerPage />);

    expect(
      screen.queryByLabelText("Select Allow forking the conversation mid-thread")
    ).toBeNull();
  });

  test("paginates each board column on its own", () => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", "board");
    const loadMore = vi.fn();
    useWatchTowerSectionMock.mockImplementation(
      (_organizationSlug: string, section: string) => ({
        threads: section === "needs_review" ? [associatedThread] : [],
        status: section === "needs_review" ? "CanLoadMore" : "Exhausted",
        loadMore,
      })
    );

    render(<WatchTowerPage />);

    const showMore = screen.getAllByRole("button", { name: "Show more" });
    expect(showMore).toHaveLength(1);

    fireEvent.click(showMore[0]);
    expect(loadMore).toHaveBeenCalled();
  });

  test("never offers a create affordance on a board column", () => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", "board");

    render(<WatchTowerPage />);

    expect(
      screen.queryByRole("button", { name: /^Add task to/ })
    ).toBeNull();
  });

  test("reveals a board card's checkbox on hover, and every card's once one is selected", () => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", "board");
    useWatchTowerSectionMock.mockImplementation(
      (_organizationSlug: string, section: string) => ({
        threads:
          section === "needs_review"
            ? [associatedThread, { ...associatedThread, _id: "thread_2", title: "Second" }]
            : [],
        status: "Exhausted",
        loadMore: vi.fn(),
      })
    );

    render(<WatchTowerPage />);

    const slotOf = (label: string) =>
      screen.getByLabelText(label).parentElement as HTMLElement;

    // At rest the slot takes no space at all, so the title sits flush with the
    // card's leading edge; hovering reveals the box and pushes the title right.
    expect(slotOf("Select Allow forking the conversation mid-thread").className).toContain(
      "hidden"
    );
    expect(slotOf("Select Second").className).toContain("group-hover/card:flex");
    // Never merely transparent — that would reserve the gap we're avoiding.
    expect(slotOf("Select Second").className).not.toContain("invisible");

    fireEvent.click(screen.getByLabelText("Select Allow forking the conversation mid-thread"));

    // With a selection in the column, every card in it shows its checkbox.
    expect(slotOf("Select Allow forking the conversation mid-thread").className).not.toContain(
      "hidden"
    );
    expect(slotOf("Select Second").className).not.toContain("hidden");
  });

  test("lays a board card out as title + status over project/branch + runtime/time", () => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", "board");
    useWatchTowerSectionMock.mockImplementation(
      (_organizationSlug: string, section: string) => ({
        // `failed` + unacknowledged attention keeps the display status "failed".
        threads:
          section === "failed"
            ? [{ ...associatedThread, status: "failed", requiresAttention: true }]
            : [],
        status: "Exhausted",
        loadMore: vi.fn(),
      })
    );

    render(<WatchTowerPage />);

    const title = board().getByTitle("Allow forking the conversation mid-thread");
    const firstLine = title.parentElement?.parentElement as HTMLElement;
    // Status shares the title's line, right-aligned in the second grid column.
    expect(firstLine.className).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(within(firstLine).getByText("Failed")).toBeDefined();

    // Second line: project + branch left, runtime icon + time right.
    const secondLine = firstLine.nextElementSibling as HTMLElement;
    expect(secondLine.className).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(within(secondLine).getByText("Contoso")).toBeDefined();
    expect(within(secondLine).getByTitle("Branch: main")).toBeDefined();
  });

  test("gives the board a bordered header bar the list does not have", () => {
    const { container } = render(<WatchTowerPage />);
    const pageHeader = () =>
      container.querySelector("main > header") as HTMLElement | null;

    expect(pageHeader()).toBeNull();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Board" }));

    // The border doubles as the top edge of the column strip.
    const header = pageHeader();
    expect(header).not.toBeNull();
    expect(header?.className).toContain("border-b");
    // App-chrome scale, matching the project task views' header — not the
    // page-title scale the list mode uses.
    const heading = within(header as HTMLElement).getByRole("heading", {
      name: "Watch Tower",
    });
    expect(heading.className).toContain("text-sm");
    expect(
      within(header as HTMLElement).getByRole("button", { name: "View settings" })
    ).toBeDefined();
  });
});


describe("Watch Tower container identity", () => {
  beforeEach(() => {
    useWatchTowerSectionMock.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    useWatchTowerSectionMock.mockReset();
    window.localStorage.clear();
  });

  test.each(["list", "board"])("%s identifies a group and links its conversation", (layout) => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", layout);
    useWatchTowerSectionMock.mockImplementation((_org: string, section: string) => ({
      threads: section === "needs_review" ? [{
        ...associatedThread, _id: "group_1", title: "Release group", kind: "group", childCount: 3,
        linesAdded: undefined, linesRemoved: undefined,
      }] : [],
      status: "Exhausted", loadMore: vi.fn(),
    }));
    render(<WatchTowerPage />);
    expect(screen.getByText("3 threads")).toBeDefined();
    expect(screen.getByLabelText("Thread group")).toBeDefined();
    expect(screen.getByRole("link", { name: "Open thread Release group" }).getAttribute("href"))
      .toBe("/o/acme/OS/threads/group_1");
  });

  test.each([
    { status: "completed", section: "needs_review" },
    { status: "streaming", section: "running" },
    { status: "waiting_input", section: "waiting_input" },
    { status: "failed", section: "failed" },
  ])("list unread state is independent of $status for both standalone and group rows", ({ status, section }) => {
    let hasUnread = true;
    useWatchTowerSectionMock.mockImplementation((_org: string, currentSection: string) => ({
      threads: currentSection === section ? [
        { ...associatedThread, _id: "standalone", status, hasUnread },
        { ...associatedThread, _id: "group", kind: "group", childCount: 2, status, hasUnread },
      ] : [],
      status: "Exhausted", loadMore: vi.fn(),
    }));
    const view = render(<WatchTowerPage />);
    expect(screen.getAllByTitle("Unread")).toHaveLength(2);
    hasUnread = false;
    view.rerender(<WatchTowerPage />);
    expect(screen.queryByTitle("Unread")).toBeNull();
  });

  test.each(["list", "board"])("%s passive workflow icon lets clicks reach the conversation link", (layout) => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", layout);
    useWatchTowerSectionMock.mockImplementation((_org: string, section: string) => ({
      threads: section === "running" ? [{
        ...associatedThread, _id: "workflow_group", kind: "group", workflowRunId: "run_1",
        status: "streaming", title: "Release workflow", childCount: 2,
      }] : [],
      status: "Exhausted", loadMore: vi.fn(),
    }));
    render(<WatchTowerPage />);
    const icon = screen.getByRole("img", { name: "Workflow run" });
    // The passive glyph sits above the full-row link, so it must not receive pointer events.
    expect(icon.classList.contains("pointer-events-none")).toBe(true);
    expect(screen.getByRole("link", { name: "Open thread Release workflow" }).getAttribute("href"))
      .toBe("/o/acme/OS/threads/workflow_group");
  });
});

describe("Watch Tower team scope", () => {
  beforeEach(() => { routeProject = "OS"; });
  afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear(); routeOrganization = "acme"; routeProject = undefined; });

  test.each(["list", "board"])("%s shows teammate summaries without navigation or selection", (layout) => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", layout);
    useWatchTowerSectionMock.mockImplementation((_org: string, section: string) => ({
      threads: section === "needs_review" ? [
        { ...associatedThread, isOwner: true },
        { _id: "foreign", title: "Teammate work", isOwner: false, ownerName: "Ada", cliType: "codex", status: "completed", hasUnread: false, lastActivityAt: Date.now(), location: associatedThread.location },
      ] : [],
      status: "Exhausted", loadMore: vi.fn(),
    }));
    render(<WatchTowerPage />);
    expect(screen.getByText("Ada")).toBeDefined();
    if (layout === "board") {
      const card = screen.getByText("Teammate work").closest(".group\\/card");
      expect(card).not.toBeNull();
      expect(card?.classList.contains("hover:border-muted-foreground/35")).toBe(false);
    }
    expect(screen.queryByRole("link", { name: "Open thread Teammate work" })).toBeNull();
    expect(screen.queryByLabelText("Select Teammate work")).toBeNull();
    expect(screen.getByRole("link", { name: `Open thread ${associatedThread.title}` })).toBeDefined();
    fireEvent.click(screen.getByLabelText(`Select ${associatedThread.title}`));
    expect(screen.queryByLabelText("Select Teammate work")).toBeNull();
  });

  test("scope toggle persists, resets selection, and requests the team feed", () => {
    useWatchTowerSectionMock.mockImplementation((_org: string, section: string) => ({
      threads: section === "needs_review" ? [{ ...associatedThread, isOwner: true }] : [],
      status: "Exhausted", loadMore: vi.fn(),
    }));
    render(<WatchTowerPage />);
    fireEvent.click(screen.getByLabelText(`Select ${associatedThread.title}`));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Only mine" }));
    expect(screen.queryByText("1 selected")).toBeNull();
    expect(window.localStorage.getItem("convoy.watch-tower.project-scope.acme/OS")).toBe("mine");
    expect(useWatchTowerSectionMock).toHaveBeenCalledWith("acme", "needs_review", { projectAlias: "OS", scope: "mine" });
    expect(screen.getByRole("heading", { name: "Needs your review" })).toBeDefined();
  });

  test.each(["list", "board"])("%s shift selection skips teammate rows", (layout) => {
    window.localStorage.setItem("convoy.watch-tower.view-mode", layout);
    useWatchTowerSectionMock.mockImplementation((_org: string, section: string) => ({
      threads: section === "needs_review" ? [
        { ...associatedThread, _id: "first", title: "First" },
        { ...associatedThread, _id: "foreign", title: "Foreign", isOwner: false, ownerName: "Ada" },
        { ...associatedThread, _id: "last", title: "Last" },
      ] : [], status: "Exhausted", loadMore: vi.fn(),
    }));
    render(<WatchTowerPage />);
    fireEvent.click(screen.getByLabelText("Select First"));
    fireEvent.click(screen.getByLabelText("Select Last"), { shiftKey: true });
    expect(screen.getByText("2 selected")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: layout === "list" ? "Mark as done" : "Done" }));
    expect(batchMutationMock).toHaveBeenCalledWith({ threadIds: ["first", "last"] });
  });

  test.each(["organization", "project"])("changing %s dismisses a pending deletion", (target) => {
    useWatchTowerSectionMock.mockImplementation((_org: string, section: string) => ({
      threads: section === "needs_review" ? [associatedThread] : [], status: "Exhausted", loadMore: vi.fn(),
    }));
    const view = render(<WatchTowerPage />);
    fireEvent.click(screen.getByLabelText(`Select ${associatedThread.title}`));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeDefined();
    if (target === "organization") routeOrganization = "another-org";
    else routeProject = "OTHER";
    view.rerender(<WatchTowerPage />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText("1 selected")).toBeNull();
    expect(batchMutationMock).not.toHaveBeenCalled();
  });

});

describe("Watch Tower locations", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear(); routeProject = undefined; });
  beforeEach(() => {
    useWatchTowerSectionMock.mockReturnValue({ threads: [], status: "Exhausted", loadMore: vi.fn() });
  });
  test("personal tower ignores old all preference and has no ownership toggle", () => {
    window.localStorage.setItem("convoy.watch-tower.scope", "all");
    render(<WatchTowerPage />);
    expect(screen.queryByRole("menuitemradio", { name: "All threads" })).toBeNull();
    expect(useWatchTowerSectionMock).toHaveBeenCalledWith("acme", "running", undefined);
  });
  test("project tower defaults to all and keeps preferences separate by project", () => {
    // An unfiltered empty tower hides its settings, so give it a row.
    useWatchTowerSectionMock.mockReturnValue({ threads: [associatedThread], status: "Exhausted", loadMore: vi.fn() });
    routeProject = "OS";
    const view = render(<WatchTowerPage />);
    expect(screen.getByRole("menuitemradio", { name: "All threads" }).getAttribute("aria-checked")).toBe("true");
    expect(useWatchTowerSectionMock).toHaveBeenCalledWith("acme", "running", { projectAlias: "OS", scope: "all" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Only mine" }));
    routeProject = "OTHER";
    view.rerender(<WatchTowerPage />);
    expect(screen.getByRole("menuitemradio", { name: "All threads" }).getAttribute("aria-checked")).toBe("true");
    routeProject = "OS";
    view.rerender(<WatchTowerPage />);
    expect(screen.getByRole("menuitemradio", { name: "Only mine" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("Watch Tower empty state", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear(); routeProject = undefined; });
  beforeEach(() => {
    useWatchTowerSectionMock.mockReturnValue({ threads: [], status: "Exhausted", loadMore: vi.fn() });
  });

  test("hides the view settings and links to a new thread in the project", () => {
    routeProject = "OS";
    render(<WatchTowerPage />);

    expect(screen.getByText("Nothing to watch yet")).toBeDefined();
    expect(screen.queryByRole("button", { name: "View settings" })).toBeNull();
    expect(screen.getByRole("link", { name: "Start a thread" }).getAttribute("href")).toBe("/o/acme/OS/threads");
  });

  // The list view's wrappers are a flex-column chain, so Centered fills the page height.
  test("centers the empty state vertically in the list view", () => {
    routeProject = "OS";
    render(<WatchTowerPage />);

    let node = screen.getByTestId("watch-tower-empty");
    expect(node.className.split(" ")).toContain("flex-1");
    while (node.parentElement && node.tagName !== "MAIN") {
      node = node.parentElement;
      const classes = node.className.split(" ");
      expect(classes).toContain("flex");
      expect(classes).toContain("flex-col");
      if (node.tagName !== "MAIN") expect(classes).toContain("flex-1");
    }
    expect(node.tagName).toBe("MAIN");
  });

  test("links the personal tower to the last visited project's threads", () => {
    window.localStorage.setItem("convoy.last-project:acme", "WEB");
    render(<WatchTowerPage />);

    expect(screen.queryByRole("button", { name: "View settings" })).toBeNull();
    expect(screen.getByRole("link", { name: "Start a thread" }).getAttribute("href")).toBe("/o/acme/WEB/threads");
  });

  test("keeps the view settings when a filter may be hiding threads", () => {
    window.localStorage.setItem("convoy.watch-tower.hidden-sections", JSON.stringify(["done"]));
    render(<WatchTowerPage />);

    expect(screen.getByText("Nothing to watch yet")).toBeDefined();
    expect(screen.getByRole("button", { name: "View settings" })).toBeDefined();
  });

  test("keeps the view settings on an empty project tower scoped to my threads", () => {
    routeProject = "OS";
    window.localStorage.setItem("convoy.watch-tower.project-scope.acme/OS", "mine");
    render(<WatchTowerPage />);

    expect(screen.getByRole("button", { name: "View settings" })).toBeDefined();
  });
});

describe("Watch Tower loading", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear(); });

  test.each(["LoadingFirstPage", "CanLoadMore"])(
    "keeps the header and toolbar and skeletons only the list while sections are %s",
    (status) => {
      useWatchTowerSectionMock.mockReturnValue({ threads: [], status, loadMore: vi.fn() });
      render(<WatchTowerPage />);

      expect(screen.getByRole("heading", { level: 1, name: "Watch Tower" })).toBeDefined();
      expect(screen.getByRole("button", { name: "View settings" })).toBeDefined();
      expect(screen.getByLabelText("Loading threads").querySelector('[data-slot="skeleton"]')).not.toBeNull();
      expect(screen.queryByText("Loading")).toBeNull();
    }
  );
});
