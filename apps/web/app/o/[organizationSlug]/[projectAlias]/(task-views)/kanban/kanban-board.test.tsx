/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  KanbanBoard,
  type BoardAssignableUser,
} from "./kanban-board";
import { createDefaultTask } from "@/lib/tasks/defaults";
import { Status } from "@/lib/tasks/status";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import type { Id } from "@/convex/_generated/dataModel";
import type { Task } from "@/lib/tasks/types";

// Counts card-body renders: TaskRefWithType renders once per KanbanCard render.
const taskRefRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/components/blocks/tasks/task-ref-with-type", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/blocks/tasks/task-ref-with-type")>();
  return {
    ...actual,
    TaskRefWithType: (props: Parameters<typeof actual.TaskRefWithType>[0]) => {
      taskRefRenders.count += 1;
      return <actual.TaskRefWithType {...props} />;
    },
  };
});

// Editable cards mount the assignee directory query.
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
  useConvex: () => ({}),
}));

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const id = overrides._id ?? (`task-${overrides.refNumber ?? 1}` as Id<"tasks">);

  return {
    _id: id,
    clientId: String(overrides.clientId ?? id),
    ...createDefaultTask({
      refNumber: overrides.refNumber ?? 1,
      refId: overrides.refId ?? "OS-1",
      name: overrides.name ?? "Task",
      description: overrides.description ?? null,
      status: overrides.status ?? Status.TODO,
      taskType: overrides.taskType ?? resolveTaskTypeSummary("task"),
      priority: overrides.priority ?? "None",
      rank: overrides.rank ?? "a0",
    }),
    ...overrides,
  };
}

function makeAssignableUser(
  overrides: Partial<BoardAssignableUser> = {}
): BoardAssignableUser {
  const id = overrides._id ?? (`user-${overrides.name ?? "one"}` as Id<"users">);

  return {
    _id: id,
    name: overrides.name ?? "User One",
    avatarUrl: overrides.avatarUrl ?? null,
  };
}

function userAssignee(
  userId: string,
  name: string | null = null
): NonNullable<Task["assignee"]> {
  return {
    type: "user",
    userId: userId as Id<"users">,
    name,
    avatarUrl: null,
  };
}

describe("KanbanBoard", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the workflow columns in the expected order", () => {
    render(<KanbanBoard />);

    const columnLabels = [
      Status.TODO,
      Status.PLANNING,
      Status.IN_PROGRESS,
      Status.IN_REVIEW,
      Status.BLOCKED,
      Status.DONE,
    ].map((label) => screen.getByText(label));

    for (let index = 0; index < columnLabels.length - 1; index += 1) {
      expect(
        columnLabels[index].compareDocumentPosition(columnLabels[index + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).not.toBe(0);
    }
  });

  test("renders a shared scrollable board container", () => {
    const { container } = render(<KanbanBoard />);

    const scrollContainer = container.firstElementChild as HTMLDivElement | null;
    expect(scrollContainer?.className).toContain("overflow-auto");

    const track = scrollContainer?.firstElementChild as HTMLDivElement | null;
    expect(track?.className).toContain("min-w-max");
    expect(track?.className).toContain("min-h-full");
  });

  test("lifting a card renders only the drag overlay, not every card body", async () => {
    const tasks = [1, 2, 3].map((n) =>
      makeTask({
        _id: `task-${n}` as Id<"tasks">,
        refNumber: n,
        refId: `OS-${n}`,
        name: `Card ${n}`,
        status: Status.TODO,
      })
    );
    render(<KanbanBoard tasks={tasks} onTaskReorder={vi.fn()} />);
    const before = taskRefRenders.count;

    const pointer = { button: 0, isPrimary: true, pointerType: "mouse", pointerId: 1 };
    fireEvent.pointerDown(screen.getByText("Card 1"), { ...pointer, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { ...pointer, clientX: 40, clientY: 10 });

    // Source card stays in place and the overlay clone renders too.
    expect(screen.getAllByText("Card 1")).toHaveLength(2);
    // Only that clone rendered a card body; the board's cards were skipped.
    expect(taskRefRenders.count - before).toBe(1);

    // Release; dnd-kit keeps swallowing clicks for 50ms after a drop.
    fireEvent.pointerUp(document, { ...pointer, clientX: 40, clientY: 10 });
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  test("forwards card clicks with the source task", () => {
    const task = makeTask({
      refId: "OS-1",
      name: "Open details from board",
      status: Status.TODO,
    });
    const handleTaskClick = vi.fn();

    render(<KanbanBoard tasks={[task]} onTaskClick={handleTaskClick} />);

    fireEvent.click(screen.getByText("Open details from board"));

    expect(handleTaskClick).toHaveBeenCalledWith(task);
  });

  test("shows card descriptions only when the Show description setting is on", () => {
    const task = makeTask({ name: "Described card", description: "Card description text" });

    render(<KanbanBoard tasks={[task]} />);
    expect(screen.queryByText("Card description text")).toBeNull();
    cleanup();

    window.localStorage.setItem("convoy.task-card-show-description", "1");
    render(<KanbanBoard tasks={[task]} />);
    expect(screen.getByText("Card description text")).toBeDefined();
    window.localStorage.clear();
  });

  test("shows the label chip on cards", () => {
    const label = { _id: "label-1" as Id<"projectLabels">, name: "Frontend", color: "#3b82f6", rank: "a0" };
    const task = makeTask({ name: "Labelled card", labelId: label._id });

    render(<KanbanBoard tasks={[task]} labels={[label]} />);

    const card = screen.getByText("Labelled card").closest("[data-kanban-card]") as HTMLElement;
    expect(within(card).getByText("Frontend")).toBeDefined();
  });

  test("P on a focused card opens its priority picker; I assigns it to me", async () => {
    const task = makeTask({ name: "Keyboard card" });
    const onTaskUpdate = vi.fn();
    render(
      <KanbanBoard
        tasks={[task]}
        currentUserId="user-me"
        onTaskUpdate={onTaskUpdate}
        onTaskClick={vi.fn()}
      />
    );
    const title = screen.getByRole("button", { name: "Open task details for Keyboard card" });
    title.focus();

    fireEvent.keyDown(title, { key: "i" });
    expect(onTaskUpdate).toHaveBeenCalledWith(task._id, { assigneeId: "user-me" });

    fireEvent.keyDown(title, { key: "p" });
    expect(await screen.findByPlaceholderText("Search priorities...")).toBeDefined();
  });

  test("property keys do nothing on a read-only board", () => {
    const task = makeTask({ name: "Read-only card" });
    render(<KanbanBoard tasks={[task]} onTaskClick={vi.fn()} />);
    const title = screen.getByRole("button", { name: "Open task details for Read-only card" });
    title.focus();

    fireEvent.keyDown(title, { key: "p" });

    expect(screen.queryByPlaceholderText("Search priorities...")).toBeNull();
  });

  test("adds end scroll padding for the open task sidebar", () => {
    const task = makeTask({ refId: "OS-1", status: Status.TODO });

    const { container, rerender } = render(
      <KanbanBoard tasks={[task]} scrollEndPaddingPx={420} />
    );

    const track = container.querySelector(".min-w-max") as HTMLElement;
    expect(track.style.paddingRight).toBe("420px");

    rerender(<KanbanBoard tasks={[task]} scrollEndPaddingPx={0} />);
    expect(track.style.paddingRight).toBe("");
  });

  test("opens the task context menu on card right-click when actions are provided", () => {
    const task = makeTask({
      refId: "OS-1",
      name: "Card with menu",
      status: Status.TODO,
    });
    const onDuplicate = vi.fn();

    const { rerender } = render(<KanbanBoard tasks={[task]} />);

    fireEvent.contextMenu(screen.getByText("Card with menu"));
    expect(screen.queryByText("Duplicate task")).toBeNull();

    rerender(
      <KanbanBoard
        tasks={[task]}
        cardContextMenu={{
          onDelete: vi.fn(),
          onArchive: vi.fn(),
          onUnarchive: vi.fn(),
          onDuplicate,
          onUpdateStatus: vi.fn(),
          onOpenDetails: vi.fn(),
        }}
      />
    );

    fireEvent.contextMenu(screen.getByText("Card with menu"));
    fireEvent.click(screen.getByText("Duplicate task"));

    expect(onDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ refId: "OS-1" })
    );
  });

  test("card menu offers the property submenus with the keys a focused card handles", () => {
    const task = makeTask({ refId: "OS-1", name: "Card with hints", status: Status.TODO });
    render(
      <KanbanBoard
        tasks={[task]}
        projectId={"project_1" as Id<"projects">}
        onTaskUpdate={vi.fn()}
        cardContextMenu={{
          onDelete: vi.fn(),
          onArchive: vi.fn(),
          onUnarchive: vi.fn(),
          onDuplicate: vi.fn(),
          onUpdateStatus: vi.fn(),
          onOpenDetails: vi.fn(),
        }}
      />
    );

    fireEvent.contextMenu(screen.getByText("Card with hints"));
    const keycaps = (name: string) =>
      Array.from(
        screen.getByRole("menuitem", { name }).querySelectorAll('[data-slot="kbd"]'),
        (kbd) => kbd.textContent
      );

    expect(keycaps("Priority")).toEqual(["P"]);
    expect(keycaps("Assignee")).toEqual(["A"]);
    expect(keycaps("Label")).toEqual(["L"]);
    // Table-only keys (Space, Cmd+D) do nothing on a card, so no hint.
    expect(keycaps("Duplicate task")).toEqual([]);
  });

  test("renders cards as draggable only when a reorder handler is provided", () => {
    const task = makeTask({
      refId: "OS-1",
      name: "Draggable board card",
      status: Status.TODO,
    });

    const { container, rerender } = render(<KanbanBoard tasks={[task]} />);

    expect(
      container.querySelector('[data-board-dnd-card="disabled"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-board-dnd-card="enabled"]')).toBeNull();

    rerender(<KanbanBoard tasks={[task]} onTaskReorder={vi.fn()} />);

    expect(
      container.querySelector('[data-board-dnd-card="enabled"]')
    ).not.toBeNull();
  });

  test("creates a top card with status defaults and a before anchor", () => {
    const handleTaskCreate = vi.fn();
    const firstTodo = makeTask({
      _id: "task-todo-1" as Id<"tasks">,
      clientId: "task-todo-1",
      refId: "OS-1",
      name: "First todo",
      status: Status.TODO,
    });

    render(
      <KanbanBoard tasks={[firstTodo]} onTaskCreate={handleTaskCreate} />
    );

    const todoColumn = screen.getByText(Status.TODO).closest("section");
    expect(todoColumn).toBeTruthy();
    fireEvent.click(within(todoColumn as HTMLElement).getByRole("button", {
      name: `Add task to ${Status.TODO}`,
    }));
    const input = within(todoColumn as HTMLElement).getByLabelText(
      `Task title for ${Status.TODO}`
    );
    fireEvent.change(input, { target: { value: "New todo #tag" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(handleTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New todo",
        status: Status.TODO,
        tags: ["tag"],
      }),
      { beforeId: "task-todo-1" }
    );
  });

  test("creates a bottom card with an after anchor", () => {
    const handleTaskCreate = vi.fn();
    const firstDone = makeTask({
      _id: "task-done-1" as Id<"tasks">,
      clientId: "task-done-1",
      refId: "OS-1",
      name: "First done",
      status: Status.DONE,
    });
    const secondDone = makeTask({
      _id: "task-done-2" as Id<"tasks">,
      clientId: "task-done-2",
      refId: "OS-2",
      name: "Second done",
      status: Status.CANCELED,
    });

    render(
      <KanbanBoard
        tasks={[firstDone, secondDone]}
        onTaskCreate={handleTaskCreate}
      />
    );

    const doneColumn = screen.getByText(Status.DONE).closest("section");
    expect(doneColumn).toBeTruthy();
    const input = within(doneColumn as HTMLElement).getByLabelText(
      `Task title for ${Status.DONE}`
    );
    fireEvent.change(input, { target: { value: "New done" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(handleTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New done",
        status: Status.DONE,
      }),
      { afterId: "task-done-2" }
    );
  });

  test("creates in an empty column without a rank anchor", () => {
    const handleTaskCreate = vi.fn();

    render(<KanbanBoard tasks={[]} onTaskCreate={handleTaskCreate} />);

    const todoColumn = screen.getByText(Status.TODO).closest("section");
    expect(todoColumn).toBeTruthy();
    const input = within(todoColumn as HTMLElement).getByLabelText(
      `Task title for ${Status.TODO}`
    );
    fireEvent.change(input, { target: { value: "Empty column task" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(handleTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Empty column task",
        status: Status.TODO,
      }),
      undefined
    );
  });

  test("creates assignee-group cards with group defaults and rank anchors", () => {
    const handleTaskCreate = vi.fn();
    const assignedUser = makeAssignableUser({
      _id: "user-1" as Id<"users">,
      name: "Ada Lovelace",
    });
    const firstAssigned = makeTask({
      _id: "task-assigned-1" as Id<"tasks">,
      clientId: "task-assigned-1",
      refId: "OS-1",
      name: "Assigned first",
      assignee: userAssignee("user-1", "Ada Lovelace"),
    });

    render(
      <KanbanBoard
        boardGroupBy="assignee"
        assignableUsers={[assignedUser]}
        tasks={[firstAssigned]}
        onTaskCreate={handleTaskCreate}
      />
    );

    const userColumn = screen.getByText("Ada Lovelace").closest("section");
    expect(userColumn).toBeTruthy();
    fireEvent.click(within(userColumn as HTMLElement).getByRole("button", {
      name: "Add task to Ada Lovelace",
    }));
    const input = within(userColumn as HTMLElement).getByLabelText(
      "Task title for Ada Lovelace"
    );
    fireEvent.change(input, { target: { value: "New assigned" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(handleTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New assigned",
        assignee: {
          type: "user",
          userId: "user-1",
          name: "Ada Lovelace",
          avatarUrl: null,
        },
      }),
      { beforeId: "task-assigned-1" }
    );
  });

  test("creates unassigned cards with group defaults", () => {
    const handleTaskCreate = vi.fn();

    render(
      <KanbanBoard
        boardGroupBy="assignee"
        tasks={[]}
        onTaskCreate={handleTaskCreate}
      />
    );

    const unassignedColumn = screen.getByText("No assignee").closest("section");
    expect(unassignedColumn).toBeTruthy();
    const input = within(unassignedColumn as HTMLElement).getByLabelText(
      "Task title for No assignee"
    );
    fireEvent.change(
      input,
      { target: { value: "No owner" } }
    );
    fireEvent.keyDown(
      input,
      { key: "Enter" }
    );
    expect(handleTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "No owner", assignee: null }),
      undefined
    );
  });

  test("creates priority-group cards with group defaults", () => {
    const handleTaskCreate = vi.fn();

    render(
      <KanbanBoard
        boardGroupBy="priority"
        tasks={[]}
        onTaskCreate={handleTaskCreate}
      />
    );
    const highColumn = screen.getByText("High").closest("section");
    expect(highColumn).toBeTruthy();
    const input = within(highColumn as HTMLElement).getByLabelText(
      "Task title for High"
    );
    fireEvent.change(input, {
      target: { value: "Important task" },
    });
    fireEvent.keyDown(input, {
      key: "Enter",
    });
    expect(handleTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Important task", priority: "High" }),
      undefined
    );
  });

  test("creates task-type group cards with group defaults", () => {
    const handleTaskCreate = vi.fn();

    render(
      <KanbanBoard
        boardGroupBy="type"
        tasks={[]}
        onTaskCreate={handleTaskCreate}
      />
    );
    const bugColumn = screen.getByText("Bug").closest("section");
    expect(bugColumn).toBeTruthy();
    const input = within(bugColumn as HTMLElement).getByLabelText("Task title for Bug");
    fireEvent.change(input, {
      target: { value: "Broken thing #feature" },
    });
    fireEvent.keyDown(input, {
      key: "Enter",
    });
    expect(handleTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Broken thing",
        taskType: expect.objectContaining({ key: "bug" }),
      }),
      undefined
    );
  });

  test("disables create for a legacy column with no allowed status", () => {
    render(
      <KanbanBoard
        tasks={[
          makeTask({
            refId: "OS-1",
            name: "Legacy blocked",
            status: Status.BLOCKED,
          }),
        ]}
        allowedStatuses={[Status.TODO]}
        onTaskCreate={vi.fn()}
      />
    );

    const blockedColumn = screen.getByText(Status.BLOCKED).closest("section");
    expect(blockedColumn).toBeTruthy();
    expect(
      within(blockedColumn as HTMLElement).getByRole("button", {
        name: `Add task to ${Status.BLOCKED}`,
      }).hasAttribute("disabled")
    ).toBe(true);
    expect(
      within(blockedColumn as HTMLElement).queryByRole(
        "textbox",
        { name: `Task title for ${Status.BLOCKED}` }
      )
    ).toBeNull();
  });
});

describe("KanbanBoard rows", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  const urgent = makeTask({
    _id: "task-urgent" as Id<"tasks">,
    clientId: "task-urgent",
    name: "Urgent card",
    priority: "High",
    status: Status.IN_PROGRESS,
  });

  test("renders a lane per row and creates cell tasks with both values", () => {
    const handleTaskCreate = vi.fn();
    render(<KanbanBoard tasks={[urgent]} boardRowGroupBy="priority" onTaskCreate={handleTaskCreate} />);
    const high = screen.getByRole("region", { name: "High" });
    expect(within(high).getByText("Urgent card")).toBeDefined();
    expect(within(screen.getByRole("region", { name: "Low" })).queryByText("Urgent card")).toBeNull();

    const input = within(high).getByLabelText(`Task title for ${Status.IN_PROGRESS} · High`);
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handleTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New", status: Status.IN_PROGRESS, priority: "High" }),
      { afterId: "task-urgent" }
    );
  });

  test("collapsing a row hides its cells and survives a remount", () => {
    const props = {
      tasks: [urgent],
      boardRowGroupBy: "priority" as const,
      projectId: "project-1" as Id<"projects">,
      currentUserId: "user-1",
      listRef: "SPRINT-1",
    };
    render(<KanbanBoard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse High" }));
    expect(screen.queryByText("Urgent card")).toBeNull();
    cleanup();
    render(<KanbanBoard {...props} />);
    expect(screen.getByRole("button", { name: "Expand High" })).toBeDefined();
    expect(screen.queryByText("Urgent card")).toBeNull();
  });

  test("impossible Owner × Assignee cells explain why and offer no input", () => {
    const users = [makeAssignableUser({ name: "Alice" }), makeAssignableUser({ name: "Bob" })];
    render(
      <KanbanBoard boardGroupBy="assignee" boardRowGroupBy="owner" assignableUsers={users} onTaskCreate={vi.fn()} />
    );
    const alice = within(screen.getByRole("region", { name: "Alice" }));
    expect(alice.getByText("Assigning Bob makes them the owner")).toBeDefined();
    expect(alice.getByText("No assignee means no owner")).toBeDefined();
    expect(alice.queryByLabelText("Task title for Bob · Alice")).toBeNull();
    expect(alice.getByLabelText("Task title for Alice · Alice")).toBeDefined();
  });

  test("cell add inputs stay visible on touch screens, which have no hover", () => {
    render(<KanbanBoard tasks={[urgent]} boardRowGroupBy="priority" onTaskCreate={vi.fn()} />);
    const input = within(screen.getByRole("region", { name: "High" })).getByLabelText(`Task title for ${Status.IN_PROGRESS} · High`);
    expect(input.parentElement?.className).toContain("pointer-coarse:opacity-100");
  });

  test("expanded lanes end with a line above the next row header", () => {
    render(<KanbanBoard tasks={[urgent]} boardRowGroupBy="priority" onTaskCreate={vi.fn()} />);
    const header = screen.getByRole("button", { name: "Collapse High" }).parentElement!.parentElement!;
    expect(header.nextElementSibling?.className.split(" ")).toContain("border-b");
  });

  test("mobile row headers carry the column lines, with the title inside them", () => {
    render(<KanbanBoard tasks={[urgent]} boardRowGroupBy="priority" onTaskCreate={vi.fn()} />);
    const label = screen.getByRole("button", { name: "Collapse High" }).parentElement!;
    expect(label.className).toContain("max-md:pl-[calc(3.75vw+0.75rem)]");
    const lines = label.parentElement!.querySelector('[data-slot="board-column-lines"]');
    expect(lines?.className).toContain("md:hidden");
    expect([...(lines?.children ?? [])].every((line) => line.className.includes("border-r"))).toBe(true);
  });

  test("mobile lines line up: the first lane is as wide as a cell plus its outer left line", () => {
    const { container } = render(<KanbanBoard tasks={[urgent]} boardRowGroupBy="priority" onTaskCreate={vi.fn()} />);
    const firstHeader = screen.getAllByText(Status.IN_PROGRESS)[0].closest(".flex-none");
    const firsts = [
      firstHeader?.parentElement?.firstElementChild,
      container.querySelector('[data-slot="board-column-lines"]')?.firstElementChild,
      container.querySelector('[data-slot="board-lane-filler"]')?.firstElementChild,
    ];
    for (const lane of firsts) expect(lane?.className).toContain("max-md:first:w-[calc(92.5vw+1px)]");
  });

  test("cells fill their lane and column lines run to the board bottom", () => {
    const { container } = render(<KanbanBoard tasks={[urgent]} boardRowGroupBy="priority" onTaskCreate={vi.fn()} />);
    const input = within(screen.getByRole("region", { name: "High" })).getByLabelText(`Task title for ${Status.IN_PROGRESS} · High`);
    expect(input.closest("section")?.className).toContain("min-h-full");
    const filler = container.querySelector('[data-slot="board-lane-filler"]');
    expect(filler?.className).toContain("flex-1");
    // One empty lane per column, each drawing the column's line.
    const lanes = [...(filler?.children ?? [])];
    expect(lanes.length).toBeGreaterThan(1);
    expect(lanes.every((lane) => lane.className.includes("border-r"))).toBe(true);
  });
});
