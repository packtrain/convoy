/**
 * @vitest-environment jsdom
 */
import type { MouseEvent, ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MobileSearchPanel } from "./mobile-search-panel";

const resetQueryMock = vi.hoisted(() => vi.fn());
const setQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tasks/hooks/use-task-selector-data", () => ({
  useTaskSelectorData: () => ({
    query: "listed",
    setQuery: setQueryMock,
    tab: "active",
    setTab: vi.fn(),
    hasQuery: true,
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    results: [
      {
        _id: "task_1",
        parentId: null,
        refId: "OS-901",
        name: "Mobile listed task",
        list: {
          type: "list",
          id: "list_1",
          ref: "SPRINT-2",
          name: "Sprint 2",
          isArchived: false,
        },
        taskType: {
          key: "task",
          name: "Task",
          icon: "SquareCheckBig",
          color: "#64748b",
          isSystem: true,
        },
        status: "To Do",
        priority: "None",
        assignee: null,
        createdByName: "Tester",
        isArchived: false,
      },
    ],
    loadMore: vi.fn(),
    resetQuery: resetQueryMock,
  }),
}));

vi.mock("@/components/blocks/tasks/task-selector-option-content", () => ({
  TaskSelectorOptionContent: ({ task }: { task: { name: string } }) => (
    <span>{task.name}</span>
  ),
}));

vi.mock("@/lib/navigation", () => ({
  AppLink: ({
    children,
    href,
    onClick,
    ...props
  }: {
    children: ReactNode;
    href: string;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));

describe("MobileSearchPanel", () => {
  afterEach(() => {
    cleanup();
    resetQueryMock.mockReset();
    setQueryMock.mockReset();
    vi.useRealTimers();
  });

  test("uses the owning List ref for result hrefs and plain selection", () => {
    vi.useFakeTimers();
    const onSelectTask = vi.fn();
    const getTaskHref = vi.fn(
      (taskRefId: string, _archiveFilter: string, listRef: string | null) =>
        `/o/acme/OS?task=${taskRefId}&list=${listRef}`
    );
    const onClose = vi.fn();

    render(
      <MobileSearchPanel
        projectId={"project_1" as never}
        onSelectTask={onSelectTask}
        getTaskHref={getTaskHref}
        onClose={onClose}
      />
    );

    const resultLink = screen.getByRole("link", {
      name: "Mobile listed task",
    });
    expect(resultLink.getAttribute("href")).toBe(
      "/o/acme/OS?task=OS-901&list=SPRINT-2"
    );
    expect(getTaskHref).toHaveBeenCalledWith(
      "OS-901",
      "active",
      "SPRINT-2"
    );

    fireEvent.click(resultLink);

    expect(onSelectTask).toHaveBeenCalledWith(
      "OS-901",
      "active",
      "SPRINT-2"
    );
    expect(resetQueryMock).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("uses the shared search field with a named clear button", () => {
    render(
      <MobileSearchPanel
        projectId={"project_1" as never}
        onSelectTask={vi.fn()}
        getTaskHref={() => "/task"}
        onClose={vi.fn()}
      />
    );

    const input = screen.getByRole("searchbox");
    expect(input.closest('[data-slot="input-group"]')).not.toBeNull();

    fireEvent.change(input, { target: { value: "other" } });
    expect(setQueryMock).toHaveBeenCalledWith("other");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(setQueryMock).toHaveBeenLastCalledWith("");
  });
});
