/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { KanbanCard } from "./kanban-card";
import { createDefaultTask } from "@/lib/tasks/defaults";
import { Status } from "@/lib/tasks/status";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskAssigneeChange } from "@/lib/tasks/assignees";
import type { Task, TaskAssigneeDetails } from "@/lib/tasks/types";

vi.mock("@/components/blocks/tasks/status-dropdown-menu", () => ({
  StatusDropdownMenu: ({
    trigger,
    status,
    onStatusChange,
    isEditable = true,
  }: {
    trigger?: ReactNode;
    status: string;
    onStatusChange: (status: string) => void;
    isEditable?: boolean;
  }) => (
    <div>
      {trigger ?? <span>Status: {status}</span>}
      {isEditable ? (
        <button type="button" onClick={() => onStatusChange("Done")}>
          Select Done
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/blocks/tasks/task-table/cells/priority-cell", () => ({
  PriorityCell: ({
    trigger,
    priority,
    onPriorityChange,
    isEditable = true,
  }: {
    trigger?: ReactNode;
    priority: string;
    onPriorityChange: (priority: string) => void;
    isEditable?: boolean;
  }) => (
    <div>
      {trigger ?? <span>Priority: {priority}</span>}
      {isEditable ? (
        <button type="button" onClick={() => onPriorityChange("Critical")}>
          Select Critical
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/blocks/tasks/task-table/cells/assignee-selector", () => ({
  AssigneeSelector: ({
    trigger,
    assignee,
    onAssigneeChange,
    isEditable = true,
  }: {
    trigger?: ReactNode;
    assignee?: TaskAssigneeDetails;
    onAssigneeChange: (change: TaskAssigneeChange) => void;
    isEditable?: boolean;
  }) => {
    const displayName = assignee?.type === "user" ? assignee.name : null;
    return (
      <div>
        {trigger ?? <span>Assignee: {displayName ?? "Unassigned"}</span>}
        {displayName ? <span>{displayName.split(" ").map((part) => part[0]).join("")}</span> : null}
        {isEditable ? (
          <button
            type="button"
            onClick={() =>
              onAssigneeChange({
                assigneeId: "user-2" as Id<"users">,
                assigneeDetails: {
                  type: "user",
                  userId: "user-2" as Id<"users">,
                  name: "Grace Hopper",
                  avatarUrl: null,
                },
              })
            }
          >
            Select Assignee
          </button>
        ) : null}
      </div>
    );
  },
}));

vi.mock("@/components/lingua-time/datetime-picker", () => ({
  DateTimePicker: ({
    dateTime,
    setDateTime,
    isEditable = true,
  }: {
    dateTime?: Date;
    setDateTime: (date: Date | undefined) => void;
    isEditable?: boolean;
  }) => (
    <div>
      {dateTime ? <span>{dateTime.toLocaleString("en-US", { month: "short", day: "numeric" })}</span> : null}
      {isEditable ? (
        <button
          type="button"
          onClick={() => setDateTime(new Date("2026-02-01T12:00:00.000Z"))}
        >
          Select Date
        </button>
      ) : null}
    </div>
  ),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    _id: "task-1" as Id<"tasks">,
    clientId: "client-1",
    ...createDefaultTask({
      refNumber: 12,
      refId: "OS-12",
      name: "Build a real board card",
      description: "Render the shared task model with compact metadata.",
      status: Status.IN_PROGRESS,
      taskType: resolveTaskTypeSummary("feature"),
      priority: "High",
      assignee: {
        type: "user",
        userId: "user-1" as Id<"users">,
        name: "Sam Chen",
        avatarUrl: null,
      },
      dueDate: new Date("2026-01-25T12:00:00.000Z").getTime(),
    }),
    ...overrides,
  };
}

describe("KanbanCard", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders task metadata from the shared Task model", () => {
    render(
      <KanbanCard
        task={makeTask()}
        subtaskProgress={{ completed: 2, total: 5 }}
        showDescription
      />
    );

    expect(screen.getByText("Build a real board card")).toBeDefined();
    expect(
      screen.getByText("Render the shared task model with compact metadata.")
    ).toBeDefined();
    expect(screen.getByText("OS-12")).toBeDefined();
    expect(screen.getByText("Type: Feature")).toBeDefined();
    expect(screen.getByText("Status: In Progress")).toBeDefined();
    expect(screen.getByText("Priority: High")).toBeDefined();
    expect(screen.getByText("Assignee: Sam Chen")).toBeDefined();
    expect(screen.getByText("SC")).toBeDefined();
    expect(screen.getByText("2/5")).toBeDefined();
    expect(screen.getByText(/25 Jan|Jan 25/)).toBeDefined();
  });

  test("omits optional metadata when values are absent", () => {
    const { container } = render(
      <KanbanCard
        task={makeTask({
          priority: "None",
          assignee: null,
          dueDate: null,
        })}
        subtaskProgress={{ completed: 0, total: 0 }}
      />
    );

    expect(screen.getByText("Priority: None")).toBeDefined();
    expect(screen.getByText("Assignee: Unassigned")).toBeDefined();
    expect(container.querySelector("[data-kanban-card-due-date]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Select Date" })).toBeNull();
    expect(screen.queryByText("0/0")).toBeNull();
  });

  test("hides card metadata controlled by hidden task table columns", () => {
    const { container } = render(
      <KanbanCard
        task={makeTask()}
        hiddenTaskTableColumns={["priority", "dueDate", "assignee"]}
      />
    );

    expect(screen.queryByText("Priority: High")).toBeNull();
    expect(screen.queryByText("Assignee: Sam Chen")).toBeNull();
    expect(container.querySelector("[data-kanban-card-due-date]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Select Critical" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Select Assignee" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Select Date" })).toBeNull();
  });

  test("keeps tags visibility setting from affecting current kanban card metadata", () => {
    render(<KanbanCard task={makeTask()} hiddenTaskTableColumns={["tags"]} />);

    expect(screen.getByText("Priority: High")).toBeDefined();
    expect(screen.getByText("Assignee: Sam Chen")).toBeDefined();
    expect(screen.getByText(/25 Jan|Jan 25/)).toBeDefined();
  });

  test("renders serialized editor descriptions as plain preview text", () => {
    render(
      <KanbanCard
        task={makeTask({
          description: JSON.stringify({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Preview from rich text." }],
              },
            ],
          }),
        })}
        showDescription
      />
    );

    expect(screen.getByText("Preview from rich text.")).toBeDefined();
  });

  test("renders plain descriptions that look like non-document JSON", () => {
    render(<KanbanCard task={makeTask({ description: "[1,2,3]" })} showDescription />);

    expect(screen.getByText("[1,2,3]")).toBeDefined();
  });

  test("applies Board presentation states", () => {
    render(
      <KanbanCard
        task={makeTask({ status: Status.CANCELED })}
        presentation={{
          hideStatus: true,
          emphasizeStatus: true,
        }}
      />
    );

    expect(screen.queryByText("Status: Canceled")).toBeNull();
  });

  test.each([
    [Status.DONE, true],
    [Status.CANCELED, true],
    [Status.IN_PROGRESS, false],
  ])("strikes through %s titles: %s", (status, struck) => {
    render(<KanbanCard task={makeTask({ status })} />);

    expect(
      screen.getByText("Build a real board card").className.includes("line-through")
    ).toBe(struck);
  });

  test("keeps compact footer controls in tight flex-aligned wrappers", () => {
    const { container } = render(<KanbanCard task={makeTask()} />);

    const statusWrapper = container.querySelector("[data-kanban-card-status]");
    const dueDateWrapper = container.querySelector("[data-kanban-card-due-date]");
    const priorityWrapper = container.querySelector("[data-kanban-card-priority]");
    const assigneeWrapper = container.querySelector("[data-kanban-card-assignee]");

    expect(statusWrapper?.className).toBe("flex items-center");
    expect(dueDateWrapper?.className).toBe("flex items-center");
    expect(priorityWrapper?.className).toBe("flex items-center");
    expect(assigneeWrapper?.className).toBe("flex items-center");
  });

  test("hides the description preview unless showDescription is on", () => {
    const { rerender } = render(<KanbanCard task={makeTask()} />);

    expect(screen.queryByText("Render the shared task model with compact metadata.")).toBeNull();

    rerender(<KanbanCard task={makeTask()} showDescription />);
    expect(screen.getByText("Render the shared task model with compact metadata.")).toBeDefined();
  });

  test("shows the label chip in the footer unless the label column is hidden", () => {
    const label = { name: "Frontend", color: "#3b82f6" };
    const { rerender } = render(<KanbanCard task={makeTask()} label={label} />);

    expect(screen.getByText("Frontend").closest("[data-kanban-card-footer]")).not.toBeNull();

    rerender(<KanbanCard task={makeTask()} label={label} hiddenTaskTableColumns={["label"]} />);
    expect(screen.queryByText("Frontend")).toBeNull();
  });

  test("opens task details from one real button without nesting button roles", () => {
    const task = makeTask();
    const onClick = vi.fn();

    const { container } = render(
      <KanbanCard task={task} onClick={onClick} onTaskUpdate={vi.fn()} />
    );

    const detailTrigger = screen.getByRole("button", {
      name: "Open task details for Build a real board card",
    });
    expect(detailTrigger.tagName).toBe("BUTTON");
    expect(detailTrigger.hasAttribute("data-task-card-body")).toBe(true);
    expect(container.querySelector("[role='button']")).toBeNull();
    expect(detailTrigger.querySelector("button")).toBeNull();

    fireEvent.click(detailTrigger);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(task);
  });

  test("opens details from footer display metadata and subtask progress", () => {
    const task = makeTask({ dueDate: null });
    const onClick = vi.fn();

    const { container } = render(
      <KanbanCard
        task={task}
        subtaskProgress={{ completed: 2, total: 5 }}
        onClick={onClick}
      />
    );

    fireEvent.click(container.querySelector("[data-kanban-card-footer]")!);
    fireEvent.click(screen.getByText("2/5"));

    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onClick).toHaveBeenCalledWith(task);
  });

  test("keeps footer metadata controls from opening task details", () => {
    const task = makeTask();
    const onClick = vi.fn();
    const onTaskUpdate = vi.fn();

    render(
      <KanbanCard task={task} onClick={onClick} onTaskUpdate={onTaskUpdate} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Select Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Critical" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Assignee" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Date" }));

    expect(onClick).not.toHaveBeenCalled();
    expect(onTaskUpdate).toHaveBeenCalled();
  });

  test("uses shared controls to update editable metadata", async () => {
    const task = makeTask();
    const onTaskUpdate = vi.fn();

    render(<KanbanCard task={task} onTaskUpdate={onTaskUpdate} />);

    fireEvent.click(screen.getByRole("button", { name: "Select Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Critical" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Assignee" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Date" }));
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Change task type: Feature" })
    );
    fireEvent.click(await screen.findByText("Task"));

    expect(onTaskUpdate).toHaveBeenCalledWith(task._id, { status: "Done" });
    expect(onTaskUpdate).toHaveBeenCalledWith(task._id, {
      priority: "Critical",
    });
    expect(onTaskUpdate).toHaveBeenCalledWith(task._id, {
      assigneeId: "user-2",
      assigneeDetails: {
        type: "user",
        userId: "user-2",
        name: "Grace Hopper",
        avatarUrl: null,
      },
    });
    expect(onTaskUpdate).toHaveBeenCalledWith(task._id, {
      dueDate: new Date("2026-02-01T12:00:00.000Z").getTime(),
    });
    expect(onTaskUpdate).toHaveBeenCalledWith(
      task._id,
      expect.objectContaining({ taskTypeKey: "task" })
    );
  });
});
