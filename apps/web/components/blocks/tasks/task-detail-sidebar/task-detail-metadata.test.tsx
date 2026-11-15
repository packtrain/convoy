/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { Status, type Task } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary, resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import type { TaskListItem } from "@/components/blocks/project/task-lists/task-list-types";
import type { TaskListResultsController } from "@/components/blocks/project/task-lists/use-task-list-results";
import { TaskDetailMetadata } from "./task-detail-metadata";

const useQueryMock = vi.fn();
const taskTitleEditorMock = vi.fn();
const taskListPickerMock = vi.fn();
const useProjectLabelsMock = vi.fn();

// The label picker's Command (cmdk) needs ResizeObserver, absent in jsdom.
if (!globalThis.ResizeObserver) {
  const ResizeObserverMock = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

vi.mock("@/lib/tasks/hooks/use-project-labels", () => ({
  useProjectLabels: (...args: unknown[]) => useProjectLabelsMock(...args),
}));
const taskListItemFixture: TaskListItem = {
  type: "list",
  _id: "list_2" as Id<"taskLists">,
  _creationTime: 1,
  projectId: "project_1" as Id<"projects">,
  name: "Sprint 1",
  ref: "SPRINT-1",
  color: "#2563eb",
  isArchived: false,
  isDefault: false,
  isPinned: false,
  createdBy: "user_1" as Id<"users">,
  updatedBy: "user_1" as Id<"users">,
  createdAt: 1,
  updatedAt: 1,
};
const defaultTaskListItemFixture: TaskListItem = {
  ...taskListItemFixture,
  _id: "list_default" as Id<"taskLists">,
  name: "Sprint 12",
  ref: "SPRINT-12",
  color: "#16a34a",
  isDefault: true,
};
const secondTaskListItemFixture: TaskListItem = {
  ...taskListItemFixture,
  _id: "list_3" as Id<"taskLists">,
  name: "Sprint 2",
  ref: "SPRINT-2",
};

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
}));

vi.mock("@/components/blocks/tasks/task-ref-with-type", () => ({
  TaskRef: ({ refId }: { refId: string }) => <span>{refId}</span>,
  TaskRefWithType: ({
    refId,
    taskType,
  }: {
    refId: string;
    taskType: { name: string };
  }) => (
    <span data-testid="parent-task-ref-with-type">
      <span data-testid="parent-task-type-glyph">{taskType.name}</span>
      <span>{refId}</span>
    </span>
  ),
  TaskTypeSelector: () => <span>type-selector</span>,
  TaskType: ({ taskType }: { taskType: { name: string } }) => <span>{taskType.name}</span>,
}));

vi.mock("@/components/blocks/tasks/task-title-editor", () => ({
  TaskTitleEditor: (props: { value: string; isClosed?: boolean; readOnly?: boolean }) => {
    taskTitleEditorMock(props);
    return <div>{props.value}</div>;
  },
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({
    children,
    onOpenChange,
  }: {
    children: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div>
      {children}
      {onOpenChange ? (
        <button type="button" onClick={() => onOpenChange(false)}>
          close dropdown
        </button>
      ) : null}
    </div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/blocks/tasks/status-dropdown-menu", () => ({
  StatusDropdownMenu: ({
    trigger,
  }: {
    trigger: ReactNode;
  }) => <div>{trigger}</div>,
}));

vi.mock("@/components/blocks/tasks/task-table/badges", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  PriorityIcon: ({ priority }: { priority: string }) => <span>{priority}</span>,
}));

vi.mock("@/components/blocks/tasks/task-table/cells/assignee-selector", () => ({
  AssigneeSelector: ({ disabled }: { disabled?: boolean }) => (
    <div data-disabled={disabled ? "true" : undefined}>assignee-selector</div>
  ),
}));

vi.mock("@/components/blocks/project/task-lists/task-list-identity", () => ({
  ARCHIVED_TASK_LIST_ICON_CLASS: "archived-icon",
  ARCHIVED_TASK_LIST_TRIGGER_CLASS: "archived-trigger",
  TaskListIdentity: ({
    list,
  }: {
    list: {
      type: "list" | "system";
      name: string;
      color?: string | null;
      isArchived?: boolean;
    };
  }) => {
    const isPersisted = list.type === "list";
    return (
      <span
        data-color={(isPersisted ? list.color : undefined) || undefined}
        data-icon={isPersisted && list.isArchived ? "archive" : "circle"}
      >
        {list.name}
      </span>
    );
  },
}));

vi.mock("@/components/blocks/project/task-lists/task-list-management", () => ({
  TaskListPicker: ({
    onSelectBacklog,
    onSelectList,
    disabledRows,
    resultsController,
    showRowActions,
  }: {
    onSelectBacklog: () => void;
    onSelectList: (list: TaskListItem) => void;
    disabledRows?: {
      system?: boolean | ((key: "backlog" | "archived") => boolean);
      create?: boolean;
    };
    resultsController?: TaskListResultsController;
    showRowActions?: boolean;
  }) => {
    taskListPickerMock({ resultsController, showRowActions });
    const isSystemDisabled = (key: "backlog" | "archived") =>
      typeof disabledRows?.system === "function"
        ? disabledRows.system(key)
        : Boolean(disabledRows?.system);

    return (
      <div>
        <button type="button">Sprint 12</button>
        <button
          type="button"
          disabled={isSystemDisabled("backlog")}
          onClick={onSelectBacklog}
        >
          Backlog
        </button>
        <button type="button" disabled={isSystemDisabled("archived")}>Archived</button>
        {disabledRows?.create ? null : <button type="button">Create list</button>}
        <button
          type="button"
          onClick={() => onSelectList(taskListItemFixture)}
        >
          Move to Sprint 1
        </button>
        <button
          type="button"
          onClick={() => onSelectList(secondTaskListItemFixture)}
        >
          Move to Sprint 2
        </button>
      </div>
    );
  },
}));

vi.mock("./task-tags-editor", () => ({
  TaskTagsEditor: ({
    tags,
    onTagsChange,
    className,
    readOnly,
  }: {
    tags: string[];
    onTagsChange: (tags: string[]) => void;
    className?: string;
    readOnly?: boolean;
  }) => (
    <div
      data-testid="task-tags-editor-container"
      data-readonly={readOnly ? "true" : undefined}
      className={className}
    >
      <span data-testid="task-tags-editor">{tags.join(",")}</span>
      <button type="button" onClick={() => onTagsChange(["updated-tag"])}>
        update-tags
      </button>
    </div>
  ),
}));

vi.mock("@/components/lingua-time/datetime-picker", () => ({
  DateTimePicker: ({
    disabled,
    setDateTime,
  }: {
    disabled?: boolean;
    setDateTime: (date: Date | undefined) => void;
  }) => (
    <>
      <button type="button" disabled={disabled}>date-picker</button>
      {/* A suggestion list opened before the picker turned disabled stays clickable. */}
      <button type="button" onClick={() => setDateTime(new Date(2026, 0, 1))}>
        open-suggestion
      </button>
    </>
  ),
}));

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    delegatedToAgent: null,
    _id: "task_1" as Task["_id"],
    clientId: "task_1",
    refNumber: 1,
    refId: "OS-1",
    name: "Current task",
    description: null,
    taskType: getDefaultTaskTypeSummary(),
    priority: "None",
    dueDate: null,
    status: Status.TODO,
    tags: [],
    rank: "0|hzzzzz:",
    parentId: null,
    createdAt: Date.now(),
    isArchived: false,
    ...overrides,
    assignee: overrides.assignee ?? null,
  };
}

const projectId = "project_1" as Id<"projects">;

describe("TaskDetailMetadata", () => {
  beforeEach(() => {
    useProjectLabelsMock.mockReturnValue({
      labels: [],
      labelsById: new Map(),
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    taskTitleEditorMock.mockReset();
    taskListPickerMock.mockReset();
    useProjectLabelsMock.mockReset();
  });

  test("renders the parent task with its type glyph and opens it on click", () => {
    const onOpenSubtask = vi.fn();
    const task = createTask({ parentId: "task_parent" });
    const parentTask = createTask({
      _id: "task_parent" as Task["_id"],
      clientId: "task_parent",
      refNumber: 42,
      refId: "OS-42",
      name: "Parent task",
      taskType: resolveTaskTypeSummary("bug"),
    });

    render(
      <TaskDetailMetadata
        task={task}
        parentTask={parentTask}
        onUpdate={vi.fn()}
        onOpenSubtask={onOpenSubtask}
      />
    );

    expect(screen.getByText("Parent")).toBeTruthy();
    expect(screen.getByTestId("parent-task-ref-with-type")).toBeTruthy();
    expect(screen.getByTestId("parent-task-type-glyph").textContent).toBe("Bug");
    expect(screen.getByText("OS-42")).toBeTruthy();
    expect(screen.getByText("Parent task")).toBeTruthy();

    const parentRowButton = screen.getByText("Parent task").closest("button");
    expect(parentRowButton).toBeTruthy();
    fireEvent.click(parentRowButton!);

    expect(onOpenSubtask).toHaveBeenCalledWith(parentTask.clientId);
  });

  test("omits the parent row when parent navigation is unavailable", () => {
    const task = createTask({ parentId: "task_parent" });
    const parentTask = createTask({
      _id: "task_parent" as Task["_id"],
      clientId: "task_parent",
      refId: "OS-42",
      name: "Parent task",
    });

    const { rerender } = render(
      <TaskDetailMetadata
        task={task}
        parentTask={parentTask}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.queryByText("Parent")).toBeNull();

    rerender(
      <TaskDetailMetadata
        task={createTask()}
        onUpdate={vi.fn()}
        onOpenSubtask={vi.fn()}
      />
    );

    expect(screen.queryByText("Parent")).toBeNull();
  });

  test("renders the Tags row below Due date when route context is available", () => {
    useQueryMock.mockReturnValue([]);

    render(
      <TaskDetailMetadata
        task={createTask()}
        projectId={projectId}
        organizationSlug="contoso"
        projectAlias="OS"
        onUpdate={vi.fn()}
      />
    );

    const assigneeLabel = screen.getByText("Assignee");
    const threadsLabel = screen.getAllByText("Threads")[0];
    const dueDateLabel = screen.getByText("Due date");
    const tagsLabel = screen.getByText("Tags");
    const createdLabel = screen.getByText("Created");

    expect(assigneeLabel.compareDocumentPosition(threadsLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(threadsLabel.compareDocumentPosition(dueDateLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dueDateLabel.compareDocumentPosition(tagsLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tagsLabel.compareDocumentPosition(createdLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("renders metadata rows with List between Parent and Type", () => {
    const task = createTask({
      parentId: "task_parent",
      list: {
        type: "list",
        id: "list_1" as Id<"taskLists">,
        ref: "SPRINT",
        name: "Sprint",
        isArchived: false,
      },
    });
    const parentTask = createTask({
      _id: "task_parent" as Task["_id"],
      clientId: "task_parent",
      refId: "OS-42",
      name: "Parent task",
    });

    render(
      <TaskDetailMetadata
        task={task}
        parentTask={parentTask}
        onUpdate={vi.fn()}
        onOpenSubtask={vi.fn()}
      />
    );

    const labels = ["Parent", "List", "Type", "Status", "Priority", "Assignee", "Due date", "Tags", "Created"];
    const nodes = labels.map((label) => screen.getByText(label));

    for (let i = 0; i < nodes.length - 1; i++) {
      expect(
        nodes[i].compareDocumentPosition(nodes[i + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  test("renders persisted, default, Backlog, and Archived List values", () => {
    const taskListResultsController = {
      results: [defaultTaskListItemFixture, taskListItemFixture],
    } as unknown as TaskListResultsController;
    const { rerender } = render(
      <TaskDetailMetadata
        task={createTask({
          list: {
            type: "list",
            id: "list_1" as Id<"taskLists">,
            ref: "ROADMAP",
            name: "Roadmap",
            isArchived: false,
          },
        })}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByText("Roadmap")).toBeTruthy();

    rerender(
      <TaskDetailMetadata
        task={createTask()}
        onUpdate={vi.fn()}
        taskListResultsController={taskListResultsController}
      />
    );
    expect(screen.getByText("Sprint 12")).toBeTruthy();
    expect(screen.queryByText("Inbox")).toBeNull();

    rerender(
      <TaskDetailMetadata
        task={createTask({
          list: {
            type: "system",
            key: "backlog",
            ref: "BACKLOG",
            name: "Backlog",
          },
        })}
        onUpdate={vi.fn()}
      />
    );
    expect(screen.getAllByText("Backlog").length).toBeGreaterThan(0);

    rerender(
      <TaskDetailMetadata
        task={createTask({ isArchived: true })}
        onUpdate={vi.fn()}
        projectId={projectId}
        onMoveToList={vi.fn()}
      />
    );
    expect(screen.getByText("Archived")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move to Sprint 1" })).toBeNull();
  });

  test("renders archived List identity from the task payload", () => {
    render(
      <TaskDetailMetadata
        task={createTask({
          list: {
            type: "list",
            id: "list_1" as Id<"taskLists">,
            ref: "ARCHIVED-SPRINT",
            name: "Archived Sprint",
            isArchived: true,
          },
        })}
        projectId={projectId}
        onUpdate={vi.fn()}
        onMoveToList={vi.fn()}
      />
    );

    expect(screen.getByText("Archived Sprint")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Archived Sprint/i })).toBeTruthy();
  });

  test("optimistically renders Backlog when moving from a persisted List", () => {
    const onMoveToList = vi.fn();
    render(
      <TaskDetailMetadata
        task={createTask({
          list: {
            type: "list",
            id: "list_1" as Id<"taskLists">,
            ref: "SPRINT-1",
            name: "Sprint 1",
            isArchived: false,
          },
        })}
        projectId={projectId}
        onUpdate={vi.fn()}
        onMoveToList={onMoveToList}
      />
    );

    expect(screen.getByRole("button", { name: /^Sprint 1$/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Backlog" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));

    expect(onMoveToList).toHaveBeenCalledWith("task_1", "BACKLOG");
    expect(screen.getAllByRole("button", { name: "Backlog" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Sprint 1$/ })).toBeNull();
  });

  test("renders task archive state instead of the default List without membership", () => {
    const taskListResultsController = {
      results: [defaultTaskListItemFixture, taskListItemFixture],
    } as unknown as TaskListResultsController;

    render(
      <TaskDetailMetadata
        task={createTask({ isArchived: true, list: null })}
        projectId={projectId}
        onUpdate={vi.fn()}
        onMoveToList={vi.fn()}
        taskListResultsController={taskListResultsController}
      />
    );

    expect(screen.getByText("Archived")).toBeTruthy();
    expect(screen.queryByText("Sprint 12")).toBeNull();
  });

  test("moves task to selected List and previews the selected value", () => {
    const onMoveToList = vi.fn();
    const resetQuery = vi.fn();
    const taskListResultsController = {
      query: "",
      results: [defaultTaskListItemFixture, taskListItemFixture, secondTaskListItemFixture],
      resetQuery,
    } as unknown as TaskListResultsController;

    render(
      <TaskDetailMetadata
        task={createTask()}
        projectId={projectId}
        onUpdate={vi.fn()}
        taskListResultsController={taskListResultsController}
        onMoveToList={onMoveToList}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Move to Sprint 1" }));

    expect(taskListPickerMock).toHaveBeenCalledWith({
      resultsController: taskListResultsController,
      showRowActions: false,
    });
    expect(onMoveToList).toHaveBeenCalledWith("task_1", "SPRINT-1");
    expect(screen.getByText("Sprint 1")).toBeTruthy();
    expect(resetQuery).toHaveBeenCalledOnce();
  });

  test("keeps the newest optimistic List visible until the server catches up", () => {
    const { rerender } = render(
      <TaskDetailMetadata
        task={createTask()}
        projectId={projectId}
        onUpdate={vi.fn()}
        onMoveToList={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Move to Sprint 2" }));
    expect(screen.getByText("Sprint 2")).toBeTruthy();

    rerender(
      <TaskDetailMetadata
        task={createTask({
          list: {
            type: "list",
            id: "list_2" as Id<"taskLists">,
            ref: "SPRINT-1",
            name: "Sprint 1",
            isArchived: false,
          },
        })}
        projectId={projectId}
        onUpdate={vi.fn()}
        onMoveToList={vi.fn()}
      />
    );

    expect(screen.getByText("Sprint 2")).toBeTruthy();
  });

  test("renders the Tags row and forwards tag updates", () => {
    const onUpdate = vi.fn();

    render(
      <TaskDetailMetadata
        task={createTask({ tags: ["backend"] })}
        onUpdate={onUpdate}
      />
    );

    expect(screen.getByText("Tags")).toBeTruthy();
    expect(screen.getByTestId("task-tags-editor").textContent).toBe("backend");

    fireEvent.click(screen.getByRole("button", { name: "update-tags" }));

    expect(onUpdate).toHaveBeenCalledWith("task_1", { tags: ["updated-tag"] });
  });

  test("does not apply a negative vertical offset to the tags editor", () => {
    render(
      <TaskDetailMetadata
        task={createTask({ tags: ["backend", "release"] })}
        onUpdate={vi.fn()}
      />
    );

    const editorContainer = screen.getByTestId("task-tags-editor-container");
    expect(editorContainer.className).toContain("flex-1");
    expect(editorContainer.className).not.toContain("-mt-");
  });

  test.each([
    {
      threads: [],
      role: "text" as const,
      label: "No threads",
    },
    {
      threads: [
        {
          _id: "thread_1",
          title: "Fix flaky thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          lastActivityAt: Date.now(),
        },
      ],
      role: "link" as const,
      label: "Fix flaky thread",
    },
    {
      threads: [
        {
          _id: "thread_1",
          title: "First thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          lastActivityAt: Date.now(),
        },
        {
          _id: "thread_2",
          title: "Second thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          lastActivityAt: Date.now() - 1000,
        },
      ],
      // Every associated thread is a row now — no count trigger (OS-1803).
      role: "text" as const,
      label: "Second thread",
    },
  ])("renders the trigger label for $label", ({ threads, role, label }) => {
    useQueryMock.mockReturnValue(threads);

    render(
      <TaskDetailMetadata
        task={createTask()}
        projectId={projectId}
        organizationSlug="contoso"
        projectAlias="OS"
        onUpdate={vi.fn()}
      />
    );

    if (role === "text") {
      expect(screen.getByText(label)).toBeTruthy();
      return;
    }

    if (role === "link") {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByRole("link", { name: /^Open thread /i })).toBeTruthy();
      return;
    }

    expect(screen.getByRole(role, { name: label })).toBeTruthy();
  });

  test("renders a threads composer button when route context is provided", () => {
    useQueryMock.mockReturnValue([]);
    const onOpenThreadsComposer = vi.fn();

    render(
      <TaskDetailMetadata
        task={createTask()}
        projectId={projectId}
        organizationSlug="contoso"
        projectAlias="OS"
        onUpdate={vi.fn()}
        onOpenThreadsComposer={onOpenThreadsComposer}
      />
    );

    const composerButton = screen.getByRole("button", {
      name: "Open threads composer",
    });
    expect(composerButton).toBeTruthy();
    fireEvent.click(composerButton);
    expect(onOpenThreadsComposer).toHaveBeenCalledOnce();
  });

  test("omits the Threads row when route context is unavailable", () => {
    render(
      <TaskDetailMetadata
        task={createTask()}
        projectId={projectId}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.queryByText("Threads")).toBeNull();
  });

  test("passes closed-title styling to the title editor for canceled tasks", () => {
    render(
      <TaskDetailMetadata
        task={createTask({ status: Status.CANCELED })}
        onUpdate={vi.fn()}
      />
    );

    expect(taskTitleEditorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "Current task",
        isClosed: true,
      })
    );
  });

  test("edits priority with the shared searchable priority picker", () => {
    const onUpdate = vi.fn();
    const task = createTask({ priority: "Low" });
    render(<TaskDetailMetadata task={task} projectId={projectId} onUpdate={onUpdate} />);

    expect(screen.getByPlaceholderText("Search priorities...")).toBeTruthy();
    const current = screen.getAllByRole("button").find((button) => button.getAttribute("data-value") === "Low");
    expect(current?.getAttribute("data-checked")).toBe("true");
    const high = screen.getAllByRole("button").find((button) => button.getAttribute("data-value") === "High");
    fireEvent.click(high!);
    expect(onUpdate).toHaveBeenCalledWith(task._id, { priority: "High" });
  });

  test("renders the Label row with 'Add label' when the task has no label", () => {
    render(<TaskDetailMetadata task={createTask()} projectId={projectId} onUpdate={vi.fn()} />);

    expect(screen.getByText("Label")).toBeTruthy();
    expect(screen.getByText("Add label")).toBeTruthy();
  });

  test("renders the current label chip and forwards picker selections as labelId updates", () => {
    const labelId = "label_1" as Id<"projectLabels">;
    const label = { _id: labelId, name: "Q1", color: "#ef4444", rank: "0|a" };
    useProjectLabelsMock.mockReturnValue({
      labels: [label],
      labelsById: new Map([[String(labelId), label]]),
      isLoading: false,
    });
    const onUpdate = vi.fn();
    const task = createTask({ labelId });

    render(<TaskDetailMetadata task={task} projectId={projectId} onUpdate={onUpdate} />);

    // The chip renders inside the trigger button (the picker list may also
    // contain a "Q1" entry, so scope to the button).
    const trigger = screen
      .getAllByText("Q1")
      .map((element) => element.closest("button"))
      .find((button): button is HTMLButtonElement => button !== null);
    expect(trigger).toBeTruthy();

    fireEvent.click(trigger!);
    fireEvent.click(screen.getByText("No label"));

    expect(onUpdate).toHaveBeenCalledWith(task._id, { labelId: null });
  });

  test("a read-only viewer sees every value but no editor (docs/specs/read-only-viewer-ux.md)", () => {
    const reason = "You have view-only access to this project";
    const onUpdate = vi.fn();
    useQueryMock.mockReturnValue([]);

    render(
      <TaskDetailMetadata
        task={createTask({
          priority: "High",
          list: {
            type: "list",
            id: "list_2" as Id<"taskLists">,
            ref: "SPRINT-1",
            name: "Sprint 1",
            isArchived: false,
          },
        })}
        projectId={projectId}
        organizationSlug="contoso"
        projectAlias="OS"
        onUpdate={onUpdate}
        onMoveToList={vi.fn()}
        onOpenThreadsComposer={vi.fn()}
        readOnlyReason={reason}
        canUseThreads={false}
      />
    );

    expect(taskTitleEditorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ readOnly: true })
    );
    // Values stay legible as plain text, each row explains why it is inert.
    for (const value of [Status.TODO, "High", "Sprint 1", "Task"]) {
      expect(screen.queryByRole("button", { name: value })).toBeNull();
      expect(screen.getAllByText(value)[0].closest(`[title="${reason}"]`)).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: /move to sprint 1/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add label/i })).toBeNull();
    expect(screen.getByText("assignee-selector").dataset.disabled).toBe("true");
    expect((screen.getByRole("button", { name: "date-picker" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("task-tags-editor-container").dataset.readonly).toBe("true");
    // Threads need CLI access a viewer lacks.
    expect(screen.queryByRole("button", { name: "Open threads composer" })).toBeNull();
  });

  test("a due-date suggestion left open when the role drops to viewer saves nothing", () => {
    const onUpdate = vi.fn();
    const { rerender } = render(
      <TaskDetailMetadata task={createTask()} projectId={projectId} onUpdate={onUpdate} />
    );
    rerender(
      <TaskDetailMetadata
        task={createTask()}
        projectId={projectId}
        onUpdate={onUpdate}
        readOnlyReason="You have view-only access to this project"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "open-suggestion" }));

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
