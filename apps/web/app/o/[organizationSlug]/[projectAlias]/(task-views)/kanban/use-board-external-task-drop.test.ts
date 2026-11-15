/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import {
  getExternalCardDropZone,
  useBoardExternalTaskDrop,
} from "./use-board-external-task-drop";
import { TASK_DRAG_MIME } from "@/lib/tasks/task-drag";

afterEach(cleanup);

const PROJECT_ID = "project-1";
const PROJECT_MIME = `application/x-convoy-tasks-project-${PROJECT_ID}`;

function makeDragEvent({
  types = [TASK_DRAG_MIME, PROJECT_MIME],
  payload,
  clientY = 0,
  targetRect = { top: 0, height: 100 },
}: {
  types?: string[];
  payload?: { projectId: string; taskIds: string[] };
  clientY?: number;
  targetRect?: { top: number; height: number };
} = {}) {
  const dataTransfer = {
    types,
    dropEffect: "none",
    getData: (type: string) =>
      type === TASK_DRAG_MIME && payload ? JSON.stringify(payload) : "",
  };
  const currentTarget = document.createElement("div");
  currentTarget.getBoundingClientRect = () =>
    ({ ...targetRect, left: 0, width: 100 }) as DOMRect;

  return {
    dataTransfer,
    currentTarget,
    relatedTarget: null,
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as DragEvent<HTMLElement> & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
}

describe("useBoardExternalTaskDrop", () => {
  test("returns no drop props without projectId, handler, or column drop target", () => {
    const { result: withoutProject } = renderHook(() =>
      useBoardExternalTaskDrop({ onDropTasks: vi.fn() })
    );
    expect(
      withoutProject.current.getColumnDropProps("todo", { status: "To Do" })
    ).toBeUndefined();

    const { result: withoutHandler } = renderHook(() =>
      useBoardExternalTaskDrop({ projectId: PROJECT_ID })
    );
    expect(
      withoutHandler.current.getColumnDropProps("todo", { status: "To Do" })
    ).toBeUndefined();

    const { result } = renderHook(() =>
      useBoardExternalTaskDrop({ projectId: PROJECT_ID, onDropTasks: vi.fn() })
    );
    expect(result.current.getColumnDropProps("todo", undefined)).toBeUndefined();
  });

  test("accepts same-project drags on dragover and tracks the hovered column", () => {
    const { result } = renderHook(() =>
      useBoardExternalTaskDrop({ projectId: PROJECT_ID, onDropTasks: vi.fn() })
    );
    const props = result.current.getColumnDropProps("todo", { status: "To Do" });

    const event = makeDragEvent();
    act(() => props?.onDragOver(event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.externalDropColumnId).toBe("todo");

    act(() => props?.onDragLeave(makeDragEvent()));
    expect(result.current.externalDropColumnId).toBeNull();
  });

  test("ignores drags without the project marker type", () => {
    const { result } = renderHook(() =>
      useBoardExternalTaskDrop({ projectId: PROJECT_ID, onDropTasks: vi.fn() })
    );
    const props = result.current.getColumnDropProps("todo", { status: "To Do" });

    const event = makeDragEvent({ types: ["text/plain"] });
    act(() => props?.onDragOver(event));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.externalDropColumnId).toBeNull();
  });

  test("drops call the handler with the payload task ids and column field", () => {
    const onDropTasks = vi.fn();
    const { result } = renderHook(() =>
      useBoardExternalTaskDrop({ projectId: PROJECT_ID, onDropTasks })
    );
    const props = result.current.getColumnDropProps("todo", { status: "To Do" });

    act(() =>
      props?.onDrop(
        makeDragEvent({
          payload: { projectId: PROJECT_ID, taskIds: ["task-1", "task-2"] },
        })
      )
    );

    expect(onDropTasks).toHaveBeenCalledWith(["task-1", "task-2"], {
      status: "To Do",
    });
  });

  test("ignores drops with a foreign or malformed payload", () => {
    const onDropTasks = vi.fn();
    const { result } = renderHook(() =>
      useBoardExternalTaskDrop({ projectId: PROJECT_ID, onDropTasks })
    );
    const props = result.current.getColumnDropProps("todo", { status: "To Do" });

    act(() =>
      props?.onDrop(
        makeDragEvent({ payload: { projectId: "other-project", taskIds: ["task-1"] } })
      )
    );
    act(() => props?.onDrop(makeDragEvent()));

    expect(onDropTasks).not.toHaveBeenCalled();
  });
});

describe("getExternalCardDropZone", () => {
  test("splits the card into before/into/after bands (25/50/25)", () => {
    const rect = { top: 100, height: 100 };

    expect(getExternalCardDropZone(rect, 110)).toBe("before");
    expect(getExternalCardDropZone(rect, 130)).toBe("into");
    expect(getExternalCardDropZone(rect, 170)).toBe("into");
    expect(getExternalCardDropZone(rect, 190)).toBe("after");
  });
});

describe("useBoardExternalTaskDrop card zones", () => {
  function renderCardHook() {
    const onDropTasks = vi.fn();
    const onDropTasksInto = vi.fn();
    const hook = renderHook(() =>
      useBoardExternalTaskDrop({ projectId: PROJECT_ID, onDropTasks, onDropTasksInto })
    );
    return { hook, onDropTasks, onDropTasksInto };
  }

  test("returns no card props without the into handler or a column drop target", () => {
    const { result } = renderHook(() =>
      useBoardExternalTaskDrop({ projectId: PROJECT_ID, onDropTasks: vi.fn() })
    );
    expect(result.current.getCardDropProps("task-1", { status: "To Do" })).toBeUndefined();

    const { hook } = renderCardHook();
    expect(hook.result.current.getCardDropProps("task-1", undefined)).toBeUndefined();
  });

  test("tracks the hovered card zone on dragover and stops propagation", () => {
    const { hook } = renderCardHook();
    const props = hook.result.current.getCardDropProps("task-1", { status: "To Do" });

    const event = makeDragEvent({ clientY: 50 });
    act(() => props?.onDragOver(event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(hook.result.current.externalCardTarget).toEqual({
      taskId: "task-1",
      zone: "into",
    });

    act(() => props?.onDragOver(makeDragEvent({ clientY: 10 })));
    expect(hook.result.current.externalCardTarget).toEqual({
      taskId: "task-1",
      zone: "before",
    });

    act(() => props?.onDragLeave(makeDragEvent()));
    expect(hook.result.current.externalCardTarget).toBeNull();
  });

  test("edge drops call onDropTasks with a rank target", () => {
    const { hook, onDropTasks, onDropTasksInto } = renderCardHook();
    const props = hook.result.current.getCardDropProps("task-1", { status: "To Do" });

    act(() =>
      props?.onDrop(
        makeDragEvent({
          clientY: 90,
          payload: { projectId: PROJECT_ID, taskIds: ["sub-1"] },
        })
      )
    );

    expect(onDropTasks).toHaveBeenCalledWith(
      ["sub-1"],
      { status: "To Do" },
      { targetTaskId: "task-1", position: "after" }
    );
    expect(onDropTasksInto).not.toHaveBeenCalled();
  });

  test("center drops call onDropTasksInto with the card as parent", () => {
    const { hook, onDropTasks, onDropTasksInto } = renderCardHook();
    const props = hook.result.current.getCardDropProps("task-1", { status: "To Do" });

    act(() =>
      props?.onDrop(
        makeDragEvent({
          clientY: 50,
          payload: { projectId: PROJECT_ID, taskIds: ["sub-1", "sub-2"] },
        })
      )
    );

    expect(onDropTasksInto).toHaveBeenCalledWith(["sub-1", "sub-2"], "task-1");
    expect(onDropTasks).not.toHaveBeenCalled();
  });

  test("card drops clear the column highlight", () => {
    const { hook } = renderCardHook();
    const columnProps = hook.result.current.getColumnDropProps("todo", { status: "To Do" });
    const cardProps = hook.result.current.getCardDropProps("task-1", { status: "To Do" });

    act(() => columnProps?.onDragOver(makeDragEvent()));
    expect(hook.result.current.externalDropColumnId).toBe("todo");

    act(() =>
      cardProps?.onDrop(
        makeDragEvent({
          clientY: 50,
          payload: { projectId: PROJECT_ID, taskIds: ["sub-1"] },
        })
      )
    );

    expect(hook.result.current.externalDropColumnId).toBeNull();
    expect(hook.result.current.externalCardTarget).toBeNull();
  });
});
