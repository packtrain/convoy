/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);
import type { Row } from "@tanstack/react-table";
import { Priority, Status, type Task } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { MemoizedTaskRow, type TaskRowProps } from "./task-row";

const contextMenuProps = vi.hoisted(() => [] as { readOnly?: boolean }[]);

vi.mock("./task-context-menu", () => ({
  TaskContextMenu: ({ children, ...props }: { children: ReactNode; readOnly?: boolean }) => {
    contextMenuProps.push(props);
    return <div>{children}</div>;
  },
}));

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    delegatedToAgent: null,
    _id: "task_1" as Task["_id"],
    clientId: "client-1",
    refNumber: 1,
    refId: "OS-1",
    name: "Test task",
    description: null,
    taskType: getDefaultTaskTypeSummary(),
    priority: Priority.NONE,
    dueDate: null,
    status: Status.TODO,
    tags: [],
    rank: "0|a",
    parentId: null,
    createdAt: 1,
    isArchived: false,
    ...overrides,
    assignee: overrides.assignee ?? null,
  };
}

function createRow(): Row<Task> {
  const original = createTask();
  return {
    original,
    getVisibleCells: () => [
      {
        id: "drag-cell",
        column: {
          id: "drag",
          columnDef: {
            cell: () => null,
          },
        },
        getContext: () => ({}),
      },
      {
        id: "name-cell",
        column: {
          id: "name",
          columnDef: {
            cell: () => <input aria-label="Task name" data-task-input />,
          },
        },
        getContext: () => ({}),
      },
      {
        id: "priority-cell",
        column: {
          id: "priority",
          columnDef: {
            cell: () => (
              <button type="button" data-task-field-drag aria-label="Priority" />
            ),
          },
        },
        getContext: () => ({}),
      },
    ],
  } as unknown as Row<Task>;
}

function renderRow(overrides: Partial<TaskRowProps> = {}) {
  const props: TaskRowProps = {
    row: createRow(),
    virtualStart: 0,
    virtualSize: 44,
    statusOptionsVersion: "To Do|Done",
    isDragging: false,
    dropIndicator: null,
    isSelected: false,
    isDndEnabled: true,
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDragEnd: vi.fn(),
    onDrop: vi.fn(),
    onMobileDragPointerDown: vi.fn(),
    onMobileContextMenu: vi.fn(),
    shouldSuppressNextClick: vi.fn(() => false),
    onRowClick: vi.fn(),
    onSelectRow: vi.fn(),
    onContextMenuSelectRow: vi.fn(),
    onDelete: vi.fn(),
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    onDuplicate: vi.fn(),
    onUpdateStatus: vi.fn(),
    onOpenDetails: vi.fn(),
    registerRow: vi.fn(),
    readOnly: false,
    ...overrides,
    visibleColumnsVersion: overrides.visibleColumnsVersion ?? "all",
  };

  const result = render(<MemoizedTaskRow {...props} />);
  return { ...result, props };
}

describe("MemoizedTaskRow drag behavior", () => {
  test("starts drag from the handle but not from the task name input", () => {
    const { props, container } = renderRow();
    const input = screen.getByLabelText("Task name");
    const handle = container.querySelector("[data-drag-handle]");

    expect(handle).toBeInstanceOf(HTMLButtonElement);
    expect(input.closest('[role="row"]')?.getAttribute("draggable")).not.toBe("true");
    expect(handle?.getAttribute("draggable")).toBe("true");

    fireEvent.dragStart(input);
    expect(props.onDragStart).not.toHaveBeenCalled();

    fireEvent.dragStart(handle as HTMLElement);
    expect(props.onDragStart).toHaveBeenCalledTimes(1);
    expect(props.onDragStart).toHaveBeenCalledWith(expect.any(Object), "client-1");
  });

  test("the drag handle is named and shows on keyboard focus", () => {
    renderRow();
    const handle = screen.getByRole("button", { name: "Drag to reorder" });

    expect(handle.querySelector("svg")?.getAttribute("class")).toContain("group-focus-within:opacity-100");
  });

  test("arms native row drag from a task-field trigger press (OS-1381)", () => {
    const { props } = renderRow();
    const trigger = screen.getByLabelText("Priority");

    // Not draggable at rest; a mouse press arms it for the gesture.
    expect(trigger.getAttribute("draggable")).not.toBe("true");
    fireEvent.pointerDown(trigger, {
      pointerType: "mouse",
      button: 0,
      isPrimary: true,
    });
    expect(trigger.draggable).toBe(true);

    fireEvent.dragStart(trigger);
    expect(props.onDragStart).toHaveBeenCalledTimes(1);
    expect(props.onDragStart).toHaveBeenCalledWith(expect.any(Object), "client-1");

    // Release disarms so the trigger does not stay draggable.
    fireEvent.pointerUp(window);
    expect(trigger.draggable).toBe(false);
  });

  test("does not arm task-field drag on touch or when DnD is disabled", () => {
    const { container } = renderRow({ isDndEnabled: false });
    const trigger = screen.getByLabelText("Priority");

    fireEvent.pointerDown(trigger, {
      pointerType: "mouse",
      button: 0,
      isPrimary: true,
    });
    expect(trigger.draggable).toBe(false);
    expect(container).toBeTruthy();

    const enabled = renderRow();
    const enabledTrigger = enabled.container.querySelector(
      "[data-task-field-drag]"
    ) as HTMLButtonElement;
    fireEvent.pointerDown(enabledTrigger, {
      pointerType: "touch",
      button: 0,
      isPrimary: true,
    });
    expect(enabledTrigger.draggable).toBe(false);
  });
});

test("passes read-only to the row context menu", () => {
  renderRow({ readOnly: true });
  expect(contextMenuProps.at(-1)?.readOnly).toBe(true);
});
