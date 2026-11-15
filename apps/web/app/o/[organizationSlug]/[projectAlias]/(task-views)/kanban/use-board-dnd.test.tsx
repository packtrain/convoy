/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useBoardDnd, type BoardDndColumnInput } from "./use-board-dnd";
import {
  boardCardDropId,
  boardCardIntoDropId,
  boardColumnBodyDropId,
  boardTaskDragId,
} from "./board-dnd-planning";
import type { DragEndEvent, DragStartEvent, KeyboardSensorOptions } from "@dnd-kit/core";
import { createDefaultTask } from "@/lib/tasks/defaults";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { Status } from "@/lib/tasks/status";
import type { Id } from "@/convex/_generated/dataModel";
import type { Task } from "@/lib/tasks/types";

afterEach(cleanup);

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    _id: id as Id<"tasks">,
    clientId: id,
    ...createDefaultTask({
      refNumber: 1,
      refId: "OS-1",
      name: `Task ${id}`,
      description: null,
      status: Status.TODO,
      taskType: resolveTaskTypeSummary("task"),
      priority: "None",
      rank: "a0",
    }),
    ...overrides,
  };
}

function makeColumns(): BoardDndColumnInput[] {
  return [
    {
      id: "todo",
      cards: [{ task: makeTask("a") }, { task: makeTask("b") }],
      dropTarget: { status: Status.TODO },
    },
    {
      id: "in-progress",
      cards: [],
      dropTarget: { status: Status.IN_PROGRESS },
    },
  ];
}

function dragStartEvent(taskId: string): DragStartEvent {
  return { active: { id: boardTaskDragId(taskId) } } as DragStartEvent;
}

function dragEndEvent(taskId: string, overId: string | null): DragEndEvent {
  return {
    active: { id: boardTaskDragId(taskId) },
    over: overId ? { id: overId } : null,
  } as DragEndEvent;
}

describe("useBoardDnd", () => {
  test("is disabled without a reorder handler", () => {
    const { result } = renderHook(() => useBoardDnd({ columns: makeColumns() }));

    expect(result.current.isDragEnabled).toBe(false);
  });

  test("registers a mouse-style pointer sensor and a long-press touch sensor", () => {
    const { result } = renderHook(() =>
      useBoardDnd({ columns: makeColumns(), onTaskReorder: vi.fn() })
    );

    const [pointerSensor, touchSensor] = result.current.sensors;

    expect(pointerSensor.options).toEqual({
      activationConstraint: { distance: 5 },
    });
    expect(touchSensor.options).toEqual({
      activationConstraint: { delay: 400, tolerance: 10 },
    });

    const pointerActivator = pointerSensor.sensor.activators[0]
      .handler as (event: {
      nativeEvent: Record<string, unknown>;
    }) => boolean;
    const cardTarget = document.createElement("div");
    const buttonTarget = document.createElement("button");

    // Touch pointers defer to the touch sensor; mouse drags activate unless
    // they start on an interactive control.
    expect(
      pointerActivator({
        nativeEvent: {
          isPrimary: true,
          button: 0,
          pointerType: "touch",
          target: cardTarget,
        },
      })
    ).toBe(false);
    expect(
      pointerActivator({
        nativeEvent: {
          isPrimary: true,
          button: 0,
          pointerType: "mouse",
          target: cardTarget,
        },
      })
    ).toBe(true);
    expect(
      pointerActivator({
        nativeEvent: {
          isPrimary: true,
          button: 0,
          pointerType: "mouse",
          target: buttonTarget,
        },
      })
    ).toBe(false);

    // Task-field selector triggers (type, status, priority, assignee) defer
    // their menu open to click, so a mouse press on them may lift the card
    // (OS-1381). The marker also covers icons nested inside the trigger.
    const fieldTrigger = document.createElement("button");
    fieldTrigger.setAttribute("data-task-field-drag", "");
    const fieldTriggerIcon = document.createElement("span");
    fieldTrigger.appendChild(fieldTriggerIcon);
    expect(
      pointerActivator({
        nativeEvent: {
          isPrimary: true,
          button: 0,
          pointerType: "mouse",
          target: fieldTriggerIcon,
        },
      })
    ).toBe(true);

    // Touch drags may start anywhere on the card, including footer controls:
    // a tap still activates the control, only a still long-press lifts.
    const touchActivator = touchSensor.sensor.activators[0]
      .handler as (
      event: { nativeEvent: Record<string, unknown> },
      options: Record<string, unknown>
    ) => boolean;
    expect(
      touchActivator(
        { nativeEvent: { target: cardTarget, touches: [{}] } },
        {}
      )
    ).toBe(true);
    expect(
      touchActivator(
        { nativeEvent: { target: buttonTarget, touches: [{}] } },
        {}
      )
    ).toBe(true);
  });

  test("a mouse press on the card title button still lifts the card", () => {
    const { result } = renderHook(() =>
      useBoardDnd({ columns: makeColumns(), onTaskReorder: vi.fn() })
    );
    const pointerActivator = result.current.sensors[0].sensor.activators[0]
      .handler as (event: { nativeEvent: Record<string, unknown> }) => boolean;
    const title = document.createElement("button");
    title.setAttribute("data-task-card-body", "");
    const text = document.createElement("span");
    title.appendChild(text);

    expect(
      pointerActivator({
        nativeEvent: { isPrimary: true, button: 0, pointerType: "mouse", target: text },
      })
    ).toBe(true);
  });

  test("registers a keyboard sensor that Space starts from the card title only", () => {
    const { result } = renderHook(() =>
      useBoardDnd({ columns: makeColumns(), onTaskReorder: vi.fn() })
    );
    const keyboardSensor = result.current.sensors[2];
    expect((keyboardSensor.options as KeyboardSensorOptions).keyboardCodes).toEqual({
      start: ["Space"],
      cancel: ["Escape"],
      end: ["Space", "Enter"],
    });

    const activator = keyboardSensor.sensor.activators[0].handler as (
      event: { nativeEvent: { code: string }; target: EventTarget; preventDefault: () => void },
      options: Record<string, unknown>,
      context: { active: { activatorNode: { current: null } } }
    ) => boolean;
    const title = document.createElement("button");
    title.setAttribute("data-task-card-body", "");
    const control = document.createElement("button");
    const context = { active: { activatorNode: { current: null } } };
    const press = (target: EventTarget, code: string) =>
      activator(
        { nativeEvent: { code }, target, preventDefault: vi.fn() },
        { ...keyboardSensor.options, onActivation: vi.fn() },
        context
      );

    expect(press(title, "Space")).toBe(true);
    expect(press(title, "Enter")).toBe(false);
    expect(press(control, "Space")).toBe(false);
  });

  test("keyboard drags resolve the drop zone under the card center", () => {
    const { result } = renderHook(() =>
      useBoardDnd({ columns: makeColumns(), onTaskReorder: vi.fn() })
    );
    const zone = (id: string, top: number, height: number) => ({
      id,
      key: id,
      data: { current: undefined },
      disabled: false,
      node: { current: null },
      rect: { current: { top, left: 0, width: 100, height, right: 100, bottom: top + height } },
    });
    // The before zone overlaps the card more, but only the after zone holds its center (y = 40).
    const droppableContainers = [
      zone(boardCardDropId("a", "before"), 0, 38),
      zone(boardCardDropId("a", "after"), 38, 4),
      zone(boardColumnBodyDropId("todo"), 0, 400),
    ];
    const droppableRects = new Map(
      droppableContainers.map((container) => [container.id, container.rect.current])
    );

    const collisions = result.current.collisionDetection({
      active: { id: boardTaskDragId("b"), rect: { current: { initial: { top: 100, left: 0, width: 100, height: 40, right: 100, bottom: 140 }, translated: null } } },
      collisionRect: { top: 20, left: 0, width: 100, height: 40, right: 100, bottom: 60 },
      droppableRects,
      droppableContainers,
      pointerCoordinates: null,
    } as unknown as Parameters<typeof result.current.collisionDetection>[0]);

    expect(collisions[0]?.id).toBe(boardCardDropId("a", "after"));
  });

  test("announces keyboard drags with task names and column titles", () => {
    const columns = makeColumns().map((column) => ({ ...column, title: column.id === "todo" ? "To Do" : "In Progress" }));
    const { result } = renderHook(() => useBoardDnd({ columns, onTaskReorder: vi.fn() }));
    const { announcements } = result.current.accessibility;
    const active = { id: boardTaskDragId("b") } as Parameters<typeof announcements.onDragStart>[0]["active"];

    expect(announcements.onDragStart({ active })).toBe("Picked up Task b.");
    expect(
      announcements.onDragOver({ active, over: { id: boardCardDropId("a", "before") } } as Parameters<typeof announcements.onDragOver>[0])
    ).toBe("Task b is before Task a.");
    expect(
      announcements.onDragEnd({ active, over: { id: boardColumnBodyDropId("in-progress") } } as Parameters<typeof announcements.onDragEnd>[0])
    ).toBe("Task b was dropped in In Progress.");
    expect(announcements.onDragCancel({ active, over: null } as Parameters<typeof announcements.onDragCancel>[0])).toBe(
      "Moving Task b was canceled."
    );
  });

  test("tracks the active card and source column during a drag", () => {
    const { result } = renderHook(() =>
      useBoardDnd({ columns: makeColumns(), onTaskReorder: vi.fn() })
    );

    act(() => result.current.handleDragStart(dragStartEvent("b")));

    expect(result.current.activeItem?.task._id).toBe("b");
    expect(result.current.activeSourceColumnId).toBe("todo");

    act(() => result.current.handleDragCancel());

    expect(result.current.activeItem).toBeNull();
    expect(result.current.activeSourceColumnId).toBeNull();
  });

  test("dispatches same-group drops to onTaskReorder with a null parent", () => {
    const onTaskReorder = vi.fn();
    const onTaskMove = vi.fn();
    const { result } = renderHook(() =>
      useBoardDnd({ columns: makeColumns(), onTaskReorder, onTaskMove })
    );

    act(() =>
      result.current.handleDragEnd(dragEndEvent("b", boardCardDropId("a", "before")))
    );

    expect(onTaskReorder).toHaveBeenCalledWith("b", "a", null, "before");
    expect(onTaskMove).not.toHaveBeenCalled();
  });

  test("dispatches cross-group drops to onTaskMove", () => {
    const onTaskReorder = vi.fn();
    const onTaskMove = vi.fn();
    const { result } = renderHook(() =>
      useBoardDnd({ columns: makeColumns(), onTaskReorder, onTaskMove })
    );

    act(() =>
      result.current.handleDragEnd(
        dragEndEvent("b", boardColumnBodyDropId("in-progress"))
      )
    );

    expect(onTaskMove).toHaveBeenCalledWith(
      "b",
      { status: Status.IN_PROGRESS },
      undefined
    );
    expect(onTaskReorder).not.toHaveBeenCalled();
  });

  test("dispatches card-center drops to onTaskMakeSubtask", () => {
    const onTaskReorder = vi.fn();
    const onTaskMove = vi.fn();
    const onTaskMakeSubtask = vi.fn();
    const { result } = renderHook(() =>
      useBoardDnd({ columns: makeColumns(), onTaskReorder, onTaskMove, onTaskMakeSubtask })
    );

    act(() =>
      result.current.handleDragEnd(dragEndEvent("b", boardCardIntoDropId("a")))
    );

    expect(onTaskMakeSubtask).toHaveBeenCalledWith("b", "a");
    expect(onTaskReorder).not.toHaveBeenCalled();
    expect(onTaskMove).not.toHaveBeenCalled();
  });

  test("ignores card-center drops onto the dragged card itself", () => {
    const onTaskMakeSubtask = vi.fn();
    const { result } = renderHook(() =>
      useBoardDnd({ columns: makeColumns(), onTaskReorder: vi.fn(), onTaskMakeSubtask })
    );

    act(() =>
      result.current.handleDragEnd(dragEndEvent("b", boardCardIntoDropId("b")))
    );

    expect(onTaskMakeSubtask).not.toHaveBeenCalled();
  });

  test("ignores drops without a target or with a no-op plan", () => {
    const onTaskReorder = vi.fn();
    const onTaskMove = vi.fn();
    const { result } = renderHook(() =>
      useBoardDnd({ columns: makeColumns(), onTaskReorder, onTaskMove })
    );

    act(() => result.current.handleDragEnd(dragEndEvent("b", null)));
    act(() =>
      result.current.handleDragEnd(dragEndEvent("b", boardCardDropId("b", "before")))
    );

    expect(onTaskReorder).not.toHaveBeenCalled();
    expect(onTaskMove).not.toHaveBeenCalled();
  });
});
