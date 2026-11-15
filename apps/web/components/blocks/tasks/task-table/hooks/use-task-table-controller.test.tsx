/**
 * @vitest-environment jsdom
 */
import * as keyboardNavigation from "./use-keyboard-navigation";
import { createRef } from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useTaskTableController } from "./use-task-table-controller";
import {
  isAddTaskPlaceholder,
  isInlineTaskDraftRow,
  Priority,
  Status,
  type Task,
  type StatusFilterKey,
  type TaskTreeNode,
} from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";

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

function createMouseEvent(
  modifiers?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }
): React.MouseEvent {
  return {
    target: document.createElement("div"),
    metaKey: modifiers?.metaKey ?? false,
    ctrlKey: modifiers?.ctrlKey ?? false,
    shiftKey: modifiers?.shiftKey ?? false,
  } as unknown as React.MouseEvent;
}

function createController(
  tasks: Task[],
  options: { canUpdateTask?: boolean; allowAddTask?: boolean; statusFilter?: StatusFilterKey; currentUserId?: string; selectedTaskRefId?: string; revealGroupRow?: (clientId: string) => void; allowRootAddTask?: boolean; onCreateSection?: (name: string) => void; resolveDraft?: (draft: import("@/lib/tasks/types").InlineTaskDraftRow) => { defaults: Partial<Task>; options?: import("@/lib/tasks/types").AddTaskOptions } | undefined } = {}
) {
  const addTask = vi.fn();
  const updateTask = vi.fn();
  const bulkUpdateStatus = vi.fn();
  const bulkUpdateTaskType = vi.fn();
  const bulkDelete = vi.fn();
  const moveClosedToBottom = vi.fn();
  const focusInput = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);

  const hook = renderHook(
    ({ allTasks, allowAddTask }: { allTasks: Task[]; allowAddTask?: boolean }) =>
      useTaskTableController({
        allTasks,
        updateTask,
        deleteTask: vi.fn(),
        archiveTask: vi.fn(),
        unarchiveTask: vi.fn(),
        addTask,
        reorderTasks: vi.fn(),
        reorderMultiple: vi.fn(),
        setParent: vi.fn(),
        setParentMultiple: vi.fn(),
        bulkUpdateStatus,
        bulkUpdateAssignee: vi.fn(),
        bulkUpdatePriority: vi.fn(),
        bulkUpdateDueDate: vi.fn(),
        bulkUpdateTaskType,
        bulkArchive: vi.fn(),
        moveClosedToBottom,
        bulkDelete,
        duplicateTask: vi.fn(),
        inputRefs: createRef<Map<string, HTMLInputElement> | null>(),
        focusInput,
        containerRef: { current: container },
        enabled: false,
        canUpdateTask: options.canUpdateTask,
        allowAddTask,
        statusFilter: options.statusFilter,
        allowRootAddTask: options.allowRootAddTask,
        resolveDraft: options.resolveDraft,
        onCreateSection: options.onCreateSection,
        currentUserId: options.currentUserId,
        selectedTaskRefId: options.selectedTaskRefId,
        revealGroupRow: options.revealGroupRow,
      }),
    {
      initialProps: { allTasks: tasks, allowAddTask: options.allowAddTask } as { allTasks: Task[]; allowAddTask?: boolean },
    }
  );

  return {
    addTask,
    updateTask,
    bulkUpdateStatus,
    bulkUpdateTaskType,
    bulkDelete,
    moveClosedToBottom,
    focusInput,
    container,
    ...hook,
  };
}

describe("useTaskTableController", () => {
  test("I assigns the target tasks to the current user without opening a picker", () => {
    const first = createTask();
    const second = createTask({ _id: "task-2" as Task["_id"], clientId: "client-2", rank: "0|b:" });
    const hook = createController([first, second], { currentUserId: "user-1" });

    act(() => hook.result.current.handlePropertyShortcut("assignToMe", ["client-1", "client-2"]));

    expect(hook.updateTask).toHaveBeenCalledWith(first._id, { assigneeId: "user-1" });
    expect(hook.updateTask).toHaveBeenCalledWith(second._id, { assigneeId: "user-1" });
    expect(hook.result.current.propertyShortcut).toBeNull();
    hook.unmount();
    hook.container.remove();
  });

  test("P opens the priority picker for the target tasks under the first row", () => {
    const task = createTask();
    const hook = createController([task]);
    const row = document.createElement("div");
    act(() => hook.result.current.registerRow("client-1", row));

    act(() => hook.result.current.handlePropertyShortcut("priority", ["client-1"]));

    expect(hook.result.current.propertyShortcut).toEqual({ property: "priority", tasks: [task], anchor: row });

    act(() => hook.result.current.closePropertyShortcut());
    expect(hook.result.current.propertyShortcut).toBeNull();
    hook.unmount();
    hook.container.remove();
  });

  test.each([
    ["priority", "priority"],
    ["assignee", "assignee"],
    ["label", "label"],
    ["dueDate", "dueDate"],
  ] as const)("%s opens its picker under the row's %s cell", (property, columnId) => {
    const task = createTask();
    const hook = createController([task]);
    const row = document.createElement("div");
    const cell = document.createElement("div");
    cell.dataset.columnId = columnId;
    row.appendChild(cell);
    act(() => hook.result.current.registerRow("client-1", row));

    act(() => hook.result.current.handlePropertyShortcut(property, ["client-1"]));

    expect(hook.result.current.propertyShortcut?.anchor).toBe(cell);
    hook.unmount();
    hook.container.remove();
  });

  test("bulk label change sets the label on every selected task and reports bulk mode", () => {
    const first = createTask();
    const second = createTask({ _id: "task-2" as Task["_id"], clientId: "client-2", rank: "0|b:" });
    const hook = createController([first, second]);

    act(() => hook.result.current.handleSelectRow(createMouseEvent({ metaKey: true }), first.clientId));
    expect(hook.result.current.isBulkSelection).toBe(true);
    act(() => hook.result.current.handleSelectRow(createMouseEvent({ metaKey: true }), second.clientId));
    act(() => hook.result.current.handleBulkLabelChange("label-1" as never));

    expect(hook.updateTask).toHaveBeenCalledWith(first._id, { labelId: "label-1" });
    expect(hook.updateTask).toHaveBeenCalledWith(second._id, { labelId: "label-1" });
    hook.unmount();
    hook.container.remove();
  });

  test("collapse all clears nested expansion, including descendants hidden by a collapsed parent", () => {
    const parent = createTask();
    const child = createTask({ _id: "child" as Task["_id"], clientId: "child", parentId: parent._id });
    const grandchild = createTask({ _id: "grandchild" as Task["_id"], clientId: "grandchild", parentId: child._id });
    const hook = createController([parent, child, grandchild]);
    act(() => {
      hook.result.current.toggleExpanded(parent._id);
      hook.result.current.toggleExpanded(child._id);
    });
    act(() => hook.result.current.toggleExpanded(parent._id));
    expect(hook.result.current.expandedIds.has(child._id)).toBe(true);
    act(() => hook.result.current.collapseAll());
    expect(hook.result.current.expandedIds.size).toBe(0);
    act(() => hook.result.current.toggleExpanded(parent._id));
    expect(hook.result.current.flattenedTasks.some((row) => row.clientId === child.clientId)).toBe(true);
    expect(hook.result.current.flattenedTasks.some((row) => row.clientId === grandchild.clientId)).toBe(false);
    hook.unmount();
    hook.container.remove();
  });

  test("a deep link opens the target's collapsed group and scrolls to it without focus", () => {
    const target = createTask({ _id: "target" as Task["_id"], clientId: "target", refId: "WEB-7" });
    const revealGroupRow = vi.fn();
    const hook = createController([createTask(), target], { selectedTaskRefId: "WEB-7", revealGroupRow });
    expect(revealGroupRow).toHaveBeenCalledWith("target");
    expect(hook.result.current.focusRequest).toEqual({ id: "target", focus: false });
    hook.unmount();
    hook.container.remove();
  });

  test("enables reorder in every status view (full container loaded client-side)", () => {
    const taskA = createTask();
    const taskB = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      rank: "0|b:",
    });

    for (const statusFilter of ["all", "active", "done", "canceled"] as const) {
      const hook = createController([taskA, taskB], { statusFilter });
      expect(hook.result.current.isDndEnabled).toBe(true);
      hook.unmount();
      hook.container.remove();
    }
  });

  test("disables reorder while a column sort is active", () => {
    const hook = createController([createTask()], { statusFilter: "all" });
    expect(hook.result.current.isDndEnabled).toBe(true);

    act(() => {
      hook.result.current.setSorting([{ id: "name", desc: false }]);
    });
    expect(hook.result.current.isDndEnabled).toBe(false);

    hook.unmount();
    hook.container.remove();
  });

  test("read-only viewers get no reorder and no write hotkeys", () => {
    const spy = vi.spyOn(keyboardNavigation, "useKeyboardNavigation");
    const hook = createController([createTask()], { canUpdateTask: false });

    expect(hook.result.current.isDndEnabled).toBe(false);
    expect(hook.result.current.canUpdateTask).toBe(false);
    expect(spy.mock.calls.at(-1)?.[0].canUpdateTask).toBe(false);

    spy.mockRestore();
    hook.unmount();
    hook.container.remove();
  });

  test("filters the full container client-side, applying closed-only root-only rule", () => {
    // Full non-backlog container (OS-902): active root, done root, done subtask.
    const activeRoot = createTask({
      _id: "task-1" as Task["_id"],
      clientId: "client-1",
      status: Status.IN_PROGRESS,
      rank: "0|a:",
    });
    const doneRoot = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      status: Status.DONE,
      rank: "0|b:",
    });
    const doneSubtask = createTask({
      _id: "task-3" as Task["_id"],
      clientId: "client-3",
      status: Status.DONE,
      parentId: "task-1" as Task["_id"],
      rank: "0|c:",
    });
    const container = [activeRoot, doneRoot, doneSubtask];

    const collectTreeIds = (nodes: TaskTreeNode[]): string[] =>
      nodes.flatMap((node) => [
        node._id as string,
        ...(node.children ? collectTreeIds(node.children) : []),
      ]);

    const treeFor = (statusFilter: StatusFilterKey) => {
      const hook = createController(container, { statusFilter });
      const tree = hook.result.current.taskTree;
      const allIds = collectTreeIds(tree);
      const rootIds = tree.map((node) => node._id as string);
      hook.unmount();
      hook.container.remove();
      return { allIds, rootIds };
    };

    // "all": every non-backlog task; done subtask nests under its active parent.
    expect(new Set(treeFor("all").allIds)).toEqual(
      new Set(["task-1", "task-2", "task-3"])
    );
    // "active": only the active root (done tasks/subtask filtered out).
    expect(treeFor("active").allIds).toEqual(["task-1"]);
    // "done": root done task only — the done subtask is NOT promoted to a root.
    expect(treeFor("done").rootIds).toEqual(["task-2"]);
    expect(treeFor("done").allIds).toEqual(["task-2"]);
  });

  test("pressing Enter after the last root task focuses the existing add-root input", async () => {
    const firstTask = createTask();
    const lastTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Last",
      rank: "0|b:",
    });

    const hook = createController([firstTask, lastTask]);
    const addRootInput = document.createElement("input");
    document.body.appendChild(addRootInput);

    act(() => {
      hook.result.current.registerAddTaskInput("add-root", addRootInput);
    });

    act(() => {
      hook.result.current.beginInlineTaskDraft({
        afterClientId: lastTask.clientId,
        parentId: null,
      });
    });

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(addRootInput);
    });
    expect(hook.result.current.inlineDraft).toBeNull();
    expect(hook.addTask).not.toHaveBeenCalled();

    addRootInput.remove();
    hook.unmount();
    hook.container.remove();
  });

  test("moves only visible top-level roots when moving closed tasks to bottom", () => {
    const doneRoot = createTask({
      _id: "task-1" as Task["_id"],
      clientId: "client-1",
      status: Status.DONE,
      rank: "0|a:",
    });
    const openRoot = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      status: Status.TODO,
      rank: "0|b:",
    });
    const child = createTask({
      _id: "task-3" as Task["_id"],
      clientId: "client-3",
      status: Status.TODO,
      parentId: doneRoot._id,
      rank: "0|c:",
    });
    const hook = createController([doneRoot, openRoot, child]);

    act(() => {
      hook.result.current.handleMoveClosedToBottom();
    });

    expect(hook.moveClosedToBottom).toHaveBeenCalledWith([
      String(doneRoot._id),
      String(openRoot._id),
    ]);
    hook.unmount();
    hook.container.remove();
  });

  test("pressing Enter after the last expanded subtask focuses the existing add-subtask input", async () => {
    const parentTask = createTask();
    const childTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Child",
      rank: "0|a0:",
      parentId: parentTask._id,
    });

    const hook = createController([parentTask, childTask]);
    const addSubtaskInput = document.createElement("input");
    document.body.appendChild(addSubtaskInput);

    act(() => {
      hook.result.current.toggleExpanded(parentTask._id);
    });

    act(() => {
      hook.result.current.registerAddTaskInput(`add-${parentTask._id}`, addSubtaskInput);
    });

    act(() => {
      hook.result.current.beginInlineTaskDraft({
        afterClientId: childTask.clientId,
        parentId: parentTask._id,
      });
    });

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(addSubtaskInput);
    });
    expect(hook.result.current.inlineDraft).toBeNull();
    expect(hook.addTask).not.toHaveBeenCalled();

    addSubtaskInput.remove();
    hook.unmount();
    hook.container.remove();
  });

  test("moving add-root deeper preserves text and reveals a childless add-subtask row", () => {
    const firstTask = createTask();
    const lastTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Last",
      rank: "0|b:",
    });
    const hook = createController([firstTask, lastTask]);
    const addSubtaskInput = document.createElement("input");
    document.body.appendChild(addSubtaskInput);

    act(() => {
      hook.result.current.registerAddTaskInput(`add-${lastTask._id}`, addSubtaskInput);
      hook.result.current.setAddTaskValue("Draft subtask");
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy("add-root", "deeper");
    });

    expect(hook.result.current.addTaskValue).toBe("");
    expect(hook.result.current.getAddTaskInputValue(`add-${lastTask._id}`)).toBe(
      "Draft subtask"
    );
    expect(hook.result.current.expandedIds.has(lastTask._id)).toBe(true);
    expect(
      hook.result.current.flattenedTasks.some(
        (row) => isAddTaskPlaceholder(row) && row.parentId === lastTask._id
      )
    ).toBe(true);
    addSubtaskInput.remove();
    hook.unmount();
    hook.container.remove();
  });

  test("moving a nested add-subtask input deeper targets the previous visible task", () => {
    const parentTask = createTask();
    const childTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Child",
      rank: "0|a0:",
      parentId: parentTask._id,
    });
    const hook = createController([parentTask, childTask]);

    act(() => {
      hook.result.current.toggleExpanded(parentTask._id);
      hook.result.current.setAddTaskInputValue(
        `add-${parentTask._id}`,
        "Nested draft"
      );
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy(
        `add-${parentTask._id}`,
        "deeper"
      );
    });

    expect(hook.result.current.getAddTaskInputValue(`add-${parentTask._id}`)).toBe(
      ""
    );
    expect(hook.result.current.getAddTaskInputValue(`add-${childTask._id}`)).toBe(
      "Nested draft"
    );
    expect(hook.result.current.expandedIds.has(childTask._id)).toBe(true);

    hook.unmount();
    hook.container.remove();
  });

  test("moving a nested add-subtask input shallower creates an inline draft after the old parent", () => {
    const parentTask = createTask();
    const childTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Child",
      rank: "0|a0:",
      parentId: parentTask._id,
    });
    const hook = createController([parentTask, childTask]);

    act(() => {
      hook.result.current.toggleExpanded(parentTask._id);
      hook.result.current.setAddTaskInputValue(
        `add-${childTask._id}`,
        "Outdent draft"
      );
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy(
        `add-${childTask._id}`,
        "shallower"
      );
    });

    expect(hook.result.current.getAddTaskInputValue(`add-${childTask._id}`)).toBe(
      ""
    );
    const draftRow = hook.result.current.flattenedTasks.find(isInlineTaskDraftRow);
    expect(draftRow).toMatchObject({
      parentId: parentTask._id,
      depth: 1,
      value: "Outdent draft",
      afterClientId: childTask.clientId,
    });
    expect(
      hook.result.current.flattenedTasks.map((row) => row.clientId)
    ).toEqual(
      expect.arrayContaining([
        parentTask.clientId,
        childTask.clientId,
        draftRow!.clientId,
      ])
    );
    expect(
      hook.result.current.flattenedTasks.indexOf(draftRow!)
    ).toBe(
      hook.result.current.flattenedTasks.findIndex(
        (row) => row.clientId === childTask.clientId
      ) + 1
    );

    hook.unmount();
    hook.container.remove();
  });

  test("moving a parent add-subtask input shallower keeps the source row and adds a parent-level draft after it", () => {
    const parentTask = createTask();
    const childTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Child",
      rank: "0|a0:",
      parentId: parentTask._id,
    });
    const siblingTask = createTask({
      _id: "task-3" as Task["_id"],
      clientId: "client-3",
      refNumber: 3,
      refId: "OS-3",
      name: "Sibling",
      rank: "0|b:",
    });
    const hook = createController([parentTask, childTask, siblingTask]);

    act(() => {
      hook.result.current.toggleExpanded(parentTask._id);
      hook.result.current.setAddTaskInputValue(
        `add-${parentTask._id}`,
        "Root sibling draft"
      );
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy(
        `add-${parentTask._id}`,
        "shallower"
      );
    });

    const draftRow = hook.result.current.flattenedTasks.find(isInlineTaskDraftRow);
    expect(hook.result.current.getAddTaskInputValue(`add-${parentTask._id}`)).toBe(
      ""
    );
    expect(draftRow).toMatchObject({
      parentId: null,
      depth: 0,
      value: "Root sibling draft",
      afterClientId: parentTask.clientId,
    });
    expect(
      hook.result.current.flattenedTasks.map((row) => row.clientId)
    ).toEqual([
      parentTask.clientId,
      childTask.clientId,
      `add-${parentTask._id}`,
      draftRow!.clientId,
      siblingTask.clientId,
    ]);

    hook.unmount();
    hook.container.remove();
  });

  test("moving an inline draft before a child shallower keeps the draft after the parent", () => {
    const parentTask = createTask();
    const firstChild = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "First child",
      rank: "0|a0:",
      parentId: parentTask._id,
    });
    const secondChild = createTask({
      _id: "task-3" as Task["_id"],
      clientId: "client-3",
      refNumber: 3,
      refId: "OS-3",
      name: "Second child",
      rank: "0|a1:",
      parentId: parentTask._id,
    });
    const hook = createController([parentTask, firstChild, secondChild]);

    act(() => {
      hook.result.current.toggleExpanded(parentTask._id);
      hook.result.current.beginInlineTaskDraft({
        beforeClientId: firstChild.clientId,
        parentId: parentTask._id,
      });
      hook.result.current.updateInlineTaskDraftValue("Outdented inline draft");
    });
    const sourceDraft = hook.result.current.flattenedTasks.find(isInlineTaskDraftRow);
    expect(sourceDraft).toMatchObject({
      parentId: parentTask._id,
      depth: 1,
      beforeClientId: firstChild.clientId,
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy(
        sourceDraft!.clientId,
        "shallower"
      );
    });

    const movedDraft = hook.result.current.flattenedTasks.find(isInlineTaskDraftRow);
    expect(movedDraft).toMatchObject({
      parentId: null,
      depth: 0,
      value: "Outdented inline draft",
      afterClientId: parentTask.clientId,
    });
    expect(
      hook.result.current.flattenedTasks.map((row) => row.clientId)
    ).toEqual([
      parentTask.clientId,
      movedDraft!.clientId,
      firstChild.clientId,
      secondChild.clientId,
      `add-${parentTask._id}`,
    ]);

    hook.unmount();
    hook.container.remove();
  });

  test("does not keep an add-subtask placeholder when an expanded parent loses its last child", () => {
    const parentTask = createTask();
    const childTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Child",
      rank: "0|a0:",
      parentId: parentTask._id,
    });
    const hook = createController([parentTask, childTask]);

    act(() => {
      hook.result.current.toggleExpanded(parentTask._id);
    });

    expect(
      hook.result.current.flattenedTasks.some(
        (row) => isAddTaskPlaceholder(row) && row.parentId === parentTask._id
      )
    ).toBe(true);

    hook.rerender({
      allTasks: [
        parentTask,
        {
          ...childTask,
          parentId: null,
          rank: "0|b:",
        },
      ],
    });

    expect(hook.result.current.expandedIds.has(parentTask._id)).toBe(true);
    expect(
      hook.result.current.flattenedTasks.some(
        (row) => isAddTaskPlaceholder(row) && row.parentId === parentTask._id
      )
    ).toBe(false);

    hook.unmount();
    hook.container.remove();
  });

  test("moving a top-level add-subtask input shallower keeps the source row before the new root draft", () => {
    const parentTask = createTask();
    const childTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Child",
      rank: "0|a0:",
      parentId: parentTask._id,
    });
    const siblingTask = createTask({
      _id: "task-3" as Task["_id"],
      clientId: "client-3",
      refNumber: 3,
      refId: "OS-3",
      name: "Sibling",
      rank: "0|b:",
    });
    const hook = createController([parentTask, childTask, siblingTask]);

    act(() => {
      hook.result.current.toggleExpanded(parentTask._id);
      hook.result.current.setAddTaskInputValue(
        `add-${parentTask._id}`,
        "Root draft"
      );
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy(
        `add-${parentTask._id}`,
        "shallower"
      );
    });

    expect(hook.result.current.getAddTaskInputValue(`add-${parentTask._id}`)).toBe(
      ""
    );
    expect(hook.result.current.addTaskValue).toBe("");
    const draftRow = hook.result.current.flattenedTasks.find(isInlineTaskDraftRow);
    expect(draftRow).toMatchObject({
      parentId: null,
      depth: 0,
      value: "Root draft",
      afterClientId: parentTask.clientId,
    });
    expect(hook.result.current.flattenedTasks.map((row) => row.clientId)).toEqual([
      parentTask.clientId,
      childTask.clientId,
      `add-${parentTask._id}`,
      draftRow!.clientId,
      siblingTask.clientId,
    ]);

    hook.unmount();
    hook.container.remove();
  });

  test("shifting an empty revealed terminal add-subtask row shallower focuses the existing root add row", async () => {
    const parentTask = createTask();
    const hook = createController([parentTask]);
    const rootInput = document.createElement("input");
    const sourceInput = document.createElement("input");
    document.body.append(rootInput, sourceInput);

    act(() => {
      hook.result.current.registerAddTaskInput("add-root", rootInput);
      hook.result.current.registerAddTaskInput(`add-${parentTask._id}`, sourceInput);
      sourceInput.focus();
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy("add-root", "deeper");
    });

    expect(hook.result.current.flattenedTasks.map((row) => row.clientId)).toEqual([
      parentTask.clientId,
      `add-${parentTask._id}`,
    ]);

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy(
        `add-${parentTask._id}`,
        "shallower"
      );
    });

    expect(hook.result.current.inlineDraft).toBeNull();
    expect(hook.result.current.flattenedTasks.map((row) => row.clientId)).toEqual([
      parentTask.clientId,
    ]);

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

    expect(document.activeElement).toBe(rootInput);

    rootInput.remove();
    sourceInput.remove();
    hook.unmount();
    hook.container.remove();
  });

  test("tabbing a root draft created from add-subtask outdent returns to the original add-subtask row", () => {
    const parentTask = createTask();
    const childTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Child",
      rank: "0|a0:",
      parentId: parentTask._id,
    });
    const grandchildTask = createTask({
      _id: "task-3" as Task["_id"],
      clientId: "client-3",
      refNumber: 3,
      refId: "OS-3",
      name: "Grandchild",
      rank: "0|a0:",
      parentId: childTask._id,
    });
    const hook = createController([parentTask, childTask, grandchildTask]);

    act(() => {
      hook.result.current.toggleExpanded(parentTask._id);
      hook.result.current.toggleExpanded(childTask._id);
      hook.result.current.setAddTaskInputValue(
        `add-${parentTask._id}`,
        "Draft"
      );
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy(
        `add-${parentTask._id}`,
        "shallower"
      );
    });

    const rootDraft = hook.result.current.flattenedTasks.find(isInlineTaskDraftRow);
    expect(rootDraft).toMatchObject({
      parentId: null,
      depth: 0,
      value: "Draft",
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy(rootDraft!.clientId, "deeper");
    });

    expect(hook.result.current.inlineDraft).toBeNull();
    expect(hook.result.current.getAddTaskInputValue(`add-${parentTask._id}`)).toBe(
      "Draft"
    );
    expect(hook.result.current.flattenedTasks.map((row) => row.clientId)).toEqual([
      parentTask.clientId,
      childTask.clientId,
      grandchildTask.clientId,
      `add-${childTask._id}`,
      `add-${parentTask._id}`,
    ]);

    hook.unmount();
    hook.container.remove();
  });

  test("invalid add-input hierarchy moves keep the source draft intact", () => {
    const hook = createController([]);

    act(() => {
      hook.result.current.setAddTaskValue("Root draft");
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy("add-root", "deeper");
    });

    expect(hook.result.current.addTaskValue).toBe("Root draft");

    hook.unmount();
    hook.container.remove();
  });

  test("moving to an occupied add input does not blur-commit the source draft", async () => {
    const parentTask = createTask();
    const hook = createController([parentTask]);
    const targetAddInputId = `add-${parentTask._id}`;
    const sourceInput = document.createElement("input");
    const targetInput = document.createElement("input");
    document.body.append(sourceInput, targetInput);

    act(() => {
      hook.result.current.registerAddTaskInput("add-root", sourceInput);
      hook.result.current.registerAddTaskInput(targetAddInputId, targetInput);
      hook.result.current.setAddTaskValue("Source draft");
      hook.result.current.setAddTaskInputValue(targetAddInputId, "Occupied draft");
      sourceInput.focus();
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy("add-root", "deeper");
    });

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

    act(() => {
      hook.result.current.handleAddTaskInputBlur("add-root", null);
    });

    expect(hook.addTask).not.toHaveBeenCalled();
    expect(hook.result.current.addTaskValue).toBe("Source draft");
    expect(hook.result.current.getAddTaskInputValue(targetAddInputId)).toBe(
      "Occupied draft"
    );

    sourceInput.remove();
    targetInput.remove();
    hook.unmount();
    hook.container.remove();
  });

  test("moving to an occupied unmounted add input does not skip the next real blur commit", async () => {
    const parentTask = createTask();
    const hook = createController([parentTask]);
    const targetAddInputId = `add-${parentTask._id}`;

    act(() => {
      hook.result.current.setAddTaskValue("Source draft");
      hook.result.current.setAddTaskInputValue(targetAddInputId, "Occupied draft");
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy("add-root", "deeper");
    });

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

    act(() => {
      hook.result.current.handleAddTaskInputBlur("add-root", null);
    });

    expect(hook.addTask).toHaveBeenCalledTimes(1);
    expect(hook.addTask.mock.calls[0]?.[0].name).toBe("Source draft");
    expect(hook.result.current.addTaskValue).toBe("");
    expect(hook.result.current.getAddTaskInputValue(targetAddInputId)).toBe(
      "Occupied draft"
    );

    hook.unmount();
    hook.container.remove();
  });

  test("scheduled add-input focus does not steal focus from a task title input", async () => {
    const parentTask = createTask();
    const hook = createController([parentTask]);
    const addSubtaskInput = document.createElement("input");
    const taskTitleInput = document.createElement("input");
    document.body.append(addSubtaskInput, taskTitleInput);

    act(() => {
      hook.result.current.registerAddTaskInput(`add-${parentTask._id}`, addSubtaskInput);
      hook.result.current.setAddTaskValue("Draft subtask");
    });

    act(() => {
      hook.result.current.moveAddTaskInputHierarchy("add-root", "deeper");
      taskTitleInput.focus();
    });

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

    expect(document.activeElement).toBe(taskTitleInput);

    addSubtaskInput.remove();
    taskTitleInput.remove();
    hook.unmount();
    hook.container.remove();
  });

  test("committing an inline draft creates one task and reopens the next draft after it", () => {
    const firstTask = createTask();
    const secondTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Second",
      rank: "0|b:",
    });
    const createdTask = createTask({
      _id: "task-3" as Task["_id"],
      clientId: "client-3",
      refNumber: 3,
      refId: "OS-3",
      name: "Created",
      rank: "0|aV:",
    });

    const hook = createController([firstTask, secondTask]);
    hook.addTask.mockReturnValue(createdTask.clientId);

    act(() => {
      hook.result.current.beginInlineTaskDraft({
        afterClientId: firstTask.clientId,
        parentId: null,
      });
    });

    act(() => {
      hook.result.current.updateInlineTaskDraftValue("Inserted #ux #bug #QA");
    });

    act(() => {
      hook.result.current.commitInlineTaskDraft("Inserted #ux #bug #QA", "enter");
    });

    expect(hook.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Inserted",
        tags: ["ux", "QA"],
        taskType: expect.objectContaining({ key: "bug" }),
      }),
      { afterId: firstTask._id, parentId: undefined }
    );
    expect(hook.result.current.inlineDraft?.afterClientId).toBe(createdTask.clientId);

    hook.rerender({ allTasks: [firstTask, createdTask, secondTask] });

    const draftRow = hook.result.current.flattenedTasks.find(isInlineTaskDraftRow);
    expect(draftRow).toBeTruthy();
    expect(
      hook.result.current.flattenedTasks.map((row) => row.clientId)
    ).toEqual([firstTask.clientId, createdTask.clientId, draftRow!.clientId, secondTask.clientId]);

    hook.unmount();
    hook.container.remove();
  });

  test("starting a top-level draft inserts it before the first root task without creating a task", () => {
    const firstTask = createTask();
    const secondTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      rank: "0|b:",
    });

    const hook = createController([firstTask, secondTask]);

    act(() => {
      hook.result.current.beginInlineTaskDraftAtTop();
    });

    const draftRow = hook.result.current.flattenedTasks.find(isInlineTaskDraftRow);
    expect(draftRow).toBeTruthy();
    expect(hook.addTask).not.toHaveBeenCalled();
    expect(
      hook.result.current.flattenedTasks.map((row) => row.clientId)
    ).toEqual([draftRow!.clientId, firstTask.clientId, secondTask.clientId]);

    hook.unmount();
    hook.container.remove();
  });

  test("starts no inline draft when adding tasks is not allowed", () => {
    const task = createTask();
    const hook = createController([task], { allowAddTask: false });

    act(() => {
      hook.result.current.beginInlineTaskDraftAtTop();
      hook.result.current.beginInlineTaskDraft({ afterClientId: task.clientId });
      hook.result.current.beginInlineTaskDraft({ beforeClientId: task.clientId });
    });

    expect(hook.result.current.flattenedTasks.some(isInlineTaskDraftRow)).toBe(false);

    hook.unmount();
    hook.container.remove();
  });

  test("drops an open inline draft when adding tasks stops being allowed", () => {
    const task = createTask();
    const hook = createController([task]);

    act(() => hook.result.current.beginInlineTaskDraftAtTop());
    expect(hook.result.current.flattenedTasks.some(isInlineTaskDraftRow)).toBe(true);

    hook.rerender({ allTasks: [task], allowAddTask: false });
    act(() => hook.result.current.commitInlineTaskDraft("Late title", "blur"));

    expect(hook.result.current.flattenedTasks.some(isInlineTaskDraftRow)).toBe(false);
    expect(hook.addTask).not.toHaveBeenCalled();

    hook.unmount();
    hook.container.remove();
  });

  test("cancelling an empty inline draft removes it without creating or deleting tasks", () => {
    const firstTask = createTask();
    const hook = createController([firstTask]);

    act(() => {
      hook.result.current.beginInlineTaskDraft({
        afterClientId: firstTask.clientId,
        parentId: null,
      });
    });

    act(() => {
      hook.result.current.cancelInlineTaskDraft();
    });

    expect(hook.addTask).not.toHaveBeenCalled();
    expect(hook.result.current.inlineDraft).toBeNull();
    expect(hook.result.current.flattenedTasks.some(isInlineTaskDraftRow)).toBe(false);

    hook.unmount();
    hook.container.remove();
  });

  test("blurring an empty inline draft removes it without creating a task", () => {
    const firstTask = createTask();
    const hook = createController([firstTask]);

    act(() => {
      hook.result.current.beginInlineTaskDraft({
        afterClientId: firstTask.clientId,
        parentId: null,
      });
    });

    act(() => {
      hook.result.current.commitInlineTaskDraft("", "blur");
    });

    expect(hook.addTask).not.toHaveBeenCalled();
    expect(hook.result.current.inlineDraft).toBeNull();

    hook.unmount();
    hook.container.remove();
  });

  test("bulk status change preserves selection when updated tasks remain visible", () => {
    const firstTask = createTask();
    const secondTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Second",
      rank: "0|b:",
    });
    const hook = createController([firstTask, secondTask]);

    act(() => {
      hook.result.current.handleSelectRow(createMouseEvent(), firstTask.clientId);
    });
    act(() => {
      hook.result.current.handleSelectRow(
        createMouseEvent({ metaKey: true }),
        secondTask.clientId
      );
    });

    act(() => {
      hook.result.current.handleBulkStatusChange(Status.DONE);
    });

    expect(hook.bulkUpdateStatus).toHaveBeenCalledWith(
      [firstTask._id, secondTask._id],
      Status.DONE
    );
    expect(hook.result.current.selectedIds).toEqual(
      new Set([firstTask.clientId, secondTask.clientId])
    );

    hook.unmount();
    hook.container.remove();
  });

  test("bulk task type change converts selected client IDs to task IDs", () => {
    const firstTask = createTask();
    const secondTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Second",
      rank: "0|b:",
    });
    const hook = createController([firstTask, secondTask]);

    act(() => {
      hook.result.current.handleSelectRow(createMouseEvent(), firstTask.clientId);
    });
    act(() => {
      hook.result.current.handleSelectRow(
        createMouseEvent({ metaKey: true }),
        secondTask.clientId
      );
    });
    act(() => {
      hook.result.current.handleBulkTaskTypeChange(
        [firstTask.clientId, secondTask.clientId],
        "bug"
      );
    });

    expect(hook.bulkUpdateTaskType).toHaveBeenCalledWith(
      [firstTask._id, secondTask._id],
      "bug"
    );
    expect(hook.result.current.selectedIds).toEqual(
      new Set([firstTask.clientId, secondTask.clientId])
    );

    hook.unmount();
    hook.container.remove();
  });

  test("bulk completing selected active tasks clears selection immediately", () => {
    const firstTask = createTask();
    const secondTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Second",
      rank: "0|b:",
    });
    const hook = createController([firstTask, secondTask], { statusFilter: "active" });

    act(() => {
      hook.result.current.handleSelectRow(createMouseEvent(), firstTask.clientId);
    });
    act(() => {
      hook.result.current.handleSelectRow(
        createMouseEvent({ metaKey: true }),
        secondTask.clientId
      );
    });

    act(() => {
      hook.result.current.handleBulkComplete();
    });

    expect(hook.bulkUpdateStatus).toHaveBeenCalledWith(
      [firstTask._id, secondTask._id],
      Status.DONE
    );
    expect(hook.result.current.selectedIds).toEqual(new Set());

    hook.unmount();
    hook.container.remove();
  });

  test("bulk delete keeps selection until the caller confirms", () => {
    const firstTask = createTask();
    const secondTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Second",
      rank: "0|b:",
    });
    const hook = createController([firstTask, secondTask]);

    act(() => {
      hook.result.current.handleSelectRow(createMouseEvent(), firstTask.clientId);
    });
    act(() => {
      hook.result.current.handleSelectRow(
        createMouseEvent({ metaKey: true }),
        secondTask.clientId
      );
    });

    act(() => {
      hook.result.current.handleBulkDelete();
    });

    expect(hook.bulkDelete).toHaveBeenCalledWith([firstTask._id, secondTask._id]);
    expect(hook.result.current.selectedIds).toEqual(
      new Set([firstTask.clientId, secondTask.clientId])
    );

    hook.unmount();
    hook.container.remove();
  });

  test("backspace on the top-level add-task input focuses the end of the last task", () => {
    const firstTask = createTask();
    const lastTask = createTask({
      _id: "task-2" as Task["_id"],
      clientId: "client-2",
      refNumber: 2,
      refId: "OS-2",
      name: "Last",
      rank: "0|b:",
    });
    const hook = createController([firstTask, lastTask]);
    const preventDefault = vi.fn();

    act(() => {
      hook.result.current.handleAddTaskKeyDown({
        key: "Backspace",
        preventDefault,
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(hook.focusInput).toHaveBeenCalledWith(lastTask.clientId, "end");

    hook.unmount();
    hook.container.remove();
  });

  test("'# Name' on the top-level add-task input creates a section instead of a task", () => {
    const onCreateSection = vi.fn();
    const hook = createController([], { onCreateSection });

    act(() => {
      hook.result.current.setAddTaskValue("#  Design review");
    });
    act(() => {
      hook.result.current.handleAddTaskKeyDown({
        key: "Enter",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(onCreateSection).toHaveBeenCalledWith("Design review");
    expect(hook.addTask).not.toHaveBeenCalled();
    expect(hook.result.current.addTaskValue).toBe("");

    hook.unmount();
    hook.container.remove();
  });

  test("pressing Enter on the top-level add-task input extracts trailing tags", () => {
    const hook = createController([]);
    const preventDefault = vi.fn();

    act(() => {
      hook.result.current.setAddTaskValue("Ship release notes #release #QA");
    });

    act(() => {
      hook.result.current.handleAddTaskKeyDown({
        key: "Enter",
        preventDefault,
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(hook.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ship release notes",
        tags: ["release", "QA"],
      }),
      { parentId: undefined }
    );
    expect(hook.result.current.addTaskValue).toBe("");

    hook.unmount();
    hook.container.remove();
  });

  test("pressing Enter on the top-level add-task input infers task type", () => {
    const hook = createController([]);
    const preventDefault = vi.fn();

    act(() => {
      hook.result.current.setAddTaskValue("Fix crash #mobile #bug");
    });

    act(() => {
      hook.result.current.handleAddTaskKeyDown({
        key: "Enter",
        preventDefault,
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(hook.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Fix crash",
        tags: ["mobile"],
        taskType: expect.objectContaining({ key: "bug" }),
      }),
      { parentId: undefined }
    );

    hook.unmount();
    hook.container.remove();
  });

  test("pressing Enter on the top-level add-task input keeps tags-only text as the title", () => {
    const hook = createController([]);
    const preventDefault = vi.fn();

    act(() => {
      hook.result.current.setAddTaskValue("#release #QA");
    });

    act(() => {
      hook.result.current.handleAddTaskKeyDown({
        key: "Enter",
        preventDefault,
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(hook.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "#release #QA",
        tags: [],
      }),
      { parentId: undefined }
    );
    expect(hook.result.current.addTaskValue).toBe("");

    hook.unmount();
    hook.container.remove();
  });

  test("blurring the top-level add-task input extracts trailing tags", () => {
    const hook = createController([]);

    act(() => {
      hook.result.current.setAddTaskValue("Ship release notes #release #QA");
    });

    act(() => {
      hook.result.current.handleAddTaskBlur();
    });

    expect(hook.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ship release notes",
        tags: ["release", "QA"],
      }),
      { parentId: undefined }
    );
    expect(hook.result.current.addTaskValue).toBe("");

    hook.unmount();
    hook.container.remove();
  });
});

test("grouped lists omit the absent root input from keyboard navigation", () => {
 const spy = vi.spyOn(keyboardNavigation, "useKeyboardNavigation");
 createController([createTask()], {allowRootAddTask: false});
 expect(spy.mock.calls.at(-1)?.[0].navigableIds).not.toContain("add-root");
 spy.mockRestore();
});


describe("grouped inline creation", () => {
  test("Enter after the last task keeps an inline draft when the root footer is absent", () => {
    const task = createTask();
    const hook = createController([task], { allowRootAddTask: false });
    act(() => hook.result.current.beginInlineTaskDraft({ afterClientId: task.clientId }));
    expect(hook.result.current.inlineDraft?.afterClientId).toBe(task.clientId);
    hook.unmount();
    hook.container.remove();
  });

  test("commits with anchor group defaults and explicit Owner options", () => {
    const task = createTask();
    const hook = createController([task], {
      allowRootAddTask: false,
      resolveDraft: () => ({ defaults: { priority: Priority.HIGH }, options: { assigneeId: null } }),
    });
    act(() => hook.result.current.beginInlineTaskDraft({ beforeClientId: task.clientId }));
    act(() => hook.result.current.commitInlineTaskDraft("Grouped task", "enter"));
    expect(hook.addTask).toHaveBeenCalledWith(expect.objectContaining({ priority: Priority.HIGH }), expect.objectContaining({ assigneeId: null, beforeId: task._id }));
    hook.unmount();
    hook.container.remove();
  });
});

test("outdenting an empty terminal child input keeps a root draft when grouping has no global input", () => {
  const parent = createTask();
  const child = createTask({ _id: "child" as Task["_id"], clientId: "child", parentId: parent._id });
  const hook = createController([parent, child], { allowRootAddTask: false });
  act(() => hook.result.current.toggleExpanded(parent._id));
  act(() => hook.result.current.moveAddTaskInputHierarchy(`add-${parent._id}`, "shallower"));
  expect(hook.result.current.inlineDraft).toMatchObject({ parentId: null, afterClientId: parent.clientId });
  hook.unmount();
  hook.container.remove();
});
