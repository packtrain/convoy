/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setTaskDragPayload, type TaskDragPayload } from "@/lib/tasks/task-drag";
import { ThreadComposerTaskDropZone } from "./thread-composer-task-drop-zone";

function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    dropEffect: "none",
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
  } as unknown as DataTransfer;
}

function taskDataTransfer(payload: TaskDragPayload): DataTransfer {
  const dataTransfer = createDataTransfer();
  setTaskDragPayload(dataTransfer, payload);
  return dataTransfer;
}

function renderZone(props: Partial<Parameters<typeof ThreadComposerTaskDropZone>[0]> = {}) {
  const onDropTask = vi.fn();
  render(
    <ThreadComposerTaskDropZone
      projectId="project_1"
      onDropTask={onDropTask}
      {...props}
    >
      <div data-testid="composer">composer</div>
    </ThreadComposerTaskDropZone>
  );
  const zone = screen.getByTestId("composer").parentElement as HTMLElement;
  return { onDropTask, zone };
}

describe("ThreadComposerTaskDropZone", () => {
  afterEach(cleanup);

  test("shows the overlay on dragover and attaches the first root task on drop", () => {
    const { onDropTask, zone } = renderZone();
    const dataTransfer = taskDataTransfer({
      projectId: "project_1",
      taskIds: ["task_1", "task_2"],
      taskRefIds: ["OS-1", "OS-2"],
    });

    fireEvent.dragOver(zone, { dataTransfer });
    expect(
      screen.getByTestId("thread-composer-task-drop-overlay")
    ).toBeDefined();

    const dropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    }) as Event & { dataTransfer?: DataTransfer };
    dropEvent.dataTransfer = dataTransfer;
    const stopPropagation = vi.spyOn(dropEvent, "stopPropagation");
    fireEvent(zone, dropEvent);

    expect(onDropTask).toHaveBeenCalledWith({ id: "task_1", refId: "OS-1" });
    expect(dropEvent.defaultPrevented).toBe(true);
    expect(stopPropagation).toHaveBeenCalled();
    expect(
      screen.queryByTestId("thread-composer-task-drop-overlay")
    ).toBeNull();
  });

  test("ignores drags for another project and file drags", () => {
    const { onDropTask, zone } = renderZone();

    const foreignProject = taskDataTransfer({
      projectId: "project_2",
      taskIds: ["task_1"],
      taskRefIds: ["OS-1"],
    });
    fireEvent.dragOver(zone, { dataTransfer: foreignProject });
    expect(
      screen.queryByTestId("thread-composer-task-drop-overlay")
    ).toBeNull();
    fireEvent.drop(zone, { dataTransfer: foreignProject });
    expect(onDropTask).not.toHaveBeenCalled();

    const files = createDataTransfer();
    files.setData("Files", "");
    fireEvent.dragOver(zone, { dataTransfer: files });
    expect(
      screen.queryByTestId("thread-composer-task-drop-overlay")
    ).toBeNull();
  });

  test("bails silently when the payload has no refIds", () => {
    const { onDropTask, zone } = renderZone();
    const dataTransfer = taskDataTransfer({
      projectId: "project_1",
      taskIds: ["task_1"],
    });

    fireEvent.drop(zone, { dataTransfer });
    expect(onDropTask).not.toHaveBeenCalled();
  });

  test("is inert when disabled", () => {
    const { onDropTask, zone } = renderZone({ disabled: true });
    const dataTransfer = taskDataTransfer({
      projectId: "project_1",
      taskIds: ["task_1"],
      taskRefIds: ["OS-1"],
    });

    fireEvent.dragOver(zone, { dataTransfer });
    expect(
      screen.queryByTestId("thread-composer-task-drop-overlay")
    ).toBeNull();
    fireEvent.drop(zone, { dataTransfer });
    expect(onDropTask).not.toHaveBeenCalled();
  });
});
