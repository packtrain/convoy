/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { cloneElement, isValidElement, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadTaskSelectorDialog } from "./thread-task-selector-dialog";

const usePaginatedQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  usePaginatedQuery: usePaginatedQueryMock,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    ...props
  }: {
    children: ReactNode;
    href: string;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/react/use-debounce", () => ({
  useDebounce: (value: string) => value,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="thread-task-selector-dialog" className={className}>
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

  return {
    Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CommandInput: ({
      value,
      onValueChange,
      placeholder,
      showClearButton,
      onClear,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      placeholder?: string;
      showClearButton?: boolean;
      onClear?: () => void;
    }) => (
      <div>
        <input value={value ?? ""} onChange={(event) => onValueChange?.(event.target.value)} placeholder={placeholder} />
        {showClearButton && (
          <button type="button" aria-label="Clear search" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    ),
    CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CommandItem: ({
      children,
      onSelect,
      value,
      title,
      asChild,
    }: {
      children: ReactNode;
      onSelect?: (value: string) => void;
      value?: string;
      title?: string;
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
        <button type="button" title={title} onClick={() => onSelect?.(value ?? "")}>
          {children}
        </button>
      ),
  };
});

vi.mock("@/components/blocks/tasks/task-ref-with-type", () => ({
  TaskRefWithType: ({ refId }: { refId: string }) => <span data-testid="task-ref-with-type">{refId}</span>,
}));

vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children }: { children: ReactNode; content: string }) => <>{children}</>,
}));

function makeTask(
  overrides: Partial<{
    _id: Id<"tasks">;
    refId: string;
    name: string;
    status: "Backlog" | "To Do" | "In Progress" | "Done";
    isArchived: boolean;
  }> = {}
) {
  return {
    _id: ("task_" + (overrides.refId ?? "1")) as Id<"tasks">,
    parentId: null,
    refId: overrides.refId ?? "OS-101",
    name: overrides.name ?? "Selector task",
    taskType: {
      key: "task",
      name: "Task",
      icon: "SquareCheckBig",
      color: "#64748b",
      isSystem: true as const,
    },
    status: overrides.status ?? "To Do",
    priority: "None" as const,
    createdByName: "Tester",
    isArchived: overrides.isArchived ?? false,
  };
}

function renderDialog() {
  const onSelectTask = vi.fn();

  function Harness() {
    const [open, setOpen] = useState(true);

    return (
      <ThreadTaskSelectorDialog
        projectId={"project_1" as Id<"projects">}
        open={open}
        onOpenChange={setOpen}
        onSelectTask={onSelectTask}
        getTaskHref={(task) => `/o/acme/OS/threads?task=${task.refId}`}
      />
    );
  }

  render(<Harness />);
  return { onSelectTask };
}

describe("ThreadTaskSelectorDialog", () => {
  afterEach(() => {
    cleanup();
    usePaginatedQueryMock.mockReset();
  });

  test("shows seeded recent tasks before any query", () => {
    usePaginatedQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (args === "skip") {
        return {
          results: undefined,
          status: "Exhausted",
          loadMore: vi.fn(),
        };
      }

      return {
        results: [makeTask({ refId: "OS-201", name: "Board task" })],
        status: "Exhausted",
        loadMore: vi.fn(),
      };
    });

    renderDialog();

    expect(screen.getByText("Board task")).toBeDefined();
    expect(screen.queryByText("No recent tasks available")).toBeNull();
  });

  test("holds no seeded subscription while closed", () => {
    usePaginatedQueryMock.mockReturnValue({
      results: undefined,
      status: "Exhausted",
      loadMore: vi.fn(),
    });

    render(
      <ThreadTaskSelectorDialog
        projectId={"project_1" as Id<"projects">}
        open={false}
        onOpenChange={vi.fn()}
        onSelectTask={vi.fn()}
        getTaskHref={(task) => `/o/acme/OS/threads?task=${task.refId}`}
      />
    );

    expect(usePaginatedQueryMock).toHaveBeenCalled();
    for (const [, args] of usePaginatedQueryMock.mock.calls) {
      expect(args).toBe("skip");
    }
  });

  test("renders the wider selector shell", () => {
    usePaginatedQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (args === "skip") {
        return {
          results: undefined,
          status: "Exhausted",
          loadMore: vi.fn(),
        };
      }

      return {
        results: [],
        status: "Exhausted",
        loadMore: vi.fn(),
      };
    });

    renderDialog();

    expect(screen.getByTestId("thread-task-selector-dialog").className).toContain("sm:max-w-xl");
    expect(screen.getByTestId("thread-task-selector-dialog").className).toContain("h-[32rem]");
  });

  test("switches to live search results when typing a query", () => {
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
          results: [makeTask({ refId: "OS-301", name: "Auth task" })],
          status: "Exhausted",
          loadMore: vi.fn(),
        };
      }

      return {
        results: [makeTask({ refId: "OS-201", name: "Board task" })],
        status: "Exhausted",
        loadMore: vi.fn(),
      };
    });

    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Search tasks..."), {
      target: { value: "auth" },
    });

    expect(screen.getByText("Auth task")).toBeDefined();
    expect(screen.queryByText("Board task")).toBeNull();
  });

  test("clears a query and returns to seeded recent tasks", () => {
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
          results: [makeTask({ refId: "OS-301", name: "Auth task" })],
          status: "Exhausted",
          loadMore: vi.fn(),
        };
      }

      return {
        results: [makeTask({ refId: "OS-201", name: "Board task" })],
        status: "Exhausted",
        loadMore: vi.fn(),
      };
    });

    renderDialog();

    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    const input = screen.getByPlaceholderText("Search tasks...");
    fireEvent.change(input, {
      target: { value: "auth" },
    });

    expect(screen.getByRole("button", { name: "Clear search" })).toBeDefined();
    expect(screen.getByText("Auth task")).toBeDefined();
    expect(screen.queryByText("Board task")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(screen.getByText("Board task")).toBeDefined();
    expect(screen.queryByText("Auth task")).toBeNull();
  });

  test("loads more seeded and searched results from the active source", () => {
    const loadMoreSeededResults = vi.fn();
    const loadMoreSearchResults = vi.fn();

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
          results: [makeTask({ refId: "OS-401", name: "Search result" })],
          status: "CanLoadMore",
          loadMore: loadMoreSearchResults,
        };
      }

      return {
        results: [makeTask({ refId: "OS-400", name: "Seed result" })],
        status: "CanLoadMore",
        loadMore: loadMoreSeededResults,
      };
    });

    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(loadMoreSeededResults).toHaveBeenCalledWith(100);

    fireEvent.change(screen.getByPlaceholderText("Search tasks..."), {
      target: { value: "search" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(loadMoreSearchResults).toHaveBeenCalledWith(100);
  });

  test("selects a task and closes the dialog", () => {
    usePaginatedQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (args === "skip") {
        return {
          results: undefined,
          status: "Exhausted",
          loadMore: vi.fn(),
        };
      }

      return {
        results: [makeTask({ refId: "OS-501", name: "Selected task" })],
        status: "Exhausted",
        loadMore: vi.fn(),
      };
    });

    const { onSelectTask } = renderDialog();
    fireEvent.click(screen.getByText("Selected task"));

    expect(onSelectTask).toHaveBeenCalledWith(
      expect.objectContaining({
        refId: "OS-501",
        name: "Selected task",
      })
    );
    expect(screen.queryByText("Selected task")).toBeNull();
  });

  test("renders task results as links with task deep-link hrefs", () => {
    usePaginatedQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (args === "skip") {
        return {
          results: undefined,
          status: "Exhausted",
          loadMore: vi.fn(),
        };
      }

      return {
        results: [makeTask({ refId: "OS-901", name: "Linked task" })],
        status: "Exhausted",
        loadMore: vi.fn(),
      };
    });

    renderDialog();

    const taskLink = screen.getByRole("link", { name: /Linked task/i });

    expect(taskLink.getAttribute("href")).toBe("/o/acme/OS/threads?task=OS-901");
  });

  test("modified clicks use native link behavior without selecting in place", () => {
    usePaginatedQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (args === "skip") {
        return {
          results: undefined,
          status: "Exhausted",
          loadMore: vi.fn(),
        };
      }

      return {
        results: [makeTask({ refId: "OS-902", name: "New tab task" })],
        status: "Exhausted",
        loadMore: vi.fn(),
      };
    });

    const { onSelectTask } = renderDialog();
    fireEvent.click(screen.getByRole("link", { name: /New tab task/i }), {
      metaKey: true,
    });

    expect(onSelectTask).not.toHaveBeenCalled();
    expect(screen.getByText("New tab task")).toBeDefined();
  });
});
