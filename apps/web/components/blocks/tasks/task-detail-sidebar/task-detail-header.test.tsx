/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { Status, type Task } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { TaskDetailHeader } from "./task-detail-header";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
    title,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/blocks/project/task-lists/move-to-list-menu-content", () => ({
  MoveToListMenuContent: ({
    onMoveToList,
    selectedListRef,
  }: {
    onMoveToList: (listRef: string) => void;
    selectedListRef?: string | null;
  }) => (
    <button
      type="button"
      disabled={selectedListRef === "SPRINT-1"}
      onClick={() => onMoveToList("SPRINT-1")}
    >
      Sprint 1
    </button>
  ),
}));

const task: Task = {
  delegatedToAgent: null,
  _id: "task_1" as Id<"tasks">,
  clientId: "task_1",
  refNumber: 1,
  refId: "OS-1",
  name: "Task",
  description: null,
  taskType: getDefaultTaskTypeSummary(),
  priority: "None",
  dueDate: null,
  status: Status.TODO,
  assignee: null,
  tags: [],
  rank: "0|hzzzzz:",
  parentId: null,
  createdAt: Date.now(),
  isArchived: false,
};

describe("TaskDetailHeader", () => {
  afterEach(() => {
    cleanup();
  });

  test("shows Move to submenu and moves the task to a selected List", () => {
    const onMoveToList = vi.fn();

    render(
      <TaskDetailHeader
        task={task}
        onClose={vi.fn()}
        onToggleComplete={vi.fn()}
        projectId={"project_1" as Id<"projects">}
        selectedListRef={null}
        onMoveToList={onMoveToList}
      />
    );

    expect(screen.getByRole("button", { name: /^move to$/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^sprint 1$/i }));

    expect(onMoveToList).toHaveBeenCalledWith("SPRINT-1");
  });

  test("names the go-to-parent button after the parent task", () => {
    const onNavigateToParent = vi.fn();
    render(
      <TaskDetailHeader
        task={task}
        parentTask={{ ...task, _id: "task_0" as Id<"tasks">, refId: "OS-0", name: "Parent" }}
        onNavigateToParent={onNavigateToParent}
        onClose={vi.fn()}
        onToggleComplete={vi.fn()}
        projectId={"project_1" as Id<"projects">}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Go to parent task OS-0" }));

    expect(onNavigateToParent).toHaveBeenCalledTimes(1);
  });

  test("hides Move to submenu for archived tasks", () => {
    render(
      <TaskDetailHeader
        task={{ ...task, isArchived: true }}
        onClose={vi.fn()}
        onToggleComplete={vi.fn()}
        projectId={"project_1" as Id<"projects">}
        selectedListRef={null}
        onMoveToList={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /^move to$/i })).toBeNull();
  });

  describe("read-only viewer (docs/specs/read-only-viewer-ux.md)", () => {
    const reason = "You have view-only access to this project";
    const callbacks = () => ({
      onToggleComplete: vi.fn(),
      onUnarchive: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
      onArchive: vi.fn(),
      onMoveToList: vi.fn(),
    });

    test("disables field-like actions with the shared reason and hides delete", () => {
      const handlers = callbacks();
      render(
        <TaskDetailHeader
          task={task}
          onClose={vi.fn()}
          {...handlers}
          projectId={"project_1" as Id<"projects">}
          organizationSlug="contoso"
          projectAlias="OS"
          readOnlyReason={reason}
          canUseThreads={false}
        />
      );

      const [headerToggle, menuToggle] = screen.getAllByRole("button", { name: /mark complete/i });
      expect((headerToggle as HTMLButtonElement).disabled).toBe(true);
      expect(headerToggle.closest(`[title="${reason}"]`)).toBeTruthy();
      expect((menuToggle as HTMLButtonElement).disabled).toBe(true);

      for (const name of [/duplicate task/i, /^archive$/i, /^move to$/i]) {
        const item = screen.getByRole("button", { name }) as HTMLButtonElement;
        expect(item.disabled).toBe(true);
        expect(item.title).toBe(reason);
      }
      // The Move to submenu's List picker is not mounted at all.
      expect(screen.queryByRole("button", { name: /^sprint 1$/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /delete task/i })).toBeNull();
      // Non-mutating actions stay available.
      expect((screen.getByRole("button", { name: /copy task link/i }) as HTMLButtonElement).disabled).toBe(false);
      // Threads are not available to a viewer.
      expect(screen.queryByRole("link", { name: /open threads page/i })).toBeNull();

      fireEvent.click(headerToggle);
      fireEvent.click(menuToggle);
      expect(handlers.onToggleComplete).not.toHaveBeenCalled();
    });

    test("an archived task offers a disabled Unarchive and no delete", () => {
      render(
        <TaskDetailHeader
          task={{ ...task, isArchived: true }}
          onClose={vi.fn()}
          {...callbacks()}
          readOnlyReason={reason}
        />
      );

      const unarchive = screen.getAllByRole("button", { name: /unarchive/i });
      expect(unarchive.length).toBeGreaterThan(0);
      for (const button of unarchive) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
      }
      expect(screen.queryAllByRole("button", { name: /delete task/i })).toHaveLength(0);
    });
  });
});
