/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { DATE_FORMAT } from "@/lib/tasks/constants";
import { MultiSelectToolbar } from "./multi-select-toolbar";
import { TaskListMoveProvider } from "./task-table/task-list-move-context";

if (!globalThis.ResizeObserver) {
  const ResizeObserverMock = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
  };

  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => { };
}

vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./task-table/cells/priority-cell", () => ({
  PriorityCell: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

vi.mock("./task-table/cells/assignee-selector", () => ({
  AssigneeSelector: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

vi.mock("@/components/lingua-time/datetime-picker", () => ({
  DateTimePicker: ({ className, dateFormat }: { className?: string; dateFormat?: string }) => (
    <button type="button" className={className} data-date-format={dateFormat}>
      Due date
    </button>
  ),
}));

vi.mock("@/lib/tasks/hooks/use-project-labels", () => ({
  useProjectLabels: () => ({
    labels: [{ _id: "label_1", name: "Q1", color: "#ef4444", rank: "0|a" }],
    labelsById: new Map(),
    isLoading: false,
  }),
}));

vi.mock("./task-label-picker", () => ({
  TaskLabelPicker: ({
    trigger,
    onChange,
  }: {
    trigger: ReactNode;
    onChange: (labelId: string | null) => void;
  }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange("label_1")}>
        Q1
      </button>
    </div>
  ),
}));

vi.mock("@/components/blocks/project/task-lists/move-to-list-dropdown", () => ({
  MoveToListDropdown: ({
    trigger,
    onMoveToList,
  }: {
    trigger: ReactNode;
    onMoveToList: (listRef: string) => void;
  }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onMoveToList("SPRINT")}>
        Sprint
      </button>
    </div>
  ),
}));

vi.mock("@/components/blocks/project/task-lists/use-task-list-results", () => ({
  useResolvedTaskListResultsController: () => ({
    query: "",
    setQuery: () => {},
    resetQuery: () => {},
    results: [],
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    loadMore: () => {},
  }),
}));

function renderWithTaskListMove(
  ui: ReactNode,
  {
    enabled = true,
    selectedListRef = null,
    moveSelectionToList,
  }: {
    enabled?: boolean;
    selectedListRef?: string | null;
    moveSelectionToList?: (listRef: string) => void;
  } = {}
) {
  return render(
    <TaskListMoveProvider
      projectId={"project_1" as Id<"projects">}
      enabled={enabled}
      selectedListRef={selectedListRef}
      moveSelectionToList={moveSelectionToList}
    >
      {ui}
    </TaskListMoveProvider>
  );
}

describe("MultiSelectToolbar", () => {
  afterEach(() => {
    cleanup();
  });

  test("read-only callers get the count and clear selection, no actions", () => {
    const onClearSelection = vi.fn();

    renderWithTaskListMove(
      <MultiSelectToolbar
        readOnly
        selectedCount={3}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onClearSelection={onClearSelection}
      />,
      { moveSelectionToList: vi.fn() }
    );

    expect(screen.getByText("3 tasks selected")).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  test("icon-only actions have accessible names", () => {
    renderWithTaskListMove(
      <MultiSelectToolbar
        selectedCount={2}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    for (const name of ["Mark as complete", "Set priority", "Assign to", "Delete selected tasks", "Clear selection"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  test("counts a single selected task in the singular", () => {
    render(
      <MultiSelectToolbar
        selectedCount={1}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    expect(screen.getByText("1 task selected")).toBeTruthy();
  });

  test("formats the bulk due date like every other due date picker", () => {
    render(
      <MultiSelectToolbar
        selectedCount={2}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Due date" }).getAttribute("data-date-format")).toBe(DATE_FORMAT);
  });

  test("sets a label on the selected tasks", () => {
    const onLabelChange = vi.fn();
    render(
      <MultiSelectToolbar
        selectedCount={2}
        projectId={"project_1" as Id<"projects">}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onLabelChange={onLabelChange}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Set label" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Q1" }));
    expect(onLabelChange).toHaveBeenCalledWith("label_1");
  });

  test("shows archive action and triggers callback", () => {
    const onArchive = vi.fn();

    render(
      <MultiSelectToolbar
        selectedCount={2}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onArchive={onArchive}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^archive selected tasks$/i }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  test("shows unarchive action and triggers callback", () => {
    const onUnarchive = vi.fn();

    render(
      <MultiSelectToolbar
        selectedCount={2}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onUnarchive={onUnarchive}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^unarchive selected tasks$/i }));
    expect(onUnarchive).toHaveBeenCalledTimes(1);
  });

  test("omits legacy backlog boundary actions", () => {
    render(
      <MultiSelectToolbar
        selectedCount={2}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /^move to backlog$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^move to inbox$/i })).toBeNull();
  });

  test("opens Move selected to dropdown and calls callback with selected List", () => {
    const moveSelectionToList = vi.fn();

    renderWithTaskListMove(
      <MultiSelectToolbar
        selectedCount={2}
        projectId={"project_1" as Id<"projects">}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />,
      { moveSelectionToList }
    );

    fireEvent.click(screen.getByRole("button", { name: /^sprint$/i }));

    expect(moveSelectionToList).toHaveBeenCalledWith("SPRINT");
  });

  test("hides Move selected to dropdown when List moves are disabled", () => {
    renderWithTaskListMove(
      <MultiSelectToolbar
        selectedCount={2}
        projectId={"project_1" as Id<"projects">}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />,
      { enabled: false, moveSelectionToList: vi.fn() }
    );

    expect(
      screen.queryByRole("button", { name: /^move selected to$/i })
    ).toBeNull();
  });

  test("shows only unarchive action when both archive and unarchive callbacks are provided", () => {
    render(
      <MultiSelectToolbar
        selectedCount={2}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /^unarchive selected tasks$/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^archive selected tasks$/i })).toBeNull();
  });

  test("opens the bulk status dropdown when clicking the status trigger", async () => {
    render(
      <MultiSelectToolbar
        selectedCount={2}
        onMarkComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onPriorityChange={vi.fn()}
        onAssigneeChange={vi.fn()}
        onDueDateChange={vi.fn()}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /status/i }), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByPlaceholderText("Search statuses...")).toBeDefined();
  });
});
