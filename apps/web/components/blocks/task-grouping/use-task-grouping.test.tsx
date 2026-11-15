import { toast } from "sonner";
// @vitest-environment jsdom
import * as React from "react";
import {
  act,
  renderHook,
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useTaskGrouping } from "./use-task-grouping";
import { useCollapsedGroups } from "./preferences";
import { createDefaultTask } from "@/lib/tasks/defaults";
import type { Id } from "@/convex/_generated/dataModel";
import type { Task, TaskTreeNode } from "@/lib/tasks/types";
import { ProjectRole } from "@/lib/authz/roles";
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, startTransition: vi.fn(actual.startTransition) };
});
const mocks = vi.hoisted(() => ({ role: "project_admin" }));
vi.mock("@/lib/authz/use-project-permissions", () => ({
  useProjectPermissions: () => ({ myRole: mocks.role }),
}));
vi.mock("@/lib/tasks/hooks/use-assignable-task-assignees", () => ({
  useAssignableTaskAssignees: () => ({
    users: [{ value: { userId: "alice" }, label: "Alice", details: {} }],
    projectAgents: [],
  }),
}));
vi.mock("@/lib/tasks/hooks/use-project-labels", () => ({
  useProjectLabels: () => ({ labels: [] }),
}));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("@/lib/tasks/hooks/use-task-sections", () => ({
  useTaskSections: () => ({ sections: [] }),
}));
vi.mock("@/lib/preferences/use-user-preferences", () => ({
  useSectionAppearance: () => ({
    sectionHeaderStyle: "compact",
    sectionColorStyle: "tint",
  }),
}));
function task(id: string, rank: string, overrides: Partial<Task> = {}): Task {
  return {
    ...createDefaultTask(),
    _id: id as Id<"tasks">,
    clientId: id,
    rank,
    ...overrides,
  };
}
const alice = {
  type: "user" as const,
  userId: "alice" as Id<"users">,
  name: "Alice",
  avatarUrl: null,
};
function setup(tasks: Task[]) {
  const updateTask = vi.fn();
  const moveTask = vi.fn();
  const reorderMultiple = vi.fn();
  const setParent = vi.fn();
  const addTask = vi.fn(() => "new");
  const hook = renderHook(() =>
    useTaskGrouping({
      projectId: "project" as Id<"projects">,
      userId: "user",
      listRef: null,
      groupBy: "owner",
      tasks,
      statusFilter: "all",
      assigneeFilter: null,
      archived: false,
      addTask,
      updateTask,
      moveTask,
      reorderMultiple,
      setParent,
    }),
  );
  return { ...hook, updateTask, addTask, moveTask, reorderMultiple, setParent };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = ProjectRole.PROJECT_ADMIN;
  localStorage.clear();
});

test("Owner drop delegates combined membership and rank placement to moveTask", () => {
  const { result, moveTask, updateTask } = setup([
    task("source", "0|100000:"),
    task("hidden", "0|200000:"),
    task("target", "0|300000:", { assignee: alice }),
  ]);
  act(() => {
    result.current.drop(["source"], "target", "before");
  });
  expect(moveTask).toHaveBeenCalledWith(
    "source",
    { assigneeId: "alice", assigneeDetails: alice },
    { targetTaskId: "target", position: "before" },
  );
  expect(updateTask).not.toHaveBeenCalled();
});
test("same-owner reorder and center drops fall through to existing task DnD", () => {
  const { result, moveTask, updateTask } = setup([
    task("source", "0|100000:", { assignee: alice }),
    task("target", "0|300000:", { assignee: alice }),
  ]);
  expect(result.current.drop(["source"], "target", "after")).toBe(false);
  expect(result.current.drop(["source"], "target", "inside")).toBe(false);
  expect(moveTask).not.toHaveBeenCalled();
  expect(updateTask).not.toHaveBeenCalled();
});
test("viewer cannot drop on groups", () => {
  mocks.role = ProjectRole.VIEWER;
  const { result, updateTask } = setup([task("source", "0|100000:")]);
  act(() => {
    result.current.drop(["source"], "group:owner:alice", "before");
  });
  expect(updateTask).not.toHaveBeenCalled();
});
test("collapse removes the complete tree from navigation and persists for the user", () => {
  const parent = task("parent", "0|100000:", { assignee: alice });
  const child = task("child", "0|200000:", { parentId: parent._id });
  const { result } = setup([parent, child]);
  const header = result.current.renderHeader({
    rowType: "section",
    clientId: "group:owner:alice",
  });
  act(() => {
    header?.props.toggle();
  });
  expect(
    result.current.transformRows([parent, child] as TaskTreeNode[]),
  ).toEqual([]);
  const reopened = setup([parent, child]);
  expect(
    reopened.result.current.transformRows([parent, child] as TaskTreeNode[]),
  ).toEqual([]);
});

test("header counts respect the active filter", () => {
  const tasks = [
    task("open", "0|100000:", { assignee: alice }),
    task("done", "0|200000:", { assignee: alice, status: "Done" }),
  ];
  const { result } = renderHook(() =>
    useTaskGrouping({
      projectId: "project" as Id<"projects">,
      listRef: null,
      groupBy: "owner",
      tasks,
      statusFilter: "active",
      assigneeFilter: null,
      archived: false,
      addTask: vi.fn(),
      updateTask: vi.fn(),
      moveTask: vi.fn(),
      reorderMultiple: vi.fn(),
      setParent: vi.fn(),
    }),
  );
  expect(
    result.current.renderHeader({
      rowType: "section",
      clientId: "group:owner:alice",
    })?.props.count,
  ).toBe(1);
});

test("same-group drop that preserves visible order writes nothing", () => {
  const { result, updateTask } = setup([
    task("source", "0|100000:", { assignee: alice }),
    task("hidden", "0|200000:"),
    task("target", "0|300000:", { assignee: alice }),
  ]);
  act(() => {
    result.current.drop(["source"], "target", "before");
  });
  expect(updateTask).not.toHaveBeenCalled();
});
test("multi-task group moves use shared reorder and never write ranks through updateTask", () => {
  const { result, reorderMultiple, updateTask } = setup([
    task("source", "0|100000:"),
    task("source2", "0|150000:"),
    task("target", "0|200000:", { assignee: alice }),
  ]);
  act(() => {
    result.current.drop(["source", "source2"], "target", "before");
  });
  expect(reorderMultiple).toHaveBeenCalledWith(
    ["source", "source2"],
    "target",
    null,
    "before",
  );
  expect(updateTask).toHaveBeenCalledTimes(2);
  for (const [, update] of updateTask.mock.calls)
    expect(update).not.toHaveProperty("rank");
});

test("dropping a selection onto itself does not rewrite membership", () => {
  const { result, updateTask } = setup([
    task("source", "0|100000:"),
    task("target", "0|200000:", { assignee: alice }),
  ]);
  act(() => {
    result.current.drop(["source", "target"], "target", "before");
  });
  expect(updateTask).not.toHaveBeenCalled();
});

test.each(["owner:alice", "owner:unassigned"])(
  "creating in %s preserves the explicit owner with an agent filter",
  (id) => {
    const addTask = vi.fn(() => "new");
    const { result } = renderHook(() =>
      useTaskGrouping({
        projectId: "project" as Id<"projects">,
        listRef: null,
        groupBy: "owner",
        tasks: [],
        statusFilter: "all",
        assigneeFilter: {
          type: "projectAgent",
          projectAgentId: "agent" as Id<"projectAgents">,
        },
        archived: false,
        addTask,
        updateTask: vi.fn(),
        moveTask: vi.fn(),
        reorderMultiple: vi.fn(),
        setParent: vi.fn(),
      }),
    );
    act(() => {
      result.current
        .renderHeader({ rowType: "section", clientId: `group-add:${id}` })
        ?.props.create?.("New task");
    });
    expect(addTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assigneeId: id === "owner:alice" ? "alice" : null,
      }),
    );
  },
);

test("expanded groups end with their own creation row, including empty groups", () => {
  const { result } = setup([]);
  expect(result.current.presentRows([]).map((row) => row.clientId)).toEqual([
    "group:owner:unassigned",
    "group-add:owner:unassigned",
    "group:owner:alice",
    "group-add:owner:alice",
  ]);
  const header = result.current.renderHeader({
    rowType: "section",
    clientId: "group:owner:alice",
  });
  expect(header?.props.create).toBeUndefined();
  act(() => header?.props.toggle());
  expect(
    result.current.presentRows([]).map((row) => row.clientId),
  ).not.toContain("group-add:owner:alice");
});
test("viewers have no group creation rows", () => {
  mocks.role = ProjectRole.VIEWER;
  const { result } = setup([]);
  expect(
    result.current
      .presentRows([])
      .some((row) => row.clientId.startsWith("group-add:")),
  ).toBe(false);
});

test("grouping disables the global creation row", () => {
  const { result } = setup([]);
  expect(result.current.allowRootCreation).toBe(false);
});

afterEach(cleanup);
test("group footer creates once on Enter and blur, and Escape cancels", () => {
  const { result, addTask } = setup([]);
  render(
    result.current.renderHeader({
      rowType: "section",
      clientId: "group-add:owner:alice",
    }),
  );
  const input = screen.getByPlaceholderText("Add task...");
  fireEvent.change(input, { target: { value: "Task" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.blur(input);
  expect(addTask).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: "Discard" } });
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.blur(input);
  expect(addTask).toHaveBeenCalledTimes(1);
});

test("collapse updates run as interruptible transitions", () => {
  const transition = vi.mocked(React.startTransition);
  transition.mockClear();
  const { result } = setup([]);
  act(() =>
    result.current
      .renderHeader({ rowType: "section", clientId: "group:owner:alice" })
      ?.props.toggle(),
  );
  expect(transition).toHaveBeenCalledOnce();
});

test("collapse all persists every group, including empty groups, and groups reopen independently", () => {
  const tasks = [task("unassigned", "0|100000:")];
  const { result, unmount } = setup(tasks);
  act(() => result.current.collapseAll());
  expect(result.current.transformRows(tasks as TaskTreeNode[])).toEqual([]);
  expect(
    result.current.renderHeader({
      rowType: "section",
      clientId: "group:owner:alice",
    })?.props.collapsed,
  ).toBe(true);
  unmount();
  const restored = setup(tasks);
  expect(
    restored.result.current.transformRows(tasks as TaskTreeNode[]),
  ).toEqual([]);
  const empty = restored.result.current.renderHeader({
    rowType: "section",
    clientId: "group:owner:alice",
  });
  expect(empty?.props.collapsed).toBe(true);
  act(() => empty?.props.toggle());
  expect(
    restored.result.current.renderHeader({
      rowType: "section",
      clientId: "group:owner:alice",
    })?.props.collapsed,
  ).toBe(false);
  expect(
    restored.result.current.transformRows(tasks as TaskTreeNode[]),
  ).toEqual([]);
});

describe("grouped draft and boundary navigation", () => {
  test("root drafts follow their anchor inside its group", () => {
    const parent = task("parent", "0|100000:", { assignee: alice });
    const { result } = setup([parent]);
    const draft = {
      rowType: "draft-task" as const,
      clientId: "draft",
      parentId: null,
      depth: 0,
      value: "",
      afterClientId: "parent",
    };
    const rows = result.current.presentRows([
      { ...parent, depth: 0 } as TaskTreeNode,
      draft,
    ]);
    expect(rows.findIndex((row) => row.clientId === "draft")).toBe(
      rows.findIndex((row) => row.clientId === "parent") + 1,
    );
  });

  test("Up opens the previous group and returns its last task, Down opens the next", () => {
    const first = task("first", "0|100000:");
    const last = task("last", "0|200000:");
    const next = task("next", "0|300000:", { assignee: alice });
    const { result } = setup([first, last, next]);
    const rows = [first, last, next].map((t) => ({
      ...t,
      depth: 0,
    })) as TaskTreeNode[];
    act(() => result.current.collapseAll());
    let target: string | undefined;
    act(() => {
      target = result.current.navigate?.(rows, "next", "prev");
    });
    expect(target).toBe("last");
    expect(
      result.current.transformRows(rows).map((row) => row.clientId),
    ).toContain("last");
    act(() => {
      target = result.current.navigate?.(rows, "last", "next");
    });
    expect(target).toBe("next");
    expect(
      result.current.transformRows(rows).map((row) => row.clientId),
    ).toContain("next");
  });
});

test("reveal opens the collapsed group holding a nested task", () => {
  const parent = task("parent", "0|100000:", { assignee: alice });
  const child = task("child", "0|200000:", { parentId: parent._id });
  const other = task("other", "0|300000:");
  const { result } = setup([parent, child, other]);
  const rows = [parent, child, other].map((t) => ({ ...t, depth: t.parentId ? 1 : 0 })) as TaskTreeNode[];
  act(() => result.current.collapseAll());
  act(() => result.current.reveal("child"));
  expect(result.current.transformRows(rows).map((row) => row.clientId)).toEqual(["parent", "child"]);
});

test("mobile group creation uses a compact inset rather than desktop tree indentation", () => {
  const { result } = setup([]);
  render(
    result.current.renderHeader(
      { rowType: "section", clientId: "group-add:owner:alice" },
      { mobile: true },
    ),
  );
  expect(
    screen.getByPlaceholderText("Add task...").parentElement?.style.paddingLeft,
  ).toBe("12px");
});

test("desktop group creation lines up with root tasks, without a group indent", () => {
  const { result } = setup([]);
  render(
    result.current.renderHeader({ rowType: "section", clientId: "group-add:owner:alice" }),
  );
  expect(
    screen.getByPlaceholderText("Add task...").parentElement?.style.paddingLeft,
  ).toBe("52px");
});

test("footer drop appends to the end of the group", () => {
  const { result, moveTask } = setup([
    task("source", "0|100000:"),
    task("first", "0|200000:", { assignee: alice }),
    task("last", "0|300000:", { assignee: alice }),
  ]);
  expect(
    result.current.drop(["source"], "group-add:owner:alice", "before"),
  ).toBe(true);
  expect(moveTask).toHaveBeenCalledWith(
    "source",
    { assigneeId: "alice", assigneeDetails: alice },
    { targetTaskId: "last", position: "after" },
  );
});

test("footer drop moves a task to the end of its own group", () => {
  const { result, moveTask } = setup([
    task("source", "0|100000:", { assignee: alice }),
    task("last", "0|200000:", { assignee: alice }),
  ]);
  expect(
    result.current.drop(["source"], "group-add:owner:alice", "before"),
  ).toBe(true);
  expect(moveTask).toHaveBeenCalledWith(
    "source",
    {},
    { targetTaskId: "last", position: "after" },
  );
});

test("footer drop of the last task in its group writes nothing", () => {
  const { result, moveTask } = setup([
    task("first", "0|100000:", { assignee: alice }),
    task("source", "0|200000:", { assignee: alice }),
  ]);
  expect(
    result.current.drop(["source"], "group-add:owner:alice", "before"),
  ).toBe(true);
  expect(moveTask).not.toHaveBeenCalled();
});

test("keyboard group footer and header navigation reaches tasks", () => {
  const first = task("first", "0|100000:");
  const last = task("last", "0|200000:", { assignee: alice });
  const { result } = setup([first, last]);
  const rows = [first, last].map((t) => ({ ...t, depth: 0 })) as TaskTreeNode[];
  let target: string | undefined;
  act(() => {
    target = result.current.navigate(
      rows,
      "group-add:owner:unassigned",
      "prev",
    );
  });
  expect(target).toBe("first");
  act(() => {
    target = result.current.navigate(
      rows,
      "group-add:owner:unassigned",
      "next",
    );
  });
  expect(target).toBe("last");
});

test("group header and creation input dispatch arrow navigation", () => {
  const { result } = setup([]);
  const onNavigate = vi.fn();
  render(
    result.current.renderHeader(
      { rowType: "section", clientId: "group-add:owner:alice" },
      { onNavigate },
    ),
  );
  fireEvent.keyDown(screen.getByPlaceholderText("Add task..."), {
    key: "ArrowUp",
  });
  expect(onNavigate).toHaveBeenCalledWith("group-add:owner:alice", "prev");
});


test("refused group drops explain why and remain consumed", () => {
  mocks.role = ProjectRole.VIEWER;
  const error = vi.spyOn(toast, "error").mockImplementation(() => "toast");
  const { result, moveTask, setParent } = setup([task("source", "0|100000:")]);
  expect(result.current.drop(["source"], "group:owner:alice", "before")).toBe(true);
  expect(error).toHaveBeenCalledWith("Tasks cannot be moved to this group.");
  expect(moveTask).not.toHaveBeenCalled();
  expect(setParent).not.toHaveBeenCalled();
  error.mockRestore();
});

test("useCollapsedGroups keeps one Set per scope across renders", () => {
  const hook = renderHook(({ scope }) => useCollapsedGroups(scope), { initialProps: { scope: "a" } });
  hook.rerender({ scope: "b" });
  const first = hook.result.current.collapsed;
  hook.rerender({ scope: "b" });
  // A fresh Set every render would invalidate the consumers' memos.
  expect(hook.result.current.collapsed).toBe(first);
});
