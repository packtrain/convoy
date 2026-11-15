/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Priority, Status, type Task, type TaskTreeNode } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { RESOURCE_DRAG_MIME } from "@/lib/tasks/resource-drag";
import { useTableDnd } from "./use-table-dnd";

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

function renderDndHarness() {
  const reorderTasks = vi.fn();
  const reorderMultiple = vi.fn();
  const setParent = vi.fn();
  const setParentMultiple = vi.fn();
  const tasks = [
    createTask(),
    createTask({
      _id: "task_2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Second task",
      rank: "0|b",
    }),
  ];

  function Harness({ isDndEnabled }: { isDndEnabled: boolean }) {
    const dnd = useTableDnd({
      tasks,
      taskTree: tasks as TaskTreeNode[],
      selectedIds: new Set(),
      isDndEnabled,
      reorderTasks,
      reorderMultiple,
      setParent,
      setParentMultiple,
    });

    return (
      <div data-task-table-scroll-container>
        <div
          data-testid="row-1"
          data-task-row-id="client-1"
          onPointerDown={(event) =>
            dnd.handleMobileDragPointerDown(event, "client-1")
          }
          onContextMenuCapture={dnd.handleMobileContextMenu}
        >
          {dnd.draggedId === "client-1" ? "dragging" : "idle"}
          <input aria-label="Task name" data-task-input />
          <button data-testid="row-1-button" type="button">action</button>
          <button data-testid="row-1-priority" type="button" data-task-field-drag>
            priority
          </button>
          <button data-testid="row-1-card-title" type="button" data-task-card-body>
            title
          </button>
        </div>
        <div data-testid="row-2" data-task-row-id="client-2">
          target
        </div>
      </div>
    );
  }

  const view = render(<Harness isDndEnabled />);

  return {
    disableDnd: () => view.rerender(<Harness isDndEnabled={false} />),
    reorderTasks,
    reorderMultiple,
    setParent,
    setParentMultiple,
  };
}

describe("useTableDnd mobile long-press drag", () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("starts a mobile drag after a 450 ms row long press and drops on the target row", async () => {
    const { reorderTasks } = renderDndHarness();
    const row1 = screen.getByTestId("row-1");
    const row2 = screen.getByTestId("row-2");

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => row2),
    });
    vi.spyOn(row2, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 44,
      left: 0,
      right: 300,
      width: 300,
      height: 44,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(row1, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(screen.getByText("dragging")).toBeTruthy();

    fireEvent.pointerUp(window, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    expect(reorderTasks).toHaveBeenCalledWith("task_1", "task_2", null, "before");
  });

  test("an active mobile drag drops nothing once DnD is disabled (write access lost)", async () => {
    const { reorderTasks, disableDnd } = renderDndHarness();
    const row1 = screen.getByTestId("row-1");
    const row2 = screen.getByTestId("row-2");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => row2),
    });
    vi.spyOn(row2, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 44, left: 0, right: 300, width: 300, height: 44, x: 0, y: 0, toJSON: () => ({}),
    });
    const pointer = { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 10, clientY: 10 };

    fireEvent.pointerDown(row1, pointer);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    disableDnd();
    fireEvent.pointerUp(window, pointer);

    expect(reorderTasks).not.toHaveBeenCalled();
    expect(screen.getByText("idle")).toBeTruthy();
  });

  test("cancels mobile drag activation when the pointer moves before the delay", async () => {
    const { reorderTasks } = renderDndHarness();
    const row1 = screen.getByTestId("row-1");

    fireEvent.pointerDown(row1, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 25,
      clientY: 10,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(screen.getByText("idle")).toBeTruthy();
    expect(reorderTasks).not.toHaveBeenCalled();
  });

  test("starts mobile drag from the task name input after long press", async () => {
    renderDndHarness();
    const input = screen.getByLabelText("Task name");

    fireEvent.pointerDown(input, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(screen.getByText("dragging")).toBeTruthy();
  });

  test("starts mobile drag from a task-field trigger after long press (OS-1381)", async () => {
    renderDndHarness();
    const trigger = screen.getByTestId("row-1-priority");

    fireEvent.pointerDown(trigger, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(screen.getByText("dragging")).toBeTruthy();
  });

  test("starts mobile drag from a mobile card's title button after long press", async () => {
    renderDndHarness();
    const title = screen.getByTestId("row-1-card-title");

    fireEvent.pointerDown(title, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(screen.getByText("dragging")).toBeTruthy();
  });

  test("does not start mobile drag from interactive row controls (buttons)", async () => {
    const { reorderTasks } = renderDndHarness();
    const button = screen.getByTestId("row-1-button");

    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(screen.getByText("idle")).toBeTruthy();
    expect(reorderTasks).not.toHaveBeenCalled();
  });

  test("suppresses the touch context menu after a mobile row long press starts", async () => {
    renderDndHarness();
    const row1 = screen.getByTestId("row-1");

    fireEvent.pointerDown(row1, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    row1.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });

  test("keeps desktop context menu behavior unchanged", () => {
    renderDndHarness();
    const row1 = screen.getByTestId("row-1");

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    row1.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(false);
  });

  test("suppresses context menu from task name input during mobile drag", async () => {
    renderDndHarness();
    const input = screen.getByLabelText("Task name");

    fireEvent.pointerDown(input, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });

  test("does not suppress context menu from interactive row controls (buttons)", async () => {
    renderDndHarness();
    const button = screen.getByTestId("row-1-button");

    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(false);
  });

  test("suppresses row context menus on mobile viewport even without a prior pointer event", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });

    renderDndHarness();
    const row1 = screen.getByTestId("row-1");

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    row1.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });

  test("prevents text selection (selectstart) during the pending long-press phase", async () => {
    renderDndHarness();
    const input = screen.getByLabelText("Task name");

    fireEvent.pointerDown(input, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    const selectStartEvent = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(selectStartEvent);

    expect(selectStartEvent.defaultPrevented).toBe(true);
  });

  test("blurs active element when mobile drag activates from an input", async () => {
    renderDndHarness();
    const input = screen.getByLabelText("Task name");
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.pointerDown(input, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(document.activeElement).not.toBe(input);
    expect(screen.getByText("dragging")).toBeTruthy();
  });

  test("removes selectstart listener after drag is cancelled by movement", async () => {
    renderDndHarness();
    const row1 = screen.getByTestId("row-1");

    fireEvent.pointerDown(row1, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 25,
      clientY: 10,
    });

    const selectStartEvent = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(selectStartEvent);

    expect(selectStartEvent.defaultPrevented).toBe(false);
  });
});

describe("useTableDnd reorder drop delegation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderDropHarness(tasks: Task[]) {
    const reorderTasks = vi.fn();
    const reorderMultiple = vi.fn();

    const hook = renderHook(() =>
      useTableDnd({
        tasks,
        taskTree: tasks as TaskTreeNode[],
        selectedIds: new Set(),
        isDndEnabled: true,
        reorderTasks,
        reorderMultiple,
        setParent: vi.fn(),
        setParentMultiple: vi.fn(),
      })
    );

    return {
      reorderTasks,
      reorderMultiple,
      getDnd: () => hook.result.current,
    };
  }

  function makeDropEvent(sourceClientId: string): React.DragEvent {
    return {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: document.createElement("div"),
      dataTransfer: {
        getData: (key: string) => (key === "text/plain" ? sourceClientId : ""),
      },
    } as unknown as React.DragEvent;
  }

  test("'after' drop passes the target id and position through, ignoring hidden siblings", () => {
    // Visible rows are [source, A, C]; sibling B sits between A and C in the
    // full list but is hidden by a filter (absent here). Dropping after A must
    // delegate to reorderTasks with A's id + "after", NOT resolve C as target.
    const source = createTask({
      _id: "task_source" as Task["_id"],
      clientId: "client-source",
      rank: "0|a",
    });
    const a = createTask({
      _id: "task_a" as Task["_id"],
      clientId: "client-a",
      rank: "0|c",
    });
    const c = createTask({
      _id: "task_c" as Task["_id"],
      clientId: "client-c",
      rank: "0|g",
    });
    const harness = renderDropHarness([source, a, c]);

    act(() => {
      harness.getDnd().setDropPosition({ targetId: "client-a", position: "after" });
    });
    act(() => {
      harness.getDnd().handleDrop(makeDropEvent("client-source"), "client-a");
    });

    expect(harness.reorderTasks).toHaveBeenCalledTimes(1);
    expect(harness.reorderTasks).toHaveBeenCalledWith(
      "task_source",
      "task_a",
      null,
      "after"
    );
  });

  test("'before' drop passes the target id and position through", () => {
    const source = createTask({
      _id: "task_source" as Task["_id"],
      clientId: "client-source",
      rank: "0|a",
    });
    const a = createTask({
      _id: "task_a" as Task["_id"],
      clientId: "client-a",
      rank: "0|c",
    });
    const harness = renderDropHarness([source, a]);

    act(() => {
      harness.getDnd().setDropPosition({ targetId: "client-a", position: "before" });
    });
    act(() => {
      harness.getDnd().handleDrop(makeDropEvent("client-source"), "client-a");
    });

    expect(harness.reorderTasks).toHaveBeenCalledWith(
      "task_source",
      "task_a",
      null,
      "before"
    );
  });

  test("container drop accepts the active top indicator when dropping above the first row", () => {
    const source = createTask({
      _id: "task_source" as Task["_id"],
      clientId: "client-source",
      rank: "0|b",
    });
    const first = createTask({
      _id: "task_first" as Task["_id"],
      clientId: "client-first",
      rank: "0|a",
    });
    const harness = renderDropHarness([first, source]);

    act(() => {
      harness.getDnd().setDropPosition({ targetId: "client-first", position: "before" });
    });
    act(() => {
      harness.getDnd().handleContainerDrop(makeDropEvent("client-source"));
    });

    expect(harness.reorderTasks).toHaveBeenCalledWith(
      "task_source",
      "task_first",
      null,
      "before"
    );
  });

  test("document drop accepts the active top indicator when dropping outside the table", () => {
    const source = createTask({
      _id: "task_source" as Task["_id"],
      clientId: "client-source",
      rank: "0|b",
    });
    const first = createTask({
      _id: "task_first" as Task["_id"],
      clientId: "client-first",
      rank: "0|a",
    });
    const harness = renderDropHarness([first, source]);

    act(() => {
      harness.getDnd().handleDragStart(
        {
          preventDefault: vi.fn(),
          dataTransfer: {
            effectAllowed: "move",
            setData: vi.fn(),
            setDragImage: vi.fn(),
          },
        } as unknown as React.DragEvent,
        "client-source"
      );
      harness.getDnd().setDropPosition({ targetId: "client-first", position: "before" });
    });

    const pageHeader = document.createElement("div");
    document.body.appendChild(pageHeader);
    const dropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperties(dropEvent, {
      dataTransfer: {
        value: {
          getData: (key: string) => (key === "text/plain" ? "client-source" : ""),
        },
      },
    });

    act(() => {
      pageHeader.dispatchEvent(dropEvent);
    });
    pageHeader.remove();

    expect(dropEvent.defaultPrevented).toBe(true);
    expect(harness.reorderTasks).toHaveBeenCalledWith(
      "task_source",
      "task_first",
      null,
      "before"
    );
  });

  test("container drop ignores bubbled row drops so the reorder is applied once", () => {
    const source = createTask({
      _id: "task_source" as Task["_id"],
      clientId: "client-source",
      rank: "0|b",
    });
    const first = createTask({
      _id: "task_first" as Task["_id"],
      clientId: "client-first",
      rank: "0|a",
    });
    const harness = renderDropHarness([first, source]);
    const rowTarget = document.createElement("div");
    rowTarget.dataset.taskRowId = "client-first";
    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: rowTarget,
      dataTransfer: {
        getData: (key: string) => (key === "text/plain" ? "client-source" : ""),
      },
    } as unknown as React.DragEvent;

    act(() => {
      harness.getDnd().setDropPosition({ targetId: "client-first", position: "before" });
    });
    act(() => {
      harness.getDnd().handleDrop(dropEvent, "client-first");
      harness.getDnd().handleContainerDrop(dropEvent);
    });

    expect(harness.reorderTasks).toHaveBeenCalledTimes(1);
    expect(harness.reorderTasks).toHaveBeenCalledWith(
      "task_source",
      "task_first",
      null,
      "before"
    );
  });
});

describe("useTableDnd drag start payload", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderDragStartHarness(tasks: Task[], selectedIds: Set<string>) {
    const hook = renderHook(() =>
      useTableDnd({
        tasks,
        taskTree: tasks as TaskTreeNode[],
        selectedIds,
        isDndEnabled: true,
        projectId: "project_1",
        reorderTasks: vi.fn(),
        reorderMultiple: vi.fn(),
        setParent: vi.fn(),
        setParentMultiple: vi.fn(),
      })
    );

    return { getDnd: () => hook.result.current };
  }

  function makeDragStartEvent() {
    const store = new Map<string, string>();
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: {
        effectAllowed: "none",
        setData: (key: string, value: string) => {
          store.set(key, value);
        },
        setDragImage: vi.fn(),
      },
    } as unknown as React.DragEvent;

    return { event, store };
  }

  test("writes the cross-surface payload for a single-task drag", () => {
    const harness = renderDragStartHarness([createTask()], new Set());
    const { event, store } = makeDragStartEvent();

    act(() => {
      harness.getDnd().handleDragStart(event, "client-1");
    });

    expect(JSON.parse(store.get("application/x-convoy-tasks") ?? "")).toEqual({
      projectId: "project_1",
      taskIds: ["task_1"],
      taskRefIds: ["OS-1"],
    });
    expect(store.has("application/x-convoy-tasks-project-project_1")).toBe(
      true
    );
  });

  test("writes only root task ids on multi-select drag", () => {
    const parent = createTask();
    const child = createTask({
      _id: "task_2" as Task["_id"],
      clientId: "client-2",
      parentId: "task_1",
    });
    const harness = renderDragStartHarness(
      [parent, child],
      new Set(["client-1", "client-2"])
    );
    const { event, store } = makeDragStartEvent();

    act(() => {
      harness.getDnd().handleDragStart(event, "client-1");
    });

    expect(JSON.parse(store.get("application/x-convoy-tasks") ?? "")).toEqual({
      projectId: "project_1",
      taskIds: ["task_1"],
      taskRefIds: ["OS-1"],
    });
  });
});

describe("useTableDnd resource drops", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderResourceDropHarness(hasResourceDrag: boolean) {
    const resourceDrop = {
      hasResourceDrag: vi.fn(() => hasResourceDrag),
      dropResource: vi.fn(),
    };
    const reorderTasks = vi.fn();
    const setParent = vi.fn();
    const tasks = [createTask()];
    const hook = renderHook(() =>
      useTableDnd({
        tasks,
        taskTree: tasks as TaskTreeNode[],
        selectedIds: new Set(),
        isDndEnabled: true,
        projectId: "project_1",
        resourceDrop,
        reorderTasks,
        reorderMultiple: vi.fn(),
        setParent,
        setParentMultiple: vi.fn(),
      })
    );

    return { resourceDrop, reorderTasks, setParent, getDnd: () => hook.result.current };
  }

  function makeDragEvent(types: string[] = []) {
    const currentTarget = document.createElement("div");
    vi.spyOn(currentTarget, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 44,
      left: 0,
      right: 300,
      width: 300,
      height: 44,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    return {
      preventDefault: vi.fn(),
      currentTarget,
      // Top of the row: a reorder drag would read this as "before".
      clientY: 2,
      dataTransfer: { dropEffect: "move", types, getData: () => "" },
    } as unknown as React.DragEvent;
  }

  test("a resource drag always targets inside the row, never before/after", () => {
    const harness = renderResourceDropHarness(true);
    const event = makeDragEvent([RESOURCE_DRAG_MIME]);

    act(() => {
      harness.getDnd().handleDragOver(event, "client-1");
    });

    expect(harness.getDnd().dropPosition).toEqual({
      targetId: "client-1",
      position: "inside",
    });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  test("dropping an artifact moves it and leaves reorder state untouched", () => {
    const harness = renderResourceDropHarness(true);

    act(() => {
      harness.getDnd().handleDrop(makeDragEvent(), "client-1");
    });

    expect(harness.resourceDrop.dropResource).toHaveBeenCalledWith(
      expect.anything(),
      "task_1"
    );
    expect(harness.reorderTasks).not.toHaveBeenCalled();
    expect(harness.setParent).not.toHaveBeenCalled();
    expect(harness.getDnd().dropPosition).toBeNull();
  });

  test("group headers reject resource drags and never become artifact destinations", () => {
    const harness = renderResourceDropHarness(true);
    const event = makeDragEvent([RESOURCE_DRAG_MIME]);
    act(() => { harness.getDnd().handleDragOver(event, "group:owner:alice"); });
    expect(event.dataTransfer.dropEffect).toBe("none");
    expect(harness.getDnd().dropPosition).toBeNull();
    act(() => { harness.getDnd().handleDrop(event, "group:owner:alice"); });
    expect(harness.resourceDrop.dropResource).not.toHaveBeenCalled();
  });

  test("ignores artifact drops on group headers", () => {
    const harness = renderResourceDropHarness(true);
    act(() => { harness.getDnd().handleDrop(makeDragEvent(), "group:owner:alice"); });
    expect(harness.resourceDrop.dropResource).not.toHaveBeenCalled();
  });

  test("ignores artifact drops on add-task rows", () => {
    const harness = renderResourceDropHarness(true);

    act(() => {
      harness.getDnd().handleDrop(makeDragEvent(), "add-root");
    });

    expect(harness.resourceDrop.dropResource).not.toHaveBeenCalled();
  });

  test("leaves task drags on the reorder path", () => {
    const harness = renderResourceDropHarness(false);

    act(() => {
      harness.getDnd().handleDragOver(makeDragEvent(["text/plain", "application/x-multi-select"]), "client-1");
    });

    expect(harness.getDnd().dropPosition).toEqual({
      targetId: "client-1",
      position: "before",
    });
  });

  test("drags that are not task rows (e.g. section headers) get no drop line", () => {
    const harness = renderResourceDropHarness(false);
    const event = makeDragEvent(["application/x-task-section"]);

    act(() => {
      harness.getDnd().handleDragOver(event, "client-1");
    });

    expect(harness.getDnd().dropPosition).toBeNull();
    expect(event.dataTransfer.dropEffect).toBe("none");
  });

  test("rejects a resource drag from another project without offering reorder", () => {
    // Carries the resource mime but fails the project-scoped gate.
    const harness = renderResourceDropHarness(false);
    const event = makeDragEvent([RESOURCE_DRAG_MIME]);

    act(() => {
      harness.getDnd().handleDragOver(event, "client-1");
    });

    expect(harness.getDnd().dropPosition).toBeNull();
    expect(event.dataTransfer.dropEffect).toBe("none");
  });
});
