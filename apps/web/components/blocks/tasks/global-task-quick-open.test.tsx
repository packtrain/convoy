/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { cloneElement, forwardRef, isValidElement, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { href } from "@/lib/navigation";
import { GlobalTaskQuickOpen } from "./global-task-quick-open";

const useQueryMock = vi.hoisted(() => vi.fn());
const usePaginatedQueryMock = vi.hoisted(() => vi.fn());
const navigationPushMock = vi.hoisted(() => vi.fn());
const hotkeyRegistration = vi.hoisted(
  () =>
    ({ current: null }) as {
      current: null | {
        hotkey: string;
        callback: (event: KeyboardEvent) => void;
        options: { ignoreInputs?: boolean };
      };
    }
);

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  usePaginatedQuery: usePaginatedQueryMock,
}));

vi.mock("@/lib/browser/use-dynamic-target-hotkey", () => ({
  useDynamicTargetHotkey: (hotkey: string, callback: (event: KeyboardEvent) => void, options: { ignoreInputs?: boolean }) => {
    hotkeyRegistration.current = { hotkey, callback, options };
  },
}));

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/navigation")>();

  return {
    ...actual,
    AppLink: ({
      children,
      href: linkHref,
      onClick,
      ...props
    }: {
      children: ReactNode;
      href: string | ReturnType<typeof actual.routeTarget>;
      onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
    }) => (
      <a
        href={typeof linkHref === "string" ? linkHref : actual.href(linkHref)}
        onClick={(event) => {
          onClick?.(event);
          event.preventDefault();
        }}
        {...props}
      >
        {children}
      </a>
    ),
    useNavigation: () => ({
      location: { pathname: "/o/acme/OS", search: "", hash: "" },
      push: navigationPushMock,
      replace: vi.fn(),
    }),
  };
});

vi.mock("@/hooks/react/use-debounce", () => ({
  useDebounce: (value: string) => value,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid="quick-open-dialog">{children}</div> : null,
  DialogContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="quick-open-content" className={className}>
      {children}
    </div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/command", async () => {
  type AnchorElementProps = {
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  };

  function isAnchorElement(child: ReactNode): child is ReactElement<AnchorElementProps> {
    return isValidElement<AnchorElementProps>(child);
  }

  const CommandInput = forwardRef<
    HTMLInputElement,
    {
      value?: string;
      onValueChange?: (value: string) => void;
      placeholder?: string;
      showClearButton?: boolean;
      onClear?: () => void;
    }
  >(function CommandInput({ value, onValueChange, placeholder, showClearButton, onClear }, ref) {
    return (
      <div>
        <input ref={ref} value={value ?? ""} onChange={(event) => onValueChange?.(event.target.value)} placeholder={placeholder} />
        {showClearButton && (
          <button type="button" aria-label="Clear search" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    );
  });

  return {
    Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CommandInput,
    CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CommandItem: ({
      children,
      onSelect,
      value,
      asChild,
    }: {
      children: ReactNode;
      onSelect?: (value: string) => void;
      value?: string;
      asChild?: boolean;
    }) =>
      asChild && isAnchorElement(children) ? (
        cloneElement(children, {
          onClick: (event) => {
            children.props.onClick?.(event);
            onSelect?.(value ?? "");
          },
        })
      ) : (
        <button type="button" onClick={() => onSelect?.(value ?? "")}>
          {children}
        </button>
      ),
  };
});

const tabsController = vi.hoisted(
  () =>
    ({ onValueChange: undefined }) as {
      onValueChange?: (value: string) => void;
    }
);

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => {
    tabsController.onValueChange = onValueChange;
    return <div>{children}</div>;
  },
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: { children: ReactNode; value: string }) => (
    <button type="button" onClick={() => tabsController.onValueChange?.(value)}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/blocks/tasks/task-ref-with-type", () => ({
  TaskRefWithType: ({ refId }: { refId: string }) => <span data-testid="task-ref-with-type">{refId}</span>,
}));

vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function makeProject(alias = "OS") {
  return {
    _id: `project_${alias}` as Id<"projects">,
    _creationTime: 1,
    organizationId: "org_1" as Id<"organizations">,
    name: `${alias} Project`,
    alias,
    createdAt: 1,
    updatedAt: 1,
    isDeleted: false,
  };
}

function makeTask(
  overrides: Partial<{
    _id: Id<"tasks">;
    refId: string;
    name: string;
    isArchived: boolean;
    listRef: string;
  }> = {}
) {
  return {
    _id: overrides._id ?? (`task_${overrides.refId ?? "1"}` as Id<"tasks">),
    parentId: null,
    refId: overrides.refId ?? "OS-101",
    name: overrides.name ?? "Quick open task",
    taskType: {
      key: "task",
      name: "Task",
      icon: "SquareCheckBig",
      color: "#64748b",
      isSystem: true as const,
    },
    status: "To Do" as const,
    priority: "None" as const,
    createdByName: "Tester",
    isArchived: overrides.isArchived ?? false,
    list: overrides.listRef
      ? {
          type: "list" as const,
          id: "list_1",
          ref: overrides.listRef,
          name: "Task List",
          isArchived: false,
        }
      : null,
  };
}

function mockProject(project = makeProject()) {
  useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
    if (args === "skip") {
      return undefined;
    }
    return project;
  });
}

function mockTaskResults({
  seeded = [makeTask({ refId: "OS-201", name: "Recent task" })],
  activeSearch = [makeTask({ refId: "OS-301", name: "Active search task" })],
  archivedSearch = [
    makeTask({
      refId: "OS-401",
      name: "Archived search task",
      isArchived: true,
      listRef: "OLD-LIST",
    }),
  ],
}: {
  seeded?: unknown[];
  activeSearch?: unknown[];
  archivedSearch?: unknown[];
} = {}) {
  usePaginatedQueryMock.mockImplementation((_query: unknown, args: unknown) => {
    if (args === "skip") {
      return {
        results: undefined,
        status: "Exhausted",
        loadMore: vi.fn(),
      };
    }

    if (typeof args === "object" && args && "query" in args) {
      return {
        results: "archiveMode" in args && args.archiveMode === "archived" ? archivedSearch : activeSearch,
        status: "Exhausted",
        loadMore: vi.fn(),
      };
    }

    return {
      results: seeded,
      status: "Exhausted",
      loadMore: vi.fn(),
    };
  });
}

function renderQuickOpen({
  projectAlias = "OS",
}: {
  projectAlias?: string | null;
} = {}) {
  render(<GlobalTaskQuickOpen organizationId={"org_1" as Id<"organizations">} organizationSlug="acme" projectAlias={projectAlias} />);
}

function triggerHotkey() {
  const preventDefault = vi.fn();
  act(() => {
    hotkeyRegistration.current?.callback({
      preventDefault,
    } as unknown as KeyboardEvent);
  });
  return { preventDefault };
}

describe("GlobalTaskQuickOpen", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    useQueryMock.mockReset();
    usePaginatedQueryMock.mockReset();
    navigationPushMock.mockReset();
    hotkeyRegistration.current = null;
    tabsController.onValueChange = undefined;
  });

  test("registers Mod+K with input guarding and opens seeded recent tasks", () => {
    mockProject();
    mockTaskResults();

    renderQuickOpen();

    expect(hotkeyRegistration.current?.hotkey).toBe("Mod+K");
    expect(hotkeyRegistration.current?.options.ignoreInputs).toBe(true);

    const { preventDefault } = triggerHotkey();

    expect(preventDefault).toHaveBeenCalled();
    expect(screen.getByTestId("quick-open-dialog")).toBeDefined();
    expect(screen.getByTestId("quick-open-content").className).toContain("h-[32rem]");
    expect(screen.getByText("Recent task")).toBeDefined();
    expect(usePaginatedQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "project_OS" }),
      expect.objectContaining({ initialNumItems: 50 })
    );
  });

  test("shows an ellipsis on the load-more row while the next page loads", () => {
    mockProject();
    mockTaskResults();
    const fallback = usePaginatedQueryMock.getMockImplementation();
    usePaginatedQueryMock.mockImplementation((query: unknown, args: unknown) => {
      const result = fallback?.(query, args);
      return args === "skip" ? result : { ...result, status: "LoadingMore" };
    });

    renderQuickOpen();
    triggerHotkey();

    expect(screen.getByText("Loading…")).toBeDefined();
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  test("holds no seeded subscription while the dialog is closed", () => {
    mockProject();
    mockTaskResults();

    renderQuickOpen();

    expect(usePaginatedQueryMock).toHaveBeenCalled();
    for (const [, args] of usePaginatedQueryMock.mock.calls) {
      expect(args).toBe("skip");
    }
  });

  test("searches active tasks by default", () => {
    mockProject();
    mockTaskResults();

    renderQuickOpen();
    triggerHotkey();
    fireEvent.change(screen.getByPlaceholderText("Find task in OS..."), {
      target: { value: "active" },
    });

    expect(screen.getByText("Active search task")).toBeDefined();
    expect(usePaginatedQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: "active",
        archiveMode: "active",
      }),
      expect.anything()
    );
  });

  test("supports archived search and archived result links", () => {
    mockProject();
    mockTaskResults();

    renderQuickOpen();
    triggerHotkey();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.change(screen.getByPlaceholderText("Find task in OS..."), {
      target: { value: "archived" },
    });

    const archivedLink = screen.getByRole("link", {
      name: /Archived search task/i,
    });

    expect(archivedLink.getAttribute("href")).toBe("/o/acme/OS?task=OS-401&archived=true");
    expect(usePaginatedQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: "archived",
        archiveMode: "archived",
      }),
      expect.anything()
    );
  });

  test("plain selection navigates to the task's owning List", () => {
    mockProject();
    mockTaskResults({
      seeded: [
        makeTask({
          refId: "OS-501",
          name: "Selected task",
          listRef: "SPRINT-2",
        }),
      ],
    });

    renderQuickOpen();
    triggerHotkey();
    fireEvent.click(screen.getByRole("link", { name: /Selected task/i }));

    expect(navigationPushMock).toHaveBeenCalledTimes(1);
    expect(href(navigationPushMock.mock.calls[0][0])).toBe(
      "/o/acme/OS?task=OS-501&list=SPRINT-2"
    );
    expect(screen.queryByTestId("quick-open-dialog")).toBeNull();
  });

  test("modified clicks preserve native link behavior without navigating in place", () => {
    mockProject();
    mockTaskResults({
      seeded: [makeTask({ refId: "OS-601", name: "New tab task" })],
    });

    renderQuickOpen();
    triggerHotkey();
    fireEvent.click(screen.getByRole("link", { name: /New tab task/i }), {
      metaKey: true,
    });

    expect(navigationPushMock).not.toHaveBeenCalled();
    expect(screen.getByText("New tab task")).toBeDefined();
  });

  test("clear search resets the query and keeps the dialog open", () => {
    mockProject();
    mockTaskResults();

    renderQuickOpen();
    triggerHotkey();
    const input = screen.getByPlaceholderText("Find task in OS...");

    fireEvent.change(input, { target: { value: "active" } });
    expect(screen.getByText("Active search task")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("quick-open-dialog")).toBeDefined();
    expect(screen.getByText("Recent task")).toBeDefined();
  });

  test("falls back to the last-used project on org-only routes", async () => {
    window.localStorage.setItem("convoy.last-project:acme", "LAST");
    mockProject(makeProject("LAST"));
    mockTaskResults({
      seeded: [makeTask({ refId: "LAST-1", name: "Last project task" })],
    });

    renderQuickOpen({ projectAlias: null });

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ alias: "LAST" }));
    });

    triggerHotkey();

    expect(screen.getByPlaceholderText("Find task in LAST...")).toBeDefined();
    expect(screen.getByRole("link", { name: /Last project task/i }).getAttribute("href")).toBe("/o/acme/LAST?task=LAST-1");
  });

  test("does not open or prevent default when no project can be resolved", () => {
    useQueryMock.mockReturnValue(null);
    mockTaskResults({ seeded: [] });

    renderQuickOpen({ projectAlias: null });
    const { preventDefault } = triggerHotkey();

    expect(preventDefault).not.toHaveBeenCalled();
    expect(screen.queryByTestId("quick-open-dialog")).toBeNull();
  });
});
