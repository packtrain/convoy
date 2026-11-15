/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { Status, type Task, type TaskUpdate } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { TaskContextMenu, TaskContextMenuProvider } from "./task-context-menu";
import { TaskListMoveProvider } from "./task-list-move-context";
import { VIEW_ONLY_REASON } from "@/lib/authz/use-project-permissions";

const mobileState = vi.hoisted(() => ({ isMobile: false }));

vi.mock("@/hooks/browser/use-mobile", () => ({
  useIsMobile: () => mobileState.isMobile,
}));

vi.mock("@/components/blocks/project/task-lists/use-task-list-results", () => ({
  useResolvedTaskListResultsController: () => ({
    query: "",
    setQuery: () => {},
    resetQuery: () => {},
    results: [],
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    loadMore: () => {},
  }),
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSubTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  ContextMenuSubContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuContent: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div data-testid="context-menu-content" className={className}>{children}</div>,
  ContextMenuItem: ({
    children,
    onClick,
    disabled,
    title,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  ),
  ContextMenuSeparator: () => <hr />,
}));

vi.mock("@/components/blocks/project/task-lists/move-to-list-menu-content", () => ({
  MoveToListMenuContent: ({
    onMoveToList,
    selectedListRef,
  }: {
    onMoveToList: (listRef: string) => void;
    selectedListRef?: string | null;
  }) =>
    (
      <button
        type="button"
        disabled={selectedListRef === "SPRINT"}
        onClick={() => onMoveToList("SPRINT")}
      >
        Sprint
      </button>
    ),
}));

vi.mock("@/lib/tasks/hooks/use-project-labels", () => ({
  useProjectLabels: () => ({
    labels: [{ _id: "label_1", name: "Q1", color: "#ef4444", rank: "0|a" }],
    labelsById: new Map(),
    isLoading: false,
  }),
}));

vi.mock("@/lib/tasks/hooks/use-assignable-task-assignees", () => ({
  useAssignableTaskAssignees: () => ({ sections: [], findOption: () => null }),
}));

const baseTask: Task = {
  delegatedToAgent: null,
  _id: "task_1" as Id<"tasks">,
  clientId: "client-1",
  refNumber: 1,
  refId: "ABC-1",
  name: "Task 1",
  description: null,
  taskType: getDefaultTaskTypeSummary(),
  priority: "None",
  dueDate: null,
  status: Status.TODO,
  assignee: null,
  tags: [],
  rank: "0|hzzzzz:",
  parentId: null,
  createdAt: Date.now(),
  isArchived: false,
};

function renderWithTaskListMove(
  ui: ReactNode,
  {
    enabled = true,
    selectedListRef = null,
    moveTaskToList,
    moveSelectionToList,
  }: {
    enabled?: boolean;
    selectedListRef?: string | null;
    moveTaskToList?: (taskId: string, listRef: string) => void;
    moveSelectionToList?: (listRef: string) => void;
  } = {}
) {
  return render(
    <TaskListMoveProvider
      projectId={"project_1" as Id<"projects">}
      enabled={enabled}
      selectedListRef={selectedListRef}
      moveTaskToList={moveTaskToList}
      moveSelectionToList={moveSelectionToList}
    >
      {ui}
    </TaskListMoveProvider>
  );
}

// Items stay on one line: the menu grows to its widest row instead of wrapping labels.
function expectOneLineMenu(minWidth: string) {
  const classes = screen.getByTestId("context-menu-content").className.split(" ");
  expect(classes).toContain(minWidth);
  expect(classes).toContain("w-max");
  expect(classes).toContain("[&_[role=menuitem]]:whitespace-nowrap");
}

describe("TaskContextMenu", () => {
  afterEach(() => {
    mobileState.isMobile = false;
    cleanup();
  });

  test("does not mount the row context menu on mobile", () => {
    mobileState.isMobile = true;

    render(
      <TaskContextMenu
        task={baseTask}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={vi.fn()}
        onOpenDetails={vi.fn()}
      >
        <div>Task row</div>
      </TaskContextMenu>
    );

    expect(screen.getByText("Task row")).toBeDefined();
    expect(screen.queryByTestId("context-menu-content")).toBeNull();
  });

  test("marks completed task incomplete from context menu", () => {
    const onUpdateStatus = vi.fn();

    render(
      <TaskContextMenu
        task={{ ...baseTask, status: Status.DONE }}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={onUpdateStatus}
        onOpenDetails={vi.fn()}
      >
        <div>Task row</div>
      </TaskContextMenu>
    );

    fireEvent.click(screen.getByRole("button", { name: /mark incomplete/i }));

    expect(onUpdateStatus).toHaveBeenCalledWith(baseTask._id, Status.TODO);
  });

  test("uses selection-scoped callbacks and labels for selected-row bulk actions", () => {
    const selectionActions = {
      selectedCount: 2,
      onDelete: vi.fn(),
      onArchive: vi.fn(),
      onUpdateStatus: vi.fn(),
    };
    const onDelete = vi.fn();
    const onArchive = vi.fn();
    const onUpdateStatus = vi.fn();

    render(
      <TaskContextMenu
        task={baseTask}
        onDelete={onDelete}
        onArchive={onArchive}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={onUpdateStatus}
        onOpenDetails={vi.fn()}
        selectionActions={selectionActions}
      >
        <div>Task row</div>
      </TaskContextMenu>
    );

    fireEvent.click(
      screen.getByRole("button", { name: /mark selected complete/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /archive selected/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /delete selected tasks/i })
    );

    expect(selectionActions.onUpdateStatus).toHaveBeenNthCalledWith(
      1,
      Status.DONE
    );
    expect(selectionActions.onArchive).toHaveBeenCalledTimes(1);
    expect(selectionActions.onDelete).toHaveBeenCalledTimes(1);
    expect(onUpdateStatus).not.toHaveBeenCalled();
    expect(onArchive).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expectOneLineMenu("min-w-60");
  });

  test("opens 'Move selected to' submenu from selection context menu", () => {
    const moveSelectionToList = vi.fn();
    const selectionActions = {
      selectedCount: 2,
      onDelete: vi.fn(),
      onArchive: vi.fn(),
      onUpdateStatus: vi.fn(),
    };

    renderWithTaskListMove(
      <TaskContextMenu
        task={baseTask}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={vi.fn()}
        onOpenDetails={vi.fn()}
        selectionActions={selectionActions}
      >
        <div>Task row</div>
      </TaskContextMenu>,
      { moveSelectionToList }
    );

    fireEvent.click(screen.getByRole("button", { name: /^move selected to$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^sprint$/i }));

    expect(moveSelectionToList).toHaveBeenCalledWith("SPRINT", undefined);
  });

  test("shows Move to submenu for a single task", () => {
    const moveTaskToList = vi.fn();

    renderWithTaskListMove(
      <TaskContextMenu
        task={baseTask}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={vi.fn()}
        onOpenDetails={vi.fn()}
      >
        <div>Task row</div>
      </TaskContextMenu>,
      { moveTaskToList }
    );

    expect(screen.getByRole("button", { name: /^move to$/i })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^sprint$/i }));

    expect(moveTaskToList).toHaveBeenCalledWith(baseTask._id, "SPRINT", undefined);
  });

  test("disables the current task List in the single-task Move to submenu", () => {
    const moveTaskToList = vi.fn();

    renderWithTaskListMove(
      <TaskContextMenu
        task={{
          ...baseTask,
          list: {
            type: "list",
            id: "list_1" as Id<"taskLists">,
            ref: "SPRINT",
            name: "Sprint",
            isArchived: false,
          },
        }}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={vi.fn()}
        onOpenDetails={vi.fn()}
      >
        <div>Task row</div>
      </TaskContextMenu>,
      { moveTaskToList }
    );

    const sprintItem = screen.getByRole("button", { name: /^sprint$/i });
    expect(sprintItem).toHaveProperty("disabled", true);

    fireEvent.click(sprintItem);

    expect(moveTaskToList).not.toHaveBeenCalled();
  });

  test("does not disable the default List target for Backlog tasks", () => {
    const moveTaskToList = vi.fn();

    renderWithTaskListMove(
      <TaskContextMenu
        task={{
          ...baseTask,
          list: {
            type: "system",
            key: "backlog",
            ref: "BACKLOG",
            name: "Backlog",
          },
        }}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={vi.fn()}
        onOpenDetails={vi.fn()}
      >
        <div>Task row</div>
      </TaskContextMenu>,
      { selectedListRef: null, moveTaskToList }
    );

    const sprintItem = screen.getByRole("button", { name: /^sprint$/i });
    expect(sprintItem).toHaveProperty("disabled", false);

    fireEvent.click(sprintItem);

    expect(moveTaskToList).toHaveBeenCalledWith(baseTask._id, "SPRINT", undefined);
  });

  test("hides Move to submenu when List moves are disabled", () => {
    renderWithTaskListMove(
      <TaskContextMenu
        task={baseTask}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={vi.fn()}
        onOpenDetails={vi.fn()}
      >
        <div>Task row</div>
      </TaskContextMenu>,
      { enabled: false, moveTaskToList: vi.fn() }
    );

    expect(screen.queryByRole("button", { name: /^move to$/i })).toBeNull();
  });

  test("keeps middle actions scoped to the clicked task in selection mode", () => {
    const onDuplicate = vi.fn();
    const onOpenDetails = vi.fn();
    const selectionActions = {
      selectedCount: 2,
      onDelete: vi.fn(),
      onArchive: vi.fn(),
      onUpdateStatus: vi.fn(),
    };

    render(
      <TaskContextMenu
        task={baseTask}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={onDuplicate}
        onUpdateStatus={vi.fn()}
        onOpenDetails={onOpenDetails}
        selectionActions={selectionActions}
      >
        <div>Task row</div>
      </TaskContextMenu>
    );

    fireEvent.click(screen.getByRole("button", { name: /duplicate task/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /open task details/i })
    );

    expect(onDuplicate).toHaveBeenCalledWith(baseTask);
    expect(onOpenDetails).toHaveBeenCalledWith(baseTask.clientId);
    expect(selectionActions.onUpdateStatus).not.toHaveBeenCalled();
    expect(selectionActions.onDelete).not.toHaveBeenCalled();
  });

  test("uses single-row callbacks when selection actions are not provided", () => {
    const onDelete = vi.fn();
    const onArchive = vi.fn();
    const onUpdateStatus = vi.fn();

    render(
      <TaskContextMenu
        task={baseTask}
        onDelete={onDelete}
        onArchive={onArchive}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={onUpdateStatus}
        onOpenDetails={vi.fn()}
      >
        <div>Task row</div>
      </TaskContextMenu>
    );

    fireEvent.click(screen.getByRole("button", { name: /^mark complete$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete task$/i }));

    expect(onUpdateStatus).toHaveBeenCalledWith(baseTask._id, Status.DONE);
    expect(onArchive).toHaveBeenCalledWith(baseTask._id);
    expect(onDelete).toHaveBeenCalledWith(baseTask._id);
    expectOneLineMenu("min-w-52");
  });

  test("places move to backlog shortcut above duplicate task", () => {
    const moveTaskToList = vi.fn();

    renderWithTaskListMove(
      <TaskContextMenu
        task={baseTask}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={vi.fn()}
        onOpenDetails={vi.fn()}
      >
        <div>Task row</div>
      </TaskContextMenu>,
      { moveTaskToList }
    );

    const buttons = screen
      .getAllByRole("button")
      .map((button) => button.textContent);

    expect(buttons).toContain("Move to backlog");
    expect(buttons.indexOf("Move to backlog")).toBeLessThan(
      buttons.findIndex((text) => text?.startsWith("Duplicate task"))
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^move to backlog$/i })
    );
    expect(moveTaskToList).toHaveBeenCalledWith("task_1", "BACKLOG");
  });

  test("hides the move to backlog shortcut when already in backlog", () => {
    renderWithTaskListMove(
      <TaskContextMenu
        task={{
          ...baseTask,
          list: {
            type: "system",
            key: "backlog",
            ref: "BACKLOG",
            name: "Backlog",
          },
        }}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={vi.fn()}
        onOpenDetails={vi.fn()}
      >
        <div>Task row</div>
      </TaskContextMenu>,
      { moveTaskToList: vi.fn() }
    );

    expect(
      screen.queryByRole("button", { name: /^move to backlog$/i })
    ).toBeNull();
  });

  test("moves the whole selection to backlog in selection scope", () => {
    const moveSelectionToList = vi.fn();

    renderWithTaskListMove(
      <TaskContextMenu
        task={baseTask}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={vi.fn()}
        onOpenDetails={vi.fn()}
        selectionActions={{
          selectedCount: 2,
          onDelete: vi.fn(),
          onArchive: vi.fn(),
          onUpdateStatus: vi.fn(),
        }}
      >
        <div>Task row</div>
      </TaskContextMenu>,
      { moveSelectionToList }
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^move selected to backlog$/i })
    );
    expect(moveSelectionToList).toHaveBeenCalledWith("BACKLOG");
  });

  test("keeps archive selected enabled when the clicked selected row is a subtask", () => {
    const selectionActions = {
      selectedCount: 2,
      onDelete: vi.fn(),
      onArchive: vi.fn(),
      onUpdateStatus: vi.fn(),
    };

    render(
      <TaskContextMenu
        task={{ ...baseTask, parentId: "task_parent" as Id<"tasks"> }}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDuplicate={vi.fn()}
        onUpdateStatus={vi.fn()}
        onOpenDetails={vi.fn()}
        selectionActions={selectionActions}
      >
        <div>Task row</div>
      </TaskContextMenu>
    );

    const archiveButton = screen.getByRole("button", {
      name: /archive selected/i,
    }) as HTMLButtonElement;

    expect(archiveButton.disabled).toBe(false);
  });
});


test("read-only menus keep navigation, disable write items with the shared reason, and hide delete", () => {
  const onOpenDetails = vi.fn();
  const onUpdateStatus = vi.fn();
  renderWithTaskListMove(
    <TaskContextMenu task={baseTask} readOnly onOpenDetails={onOpenDetails}
      onDelete={vi.fn()} onArchive={vi.fn()} onUnarchive={vi.fn()} onDuplicate={vi.fn()} onUpdateStatus={onUpdateStatus}>
      <span>Task</span>
    </TaskContextMenu>,
    { moveTaskToList: vi.fn() }
  );

  fireEvent.click(screen.getByRole("button", { name: "Open task details" }));
  expect(onOpenDetails).toHaveBeenCalledWith("client-1");
  expect(screen.getByRole("button", { name: /Copy task link/i })).toBeTruthy();
  for (const name of [/^Mark complete$/, /^Move to$/, /^Duplicate task$/, /^Archive$/]) {
    const item = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(item.disabled, String(name)).toBe(true);
    expect(item.title).toBe(VIEW_ONLY_REASON);
  }
  expect(screen.queryByRole("button", { name: /Move to backlog/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /Delete task/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Mark complete$/ }));
  expect(onUpdateStatus).not.toHaveBeenCalled();
});

describe("TaskContextMenu property submenus and shortcut hints", () => {
  afterEach(cleanup);

  function renderMenu({
    selectionActions,
    shortcutHints,
  }: {
    selectionActions?: Parameters<typeof TaskContextMenu>[0]["selectionActions"];
    shortcutHints?: Parameters<typeof TaskContextMenu>[0]["shortcutHints"];
  } = {}) {
    const updateTask = vi.fn<(id: string, updates: TaskUpdate) => void>();
    const onUpdateStatus = vi.fn<(id: string, status: Status) => void>();
    renderWithTaskListMove(
      <TaskContextMenuProvider
        projectId={"project_1" as Id<"projects">}
        allowedStatuses={[Status.TODO, Status.IN_PROGRESS, Status.DONE]}
        updateTask={updateTask}
      >
        <TaskContextMenu
          task={baseTask}
          onDelete={vi.fn()}
          onArchive={vi.fn()}
          onUnarchive={vi.fn()}
          onDuplicate={vi.fn()}
          onUpdateStatus={onUpdateStatus}
          onOpenDetails={vi.fn()}
          selectionActions={selectionActions}
          shortcutHints={shortcutHints}
        >
          <div>Task row</div>
        </TaskContextMenu>
      </TaskContextMenuProvider>,
      { moveTaskToList: vi.fn(), moveSelectionToList: vi.fn() }
    );
    return { updateTask, onUpdateStatus };
  }

  const pickerItem = (value: string) =>
    screen.getAllByRole("button").find((button) => button.textContent?.trim().startsWith(value) && !button.textContent.includes("Search"))!;

  const keycapsOf = (name: string) =>
    Array.from(screen.getByRole("button", { name }).querySelectorAll('[data-slot="kbd"]')).map((kbd) => kbd.textContent);

  test("shows Status, Priority, Assignee and Label submenus with their keys", () => {
    renderMenu();
    expect(keycapsOf("Status")).toEqual(["S"]);
    expect(keycapsOf("Priority")).toEqual(["P"]);
    expect(keycapsOf("Assignee")).toEqual(["A"]);
    expect(keycapsOf("Label")).toEqual(["L"]);
    expect(keycapsOf("Move to")).toEqual(["M"]);
  });

  test("board menus show only the keys a focused card handles", () => {
    renderMenu({ shortcutHints: "board" });
    expect(keycapsOf("Priority")).toEqual(["P"]);
    expect(keycapsOf("Assignee")).toEqual(["A"]);
    expect(keycapsOf("Label")).toEqual(["L"]);
    expect(keycapsOf("Move to")).toEqual(["M"]);
    expect(keycapsOf("Status")).toEqual([]);
    expect(keycapsOf("Mark complete")).toEqual([]);
    expect(keycapsOf("Duplicate task")).toEqual([]);
    expect(keycapsOf("Delete task")).toEqual([]);
  });

  test("shows keycaps for the shortcuts that already work in the table", () => {
    renderMenu();
    expect(keycapsOf("Mark complete")).toEqual(["Space"]);
    expect(keycapsOf("Duplicate task")).toEqual(["Ctrl", "D"]);
    expect(keycapsOf("Open task details")).toEqual(["Ctrl", "Enter"]);
    expect(keycapsOf("Delete task")).toEqual(["Ctrl", "Backspace"]);
  });

  test("single-task submenus update the clicked task", () => {
    const { updateTask, onUpdateStatus } = renderMenu();

    fireEvent.click(pickerItem("In Progress"));
    expect(onUpdateStatus).toHaveBeenCalledWith(baseTask._id, Status.IN_PROGRESS);

    fireEvent.click(pickerItem("High"));
    expect(updateTask).toHaveBeenCalledWith(baseTask._id, { priority: "High" });

    fireEvent.click(pickerItem("Q1"));
    expect(updateTask).toHaveBeenCalledWith(baseTask._id, { labelId: "label_1" });

    fireEvent.click(pickerItem("No assignee"));
    expect(updateTask).toHaveBeenCalledWith(baseTask._id, { assigneeId: null, assigneeDetails: null });
  });

  test("selection-scope submenus update every selected task", () => {
    const selectionActions = {
      selectedCount: 2,
      onDelete: vi.fn(),
      onUpdateStatus: vi.fn(),
      onUpdatePriority: vi.fn(),
      onUpdateAssignee: vi.fn(),
      onUpdateLabel: vi.fn(),
    };
    const { updateTask } = renderMenu({ selectionActions });

    fireEvent.click(pickerItem("High"));
    fireEvent.click(pickerItem("Q1"));
    fireEvent.click(pickerItem("No assignee"));

    expect(selectionActions.onUpdatePriority).toHaveBeenCalledWith("High");
    expect(selectionActions.onUpdateLabel).toHaveBeenCalledWith("label_1");
    expect(selectionActions.onUpdateAssignee).toHaveBeenCalledWith({ assigneeId: null, assigneeDetails: null });
    expect(updateTask).not.toHaveBeenCalled();
  });
});
