/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MobileTaskList } from "./mobile-task-list";
import type { useTaskTableController } from "@/components/blocks/tasks/task-table/hooks/use-task-table-controller";
import { createDefaultTask } from "@/lib/tasks/defaults";
import type { Id } from "@/convex/_generated/dataModel";
import type { KanbanCardProps } from "@/components/blocks/tasks/kanban-card";
import type { Task, TaskTreeNode } from "@/lib/tasks/types";
import { ThreadComposerTaskDropZone } from "@/components/blocks/thread/thread-composer-task-drop-zone";
import { readTaskDragPayload } from "@/lib/tasks/task-drag";

const { capturedCardProps, capturedMoveMenuProps } = vi.hoisted(() => ({
  capturedCardProps: [] as KanbanCardProps[],
  capturedMoveMenuProps: [] as { skipSections?: boolean }[],
}));

// The card's own rendering is covered by kanban-card.test.tsx; here we assert
// the wrapper's prop mapping into it.
vi.mock("@/components/blocks/tasks/kanban-card", () => ({
  KanbanCard: (props: KanbanCardProps) => {
    capturedCardProps.push(props);
    return (
      <div onClick={() => props.onClick?.(props.task)}>
        <span>{props.task.name}</span>
        <button type="button" onClick={(event) => event.stopPropagation()}>Card control</button>
      </div>
    );
  },
}));

const { projectLabels } = vi.hoisted(() => ({
  projectLabels: [] as { _id: string; name: string; color: string }[],
}));
vi.mock("@/lib/tasks/hooks/use-project-labels", () => ({
  useProjectLabels: () => ({
    labels: projectLabels,
    labelsById: new Map(projectLabels.map((label) => [label._id, label])),
    isLoading: false,
  }),
}));

vi.mock(
  "@/components/blocks/project/task-lists/move-to-list-menu-content",
  () => ({
    MoveToListMenuContent: (props: { skipSections?: boolean }) => {
      capturedMoveMenuProps.push(props);
      return null;
    },
  })
);

// jsdom has no layout, so the real virtualizer would render nothing.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 100,
        size: 100,
        key: index,
      })),
    getTotalSize: () => count * 100,
    measureElement: () => {},
    isScrolling: false,
  }),
}));

function createTreeNode(
  id: string,
  overrides?: Partial<Omit<Task, "_id" | "clientId">> & {
    childCount?: number;
    completedChildCount?: number;
  }
): TaskTreeNode {
  const { childCount = 0, completedChildCount = 0, ...taskOverrides } =
    overrides ?? {};
  return {
    ...createDefaultTask({ name: `Task ${id}`, ...taskOverrides }),
    _id: id as Id<"tasks">,
    clientId: `client-${id}`,
    depth: 0,
    childCount,
    completedChildCount,
    hasChildren: childCount > 0,
    isExpanded: false,
    children: [],
  };
}

type TaskTableController = ReturnType<typeof useTaskTableController>;

function createController(taskTree: TaskTreeNode[], canUpdateTask = true) {
  return {
    taskTree,
    selectedIds: new Set<string>(),
    isDndEnabled: canUpdateTask,
    canUpdateTask,
    reorderTasks: vi.fn(),
    reorderMultiple: vi.fn(),
    setParent: vi.fn(),
    setParentMultiple: vi.fn(),
    updateTask: vi.fn(),
    handleMoveClosedToBottom: vi.fn(),
  } as unknown as TaskTableController;
}

function renderList(
  taskTree: TaskTreeNode[],
  props?: Partial<React.ComponentProps<typeof MobileTaskList>>,
  canUpdateTask = true
) {
  const controller = createController(taskTree, canUpdateTask);
  const onOpenDetails = vi.fn();
  const view = render(
    <MobileTaskList
      projectId={"project-1" as Id<"projects">}
      controller={controller}
      archiveFilter="active"
      onOpenDetails={onOpenDetails}
      {...props}
    />
  );
  return { view, controller, onOpenDetails };
}

function createDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    effectAllowed: "none",
    get types() { return [...data.keys()]; },
    setData: (type: string, value: string) => { data.set(type, value); },
    getData: (type: string) => data.get(type) ?? "",
  } as unknown as DataTransfer;
}

function mouseDown(element: Element) {
  const event = new Event("pointerdown", { bubbles: true });
  Object.assign(event, { pointerType: "mouse", button: 0, isPrimary: true });
  fireEvent(element, event);
}

describe("MobileTaskList", () => {
  beforeEach(() => {
    capturedCardProps.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("loading the next page shows an ellipsis", () => {
    renderList([], { isLoadingMore: true });
    expect(screen.getByText("Loading more…")).toBeTruthy();
  });

  test("renders a card per root task with data-task-row-id on the wrapper", () => {
    renderList([createTreeNode("a"), createTreeNode("b")]);

    expect(screen.getByText("Task a")).toBeDefined();
    expect(screen.getByText("Task b")).toBeDefined();
    const items = screen.getAllByRole("listitem");
    expect(items.map((el) => el.getAttribute("data-task-row-id"))).toEqual([
      "client-a",
      "client-b",
    ]);
  });

  test("tapping the card wrapper opens details", () => {
    const { onOpenDetails } = renderList([createTreeNode("a")]);

    fireEvent.click(screen.getByText("Task a"));

    expect(onOpenDetails).toHaveBeenCalledWith("client-a");
  });

  test("drags a card into the composer using the table task payload", () => {
    const node = createTreeNode("a", { refId: "OS-42" });
    const { controller } = renderList([node]);
    const onDropTask = vi.fn();
    render(
      <ThreadComposerTaskDropZone projectId="project-1" onDropTask={onDropTask}>
        <div data-testid="composer-input" />
      </ThreadComposerTaskDropZone>
    );
    const card = screen.getByRole("listitem");
    mouseDown(screen.getByText(node.name));
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(card, { dataTransfer });

    expect(readTaskDragPayload(dataTransfer)).toEqual({
      projectId: "project-1", taskIds: ["a"], taskRefIds: ["OS-42"],
    });
    expect(card.draggable).toBe(true);
    expect(dataTransfer.effectAllowed).toBe("move");
    const input = screen.getByTestId("composer-input");
    fireEvent.dragOver(input, { dataTransfer });
    expect(screen.getByTestId("thread-composer-task-drop-overlay")).toBeTruthy();
    fireEvent.drop(input, { dataTransfer });
    fireEvent.dragEnd(card, { dataTransfer });

    expect(onDropTask).toHaveBeenCalledWith({ id: "a", refId: "OS-42" });
    expect(controller.reorderTasks).not.toHaveBeenCalled();
    expect(controller.setParent).not.toHaveBeenCalled();
    expect(card.className).not.toContain("opacity-50");
  });

  test("tapping a control inside the card does not open details", () => {
    const { onOpenDetails } = renderList([createTreeNode("a")]);

    fireEvent.click(screen.getByRole("button", { name: "Card control" }));

    expect(onOpenDetails).not.toHaveBeenCalled();
  });

  test("does not start a native task drag from card controls or touch", () => {
    renderList([createTreeNode("a")]);
    const card = screen.getByRole("listitem");
    const control = screen.getByRole("button", { name: "Card control" });
    const dataTransfer = createDataTransfer();
    mouseDown(control);
    fireEvent.dragStart(control, { dataTransfer });
    expect(card.draggable).toBe(false);
    expect(readTaskDragPayload(dataTransfer)).toBeNull();

    const touch = new Event("pointerdown", { bubbles: true });
    Object.assign(touch, { pointerType: "touch", pointerId: 1, button: 0, isPrimary: true });
    fireEvent(card, touch);
    fireEvent.dragStart(card, { dataTransfer });
    expect(card.draggable).toBe(false);
    expect(readTaskDragPayload(dataTransfer)).toBeNull();
    fireEvent.pointerCancel(card);
  });

  test("updates card drag eligibility when switching to archived tasks", () => {
    const node = createTreeNode("a");
    const { view, controller, onOpenDetails } = renderList([node]);
    const card = screen.getByRole("listitem");
    mouseDown(card);
    expect(card.draggable).toBe(true);
    fireEvent.pointerUp(card);
    expect(card.draggable).toBe(false);

    view.rerender(<MobileTaskList
      projectId={"project-1" as Id<"projects">} controller={controller}
      archiveFilter="archived" onOpenDetails={onOpenDetails}
    />);
    mouseDown(card);
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(card, { dataTransfer });
    expect(card.draggable).toBe(false);
    expect(readTaskDragPayload(dataTransfer)).toBeNull();
  });

  test("passes onClick so each row opens details from the card's real title button", () => {
    const { onOpenDetails } = renderList([createTreeNode("a")]);

    capturedCardProps[0].onClick?.(capturedCardProps[0].task);

    expect(onOpenDetails).toHaveBeenCalledTimes(1);
    expect(onOpenDetails).toHaveBeenCalledWith("client-a");
  });

  test("tapping the row opens details once", () => {
    const { onOpenDetails } = renderList([createTreeNode("a")]);

    fireEvent.click(screen.getByText("Task a"));

    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });

  test("passes the label and the Show description setting to cards", () => {
    projectLabels.push({ _id: "label-1", name: "Frontend", color: "#3b82f6" });
    window.localStorage.setItem("convoy.task-card-show-description", "1");

    renderList([createTreeNode("a", { labelId: "label-1" as Id<"projectLabels"> })]);

    expect(capturedCardProps[0].label?.name).toBe("Frontend");
    expect(capturedCardProps[0].showDescription).toBe(true);
    projectLabels.length = 0;
    window.localStorage.clear();
  });

  test("wires onTaskUpdate so card controls stay editable", () => {
    const { controller } = renderList([createTreeNode("a")]);

    expect(capturedCardProps[0].onTaskUpdate).toBe(controller.updateTask);
  });

  test("read-only viewers get cards without field editors", () => {
    renderList([createTreeNode("a")], undefined, false);

    expect(capturedCardProps[0].onTaskUpdate).toBeUndefined();
  });

  test("maps subtask progress from childCount/completedChildCount", () => {
    renderList([
      createTreeNode("a", { childCount: 4, completedChildCount: 1 }),
      createTreeNode("b"),
    ]);

    expect(capturedCardProps[0].subtaskProgress).toEqual({
      completed: 1,
      total: 4,
    });
    expect(capturedCardProps[1].subtaskProgress).toBeUndefined();
  });

  test("renders the header actions menu trigger", () => {
    renderList([createTreeNode("a")]);

    expect(
      screen.getByRole("button", { name: "Task list actions" })
    ).toBeDefined();
  });

  test("shows an empty state when there are no root tasks", () => {
    renderList([]);

    expect(screen.getByRole("heading", { name: "No tasks" })).toBeDefined();
    expect(screen.getByText("Tasks you add to this list show up here.")).toBeDefined();
  });
  test("renders group headers separately from cards, including empty groups", () => {
    const node = createTreeNode("a");
    renderList([node], { grouping: {
      collapseAll: vi.fn(),
      resolveDraft: vi.fn(),
      navigate: vi.fn(),
      reveal: vi.fn(),
      enabled: true,
      isLoading: false,
      allowRootCreation: false,
      canMove: true,
      transformRows: rows => rows,
      presentRows: () => [
        { rowType: "section", clientId: "group:owner:none" },
        { rowType: "section", clientId: "group:owner:alice" },
        node,
      ],
      renderHeader: row => <button>{row.clientId}</button>,
      drop: vi.fn(() => true),
      getRowStyle: () => undefined,
      createSection: undefined,
    } });
    const list = screen.getByRole("list");
    expect(list.parentElement?.className).not.toContain("px-3");
    const group = screen.getByRole("button", { name: "group:owner:none" }).parentElement!;
    expect(group.className).not.toContain("pb-2");
    expect(screen.getByRole("listitem").parentElement?.style.paddingLeft).not.toBe("24px");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "group:owner:none" })).toBeDefined();
    expect(screen.getByRole("button", { name: "group:owner:alice" })).toBeDefined();
  });

});

test("mobile task list exposes Collapse all", async () => {
  const onCollapseAll = vi.fn();
  renderList([], { onCollapseAll });
  fireEvent.pointerDown(screen.getByRole("button", { name: "Task list actions" }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Collapse all" }));
  expect(onCollapseAll).toHaveBeenCalledTimes(1);
});

test("Move active to skips the section step, since it always lands in No section", async () => {
  renderList([], { onMoveActiveToList: vi.fn(), activeRootTaskCount: 2 });
  fireEvent.pointerDown(screen.getByRole("button", { name: "Task list actions" }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Move active to" }));
  expect(capturedMoveMenuProps.at(-1)?.skipSections).toBe(true);
});

test("read-only viewers get only Collapse all in the header menu", async () => {
  renderList([], { onCollapseAll: vi.fn(), onArchiveAllDone: vi.fn(), doneTaskCount: 2, onMoveActiveToList: vi.fn(), activeRootTaskCount: 2 }, false);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Task list actions" }), { button: 0, ctrlKey: false });
  expect(await screen.findByRole("menuitem", { name: "Collapse all" })).toBeTruthy();
  expect(screen.getAllByRole("menuitem")).toHaveLength(1);
});
