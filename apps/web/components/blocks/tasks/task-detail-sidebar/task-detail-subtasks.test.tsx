/**
 * @vitest-environment jsdom
 */
import { createRef, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { KanbanCardProps } from "../kanban-card";
import type { Id } from "@/convex/_generated/dataModel";
import { BACKLOG_SYSTEM_LIST } from "@/lib/task-lists/system-lists";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { Priority, Status, type Task } from "@/lib/tasks/types";
import { TaskDetailSubtasks } from "./task-detail-subtasks";
import type { TaskOperations } from "./task-detail-sidebar";
import { ThreadComposerTaskDropZone } from "@/components/blocks/thread/thread-composer-task-drop-zone";
import { readTaskDragPayload } from "@/lib/tasks/task-drag";

let panelWidth = 900;
let resizePanel: () => void;

vi.mock("@/components/blocks/tasks/kanban-card", () => ({
  KanbanCard: ({ task, onClick, onTaskUpdate, subtaskProgress }: KanbanCardProps) => (
    <article data-testid="subtask-card">
      <div role="button" data-task-card-body onClick={() => onClick?.(task)}>{task.name}</div>
      <button onClick={() => onTaskUpdate?.(task._id, { status: Status.DONE })}>
        Complete {task.name}
      </button>
      {subtaskProgress && <span>{subtaskProgress.completed}/{subtaskProgress.total}</span>}
    </article>
  ),
}));

vi.mock("@/components/blocks/tasks/task-table", () => ({
  TaskTable: ({
    tasks,
    statusFilter,
    hiddenTaskTableColumns,
    allowAddTask,
    canUpdateTask,
    isDndEnabled,
  }: {
    tasks: Array<{ name?: string; rowType?: string }>;
    statusFilter: string;
    hiddenTaskTableColumns?: readonly string[];
    allowAddTask?: boolean;
    canUpdateTask?: boolean;
    isDndEnabled?: boolean;
  }) => (
    <div
      data-testid="subtask-table"
      data-allow-add={String(allowAddTask ?? true)}
      data-can-update={String(canUpdateTask ?? true)}
      data-dnd={String(isDndEnabled)}
    >
      <div data-testid="subtask-status-filter">{statusFilter}</div>
      <div data-testid="subtask-hidden-columns">
        {(hiddenTaskTableColumns ?? []).join(",")}
      </div>
      {tasks.map((task, index) => (
        <div key={`${task.name ?? task.rowType}-${index}`}>{task.name ?? task.rowType}</div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/blocks/tasks/multi-select-toolbar", () => ({
  MultiSelectToolbar: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    delegatedToAgent: null,
    _id: "task-1" as Task["_id"],
    clientId: "client-1",
    refNumber: 1,
    refId: "OS-1",
    name: "Task",
    description: null,
    taskType: getDefaultTaskTypeSummary(),
    priority: Priority.NONE,
    dueDate: null,
    status: Status.TODO,
    tags: [],
    rank: "0|a:",
    parentId: null,
    createdAt: 1,
    isArchived: false,
    ...overrides,
    assignee: overrides.assignee ?? null,
  };
}

function createTaskOperations(): TaskOperations {
  return {
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    addTask: vi.fn(),
    reorderTasks: vi.fn(),
    reorderMultiple: vi.fn(),
    setParent: vi.fn(),
    setParentMultiple: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    bulkUpdateAssignee: vi.fn(),
    bulkUpdatePriority: vi.fn(),
    bulkUpdateDueDate: vi.fn(),
    bulkUpdateTaskType: vi.fn(),
    bulkArchive: vi.fn(),
    bulkUnarchive: vi.fn(),
    bulkDelete: vi.fn(),
    duplicateTask: vi.fn(),
    unarchiveTask: vi.fn(),
  };
}

describe("TaskDetailSubtasks", () => {
  beforeEach(() => {
    panelWidth = 900;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, panelWidth, 500)
    );
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resizePanel = callback; }
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test.each([false, true])("keeps the plus creation row visible when subtasks exist: %s", (hasChildren) => {
    panelWidth = 400;
    const parent = createTask();
    const child = createTask({
      _id: "child" as Task["_id"], clientId: "child-client", parentId: parent._id,
    });
    const operations = createTaskOperations();
    render(<TaskDetailSubtasks
      task={parent} allTasks={hasChildren ? [parent, child] : [parent]}
      taskOperations={operations} inputRefs={createRef()} focusInput={vi.fn()}
    />);

    const input = screen.getByRole("textbox", { name: "Add subtask" });
    const row = input.closest("label");
    expect(row?.querySelector("svg.lucide-plus")).toBeTruthy();
    expect(input.getAttribute("placeholder")).toBe("Add task...");
    expect(input.className).toContain("bg-transparent");
    expect(input.className).not.toContain("border-input");
    expect(row?.className).not.toMatch(/opacity-0|hidden/);
    fireEvent.change(input, { target: { value: "Created on blur" } });
    fireEvent.blur(input);
    expect(operations.addTask).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Created on blur" }), { parentId: parent._id }
    );
    expect(screen.getByRole("textbox", { name: "Add subtask" })).toBe(input);
  });

  test("drags a subtask into the composer without moving it out of its parent", () => {
    panelWidth = 400;
    const parent = createTask();
    const child = createTask({
      _id: "child" as Task["_id"], clientId: "child-client",
      parentId: parent._id, name: "Child task", refId: "OS-2",
    });
    const operations = createTaskOperations();
    const onDropTask = vi.fn();
    render(<>
      <TaskDetailSubtasks
        task={parent} allTasks={[parent, child]} taskOperations={operations}
        inputRefs={createRef()} focusInput={vi.fn()} onOpenSubtask={vi.fn()}
        projectId={"project-1" as Id<"projects">}
      />
      <ThreadComposerTaskDropZone projectId="project-1" onDropTask={onDropTask}>
        <div data-testid="composer-input" />
      </ThreadComposerTaskDropZone>
    </>);
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      get types() { return [...data.keys()]; },
      setData: (type: string, value: string) => { data.set(type, value); },
      getData: (type: string) => data.get(type) ?? "",
    } as unknown as DataTransfer;
    const body = screen.getByRole("button", { name: "Child task" });
    const pointer = new Event("pointerdown", { bubbles: true });
    Object.assign(pointer, { pointerType: "mouse", button: 0, isPrimary: true });
    fireEvent(body, pointer);
    fireEvent.dragStart(body, { dataTransfer });

    expect(readTaskDragPayload(dataTransfer)).toEqual({
      projectId: "project-1", taskIds: ["child"], taskRefIds: ["OS-2"],
    });
    expect(body.closest('[draggable="true"]')).not.toBeNull();
    const composer = screen.getByTestId("composer-input");
    fireEvent.dragOver(composer, { dataTransfer });
    expect(screen.getByTestId("thread-composer-task-drop-overlay")).toBeTruthy();
    fireEvent.drop(composer, { dataTransfer });
    fireEvent.dragEnd(body, { dataTransfer });
    expect(onDropTask).toHaveBeenCalledWith({ id: "child", refId: "OS-2" });
    expect(operations.setParent).not.toHaveBeenCalled();
    expect(operations.reorderTasks).not.toHaveBeenCalled();
    expect(body.closest('[draggable="true"]')).toBeNull();
  });

  test.each([390, 400, 767])("renders direct subtasks as editable cards in a %ipx panel on desktop", (width) => {
    panelWidth = width;
    const parent = createTask();
    const child = createTask({
      _id: "child" as Task["_id"], clientId: "child-client", parentId: parent._id,
      name: "Add CLI methods for tracking task commits",
    });
    const grandchild = createTask({
      _id: "grandchild" as Task["_id"], clientId: "grandchild-client",
      parentId: child._id, name: "Nested child", status: Status.DONE,
    });
    const operations = createTaskOperations();
    const onOpenSubtask = vi.fn();
    render(<TaskDetailSubtasks
      task={parent} allTasks={[parent, child, grandchild]}
      taskOperations={operations} inputRefs={createRef()} focusInput={vi.fn()}
      onOpenSubtask={onOpenSubtask}
    />);

    expect(window.innerWidth).toBeGreaterThanOrEqual(768);
    expect(screen.getAllByTestId("subtask-card")).toHaveLength(1);
    expect(screen.queryByTestId("subtask-status-filter")).toBeNull();
    expect(screen.getByText("1/1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: child.name }));
    expect(onOpenSubtask).toHaveBeenCalledWith(child.clientId);
    fireEvent.click(screen.getByRole("button", { name: `Complete ${child.name}` }));
    expect(operations.updateTask).toHaveBeenCalledWith(child._id, { status: Status.DONE });

    const input = screen.getByRole("textbox", { name: "Add subtask" });
    fireEvent.change(input, { target: { value: "Another child" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(operations.addTask).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Another child" }), { parentId: parent._id }
    );

    act(() => { panelWidth = 900; resizePanel(); });
    expect(screen.queryByTestId("subtask-card")).toBeNull();
    expect(screen.getByTestId("subtask-status-filter")).toBeTruthy();
    act(() => { panelWidth = width; resizePanel(); });
    expect(screen.getAllByTestId("subtask-card")).toHaveLength(1);
  });

  test("renders backlog subtasks when the opened parent task is in backlog", () => {
    const backlogList = {
      type: "system" as const,
      key: BACKLOG_SYSTEM_LIST.key,
      ref: BACKLOG_SYSTEM_LIST.ref,
      name: BACKLOG_SYSTEM_LIST.name,
    };
    const parent = createTask({
      _id: "task-parent" as Task["_id"],
      clientId: "client-parent",
      refId: "OS-1",
      name: "Backlog parent",
      list: backlogList,
    });
    const child = createTask({
      _id: "task-child" as Task["_id"],
      clientId: "client-child",
      refId: "OS-2",
      name: "Backlog child",
      list: backlogList,
      parentId: parent._id,
    });

    render(
      <TaskDetailSubtasks
        task={parent}
        allTasks={[parent, child]}
        taskOperations={createTaskOperations()}
        inputRefs={createRef<Map<string, HTMLInputElement> | null>()}
        focusInput={vi.fn()}
        hiddenTaskTableColumns={["priority", "tags"]}
      />
    );

    expect(screen.getByText("Subtasks")).toBeTruthy();
    expect(screen.getByText("1").getAttribute("data-slot")).toBe("badge");
    expect(screen.getByText("1").getAttribute("data-shape")).toBe("square");
    expect(screen.queryByText("(1)")).toBeNull();
    expect(screen.getByTestId("subtask-status-filter").textContent).toBe("all");
    expect(screen.getByTestId("subtask-hidden-columns").textContent).toBe(
      "priority,tags"
    );
    expect(screen.getByText("Backlog child")).toBeTruthy();
  });

  describe("read-only viewer (docs/specs/read-only-viewer-ux.md)", () => {
    test("card layout has no add row", () => {
      panelWidth = 400;
      const parent = createTask();
      const child = createTask({ _id: "task-child" as Task["_id"], clientId: "client-child", parentId: parent._id });
      render(<TaskDetailSubtasks
        task={parent} allTasks={[parent, child]}
        taskOperations={createTaskOperations()} inputRefs={createRef()} focusInput={vi.fn()}
        readOnly
      />);

      expect(screen.queryByRole("textbox", { name: "Add subtask" })).toBeNull();
    });

    test("cards get no field editor", () => {
      panelWidth = 400;
      const parent = createTask();
      const child = createTask({ _id: "task-child" as Task["_id"], clientId: "client-child", name: "Child", parentId: parent._id });
      const operations = createTaskOperations();
      render(<TaskDetailSubtasks
        task={parent} allTasks={[parent, child]}
        taskOperations={operations} inputRefs={createRef()} focusInput={vi.fn()}
        readOnly
      />);

      fireEvent.click(screen.getByRole("button", { name: "Complete Child" }));
      expect(operations.updateTask).not.toHaveBeenCalled();
    });

    test("table layout turns the add rows off", () => {
      const parent = createTask();
      const child = createTask({ _id: "task-child" as Task["_id"], clientId: "client-child", parentId: parent._id });
      render(<TaskDetailSubtasks
        task={parent} allTasks={[parent, child]}
        taskOperations={createTaskOperations()} inputRefs={createRef()} focusInput={vi.fn()}
        readOnly
      />);

      const table = screen.getByTestId("subtask-table");
      expect(table.dataset.allowAdd).toBe("false");
      expect(table.dataset.canUpdate).toBe("false");
      expect(table.dataset.dnd).toBe("false");
    });

    test.each([400, 1000])("shows an empty state with no subtasks (width %i)", (width) => {
      panelWidth = width;
      const parent = createTask();
      render(<TaskDetailSubtasks
        task={parent} allTasks={[parent]}
        taskOperations={createTaskOperations()} inputRefs={createRef()} focusInput={vi.fn()}
        readOnly
      />);

      expect(screen.getByText("No subtasks")).toBeTruthy();
      expect(screen.queryByTestId("subtask-table")).toBeNull();
    });
  });
});
