/**
 * @vitest-environment jsdom
 */
import type { MouseEvent, ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TaskSearchDropdown } from "./task-search-dropdown";

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

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverAnchor: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, value, onClick }: { children: ReactNode; value: string; onClick?: () => void }) => (
    <button type="button" data-value={value} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/blocks/tasks/task-ref-with-type", () => ({
  TaskRefWithType: ({ refId }: { refId: string }) => <span data-testid="task-ref-with-type">{refId}</span>,
}));

vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children, content }: { children: ReactNode; content: string }) => <span data-tooltip-content={content}>{children}</span>,
}));

function mockSearchResults(
  results: unknown[],
  {
    status = "Exhausted",
    loadMore = vi.fn(),
  }: {
    status?: "Exhausted" | "CanLoadMore" | "LoadingMore" | "LoadingFirstPage";
    loadMore?: ReturnType<typeof vi.fn>;
  } = {}
) {
  usePaginatedQueryMock.mockImplementation((_query: unknown, args: unknown) => {
    if (args === "skip") {
      return {
        results: undefined,
        status: "Exhausted",
        loadMore: vi.fn(),
      };
    }

    return {
      results,
      status,
      loadMore,
    };
  });
}

describe("TaskSearchDropdown", () => {
  afterEach(() => {
    cleanup();
    usePaginatedQueryMock.mockReset();
  });

  test("renders the task type icon in search results instead of the middle dot separator", () => {
    mockSearchResults([
      {
        _id: "task_1",
        parentId: null,
        refId: "OS-420",
        name: "Task types",
        taskType: {
          key: "bug",
          name: "Bug",
          icon: "Bug",
          color: "#ef4444",
          isSystem: true,
        },
        status: "To Do",
        priority: "High",
        createdByName: "Tester",
        isArchived: false,
      },
    ]);

    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={vi.fn()}
        getTaskHref={(taskRefId) => `/o/acme/OS?task=${taskRefId}`}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "task" },
    });

    expect(screen.getByText("OS-420")).toBeTruthy();
    expect(screen.getByText("Task types")).toBeTruthy();
    expect(screen.queryByText("·")).toBeNull();
  });

  test("requests a larger first page for toolbar search results", () => {
    mockSearchResults([
      {
        _id: "task_1",
        parentId: null,
        refId: "OS-421",
        name: "Large first page",
        taskType: {
          key: "task",
          name: "Task",
          icon: "SquareCheckBig",
          color: "#64748b",
          isSystem: true,
        },
        status: "To Do",
        priority: "None",
        createdByName: "Tester",
        isArchived: false,
      },
    ]);

    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={vi.fn()}
        getTaskHref={(taskRefId) => `/o/acme/OS?task=${taskRefId}`}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "large" },
    });

    expect(usePaginatedQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "project_1",
        query: "large",
        archiveMode: "active",
      }),
      expect.objectContaining({ initialNumItems: 50 })
    );
  });

  test("renders load more as the final scrollable result item", () => {
    const loadMore = vi.fn();
    mockSearchResults(
      [
        {
          _id: "task_1",
          parentId: null,
          refId: "OS-422",
          name: "Paged result",
          taskType: {
            key: "task",
            name: "Task",
            icon: "SquareCheckBig",
            color: "#64748b",
            isSystem: true,
          },
          status: "To Do",
          priority: "None",
          createdByName: "Tester",
          isArchived: false,
        },
      ],
      { status: "CanLoadMore", loadMore }
    );

    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={vi.fn()}
        getTaskHref={(taskRefId) => `/o/acme/OS?task=${taskRefId}`}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "paged" },
    });

    const listbox = screen.getByRole("listbox");
    const loadMoreButton = screen.getByRole("button", { name: "Load more" });

    expect(listbox.lastElementChild).toBe(loadMoreButton);

    fireEvent.click(loadMoreButton);

    expect(loadMore).toHaveBeenCalledWith(100);
  });

  test("wraps the task ref and title in a vertically centered flex row", () => {
    mockSearchResults([
      {
        _id: "task_1",
        parentId: null,
        refId: "OS-420",
        name: "Task types",
        taskType: {
          key: "bug",
          name: "Bug",
          icon: "Bug",
          color: "#ef4444",
          isSystem: true,
        },
        status: "To Do",
        priority: "High",
        createdByName: "Tester",
        isArchived: false,
      },
    ]);

    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={vi.fn()}
        getTaskHref={(taskRefId) => `/o/acme/OS?task=${taskRefId}`}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "task" },
    });

    const refNode = screen.getByTestId("task-ref-with-type");
    const refAndTitleRow = refNode.parentElement;

    expect(refAndTitleRow?.className).toContain("flex");
    expect(refAndTitleRow?.className).toContain("items-center");
  });

  test("renders compact status metadata with tooltips for status and priority", () => {
    mockSearchResults([
      {
        _id: "task_1",
        parentId: null,
        refId: "OS-586",
        name: "Compact status metadata",
        taskType: {
          key: "task",
          name: "Task",
          icon: "SquareCheckBig",
          color: "#64748b",
          isSystem: true,
        },
        status: "In Progress",
        priority: "None",
        createdByName: "Tester",
        isArchived: false,
      },
    ]);

    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={vi.fn()}
        getTaskHref={(taskRefId) => `/o/acme/OS?task=${taskRefId}`}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "compact" },
    });

    expect(screen.queryByText("In Progress")).toBeNull();
    expect(document.querySelector('[data-tooltip-content="In Progress"]')).toBeTruthy();
    expect(document.querySelector('[data-tooltip-content="No priority"]')).toBeTruthy();
    expect(
      screen.getByText("Status: In Progress. Priority: No priority.", {
        selector: ".sr-only",
      })
    ).toBeTruthy();
  });

  test("renders task results as links with task deep-link hrefs", () => {
    mockSearchResults([
      {
        _id: "task_1",
        parentId: null,
        refId: "OS-805",
        name: "Linkable search result",
        taskType: {
          key: "task",
          name: "Task",
          icon: "SquareCheckBig",
          color: "#64748b",
          isSystem: true,
        },
        status: "To Do",
        priority: "Medium",
        createdByName: "Tester",
        isArchived: false,
        list: {
          type: "list",
          id: "list_1",
          ref: "SPRINT-2",
          name: "Sprint 2",
          isArchived: false,
        },
      },
    ]);

    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={vi.fn()}
        getTaskHref={(taskRefId, archiveFilter, listRef) =>
          archiveFilter === "archived"
            ? `/o/acme/OS?task=${taskRefId}&archived=true`
            : `/o/acme/OS?task=${taskRefId}&list=${listRef}`
        }
      />
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "link" },
    });

    const resultLink = screen.getByRole("option");

    expect(resultLink.tagName).toBe("A");
    expect(resultLink.getAttribute("href")).toBe(
      "/o/acme/OS?task=OS-805&list=SPRINT-2"
    );
  });

  test("uses archived task hrefs for archived search results", () => {
    mockSearchResults([
      {
        _id: "task_1",
        parentId: null,
        refId: "OS-806",
        name: "Archived search result",
        taskType: {
          key: "task",
          name: "Task",
          icon: "SquareCheckBig",
          color: "#64748b",
          isSystem: true,
        },
        status: "Done",
        priority: "Low",
        createdByName: "Tester",
        isArchived: true,
      },
    ]);

    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={vi.fn()}
        getTaskHref={(taskRefId, archiveFilter) =>
          archiveFilter === "archived" ? `/o/acme/OS?task=${taskRefId}&archived=true` : `/o/acme/OS?task=${taskRefId}`
        }
      />
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "archived" },
    });

    expect(screen.getByRole("option").getAttribute("href")).toBe("/o/acme/OS?task=OS-806&archived=true");
  });

  test("plain left click keeps existing selection behavior", () => {
    const onSelectTask = vi.fn();
    mockSearchResults([
      {
        _id: "task_1",
        parentId: null,
        refId: "OS-807",
        name: "Clickable search result",
        taskType: {
          key: "task",
          name: "Task",
          icon: "SquareCheckBig",
          color: "#64748b",
          isSystem: true,
        },
        status: "To Do",
        priority: "Medium",
        createdByName: "Tester",
        isArchived: false,
        list: {
          type: "list",
          id: "list_1",
          ref: "SPRINT-2",
          name: "Sprint 2",
          isArchived: false,
        },
      },
    ]);

    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={onSelectTask}
        getTaskHref={(taskRefId) => `/o/acme/OS?task=${taskRefId}`}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "clickable" },
    });
    fireEvent.click(screen.getByRole("option"));

    expect(onSelectTask).toHaveBeenCalledWith(
      "OS-807",
      "active",
      "SPRINT-2"
    );
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
  });

  test("shows a clear button only when search has text and clears without selecting", () => {
    const onSelectTask = vi.fn();
    mockSearchResults([
      {
        _id: "task_1",
        parentId: null,
        refId: "OS-807",
        name: "Clearable search result",
        taskType: {
          key: "task",
          name: "Task",
          icon: "SquareCheckBig",
          color: "#64748b",
          isSystem: true,
        },
        status: "To Do",
        priority: "Medium",
        createdByName: "Tester",
        isArchived: false,
      },
    ]);

    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={onSelectTask}
        getTaskHref={(taskRefId) => `/o/acme/OS?task=${taskRefId}`}
      />
    );

    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "clearable" } });

    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
    expect(screen.getByText("Clearable search result")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(onSelectTask).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(screen.queryByText("Clearable search result")).toBeNull();
  });

  test("modified clicks use native link behavior without selecting in place", () => {
    const onSelectTask = vi.fn();
    mockSearchResults([
      {
        _id: "task_1",
        parentId: null,
        refId: "OS-808",
        name: "New tab search result",
        taskType: {
          key: "task",
          name: "Task",
          icon: "SquareCheckBig",
          color: "#64748b",
          isSystem: true,
        },
        status: "To Do",
        priority: "Medium",
        createdByName: "Tester",
        isArchived: false,
      },
    ]);

    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={onSelectTask}
        getTaskHref={(taskRefId) => `/o/acme/OS?task=${taskRefId}`}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "tab" },
    });
    fireEvent.click(screen.getByRole("option"), { metaKey: true });

    expect(onSelectTask).not.toHaveBeenCalled();
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("tab");
  });

  test("keyboard Enter selection still uses the selected result", () => {
    const onSelectTask = vi.fn();
    mockSearchResults([
      {
        _id: "task_1",
        parentId: null,
        refId: "OS-809",
        name: "Keyboard search result",
        taskType: {
          key: "task",
          name: "Task",
          icon: "SquareCheckBig",
          color: "#64748b",
          isSystem: true,
        },
        status: "To Do",
        priority: "Medium",
        createdByName: "Tester",
        isArchived: false,
      },
    ]);

    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={onSelectTask}
        getTaskHref={(taskRefId) => `/o/acme/OS?task=${taskRefId}`}
      />
    );

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "keyboard" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelectTask).toHaveBeenCalledWith("OS-809", "active", null);
    expect((input as HTMLInputElement).value).toBe("");
  });

  test("renders its field through the shared search input group", () => {
    mockSearchResults([]);
    render(
      <TaskSearchDropdown
        projectId={"project_1" as never}
        onSelectTask={vi.fn()}
        getTaskHref={(taskRefId) => `/o/acme/OS?task=${taskRefId}`}
      />
    );

    expect(screen.getByRole("combobox").closest('[data-slot="input-group"]')).not.toBeNull();
  });
});
