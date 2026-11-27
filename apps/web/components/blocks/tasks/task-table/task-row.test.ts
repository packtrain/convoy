import { describe, expect, test, vi } from "vitest";
import type { Row } from "@tanstack/react-table";
import { Priority, Status, type Task, type TaskTreeNode } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import {
  shouldReuseRowContent,
  type RowContentProps,
} from "./task-row";

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

// Shared across createProps calls: in the app columnStyles is memoized and
// stable within a name-column sizing mode, so equal-mode props share the ref.
const SHARED_COLUMN_STYLES: RowContentProps["columnStyles"] = {};

function createProps(
  statusOptionsVersion: string,
  columnStyles: RowContentProps["columnStyles"] = SHARED_COLUMN_STYLES
): RowContentProps {
  const task = createTask();

  return {
    row: {
      original: task,
    } as Row<Task>,
    task,
    clientId: "client-1",
    statusOptionsVersion,
    visibleColumnsVersion: "all",
    isDragging: false,
    dropIndicator: null,
    isSelected: false,
    isDndEnabled: true,
    columnStyles,
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDragEnd: vi.fn(),
    onDrop: vi.fn(),
    onMobileDragPointerDown: vi.fn(),
    onMobileContextMenu: vi.fn(),
    shouldSuppressNextClick: vi.fn(() => false),
    onRowClick: vi.fn(),
    onSelectRow: vi.fn(),
    onContextMenuSelectRow: vi.fn(),
    onDelete: vi.fn(),
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    onDuplicate: vi.fn(),
    onUpdateStatus: vi.fn(),
    onOpenDetails: vi.fn(),
    registerRow: vi.fn(),
    readOnly: false,
  };
}

function withTask(props: RowContentProps, task: Task): RowContentProps {
  return {
    ...props,
    row: { original: task } as Row<Task>,
    task,
  };
}

describe("shouldReuseRowContent", () => {
  test("reuses the memoized row when only non-row callback identities change", () => {
    const prevProps = createProps("To Do|Done");
    const nextProps = createProps("To Do|Done");

    expect(shouldReuseRowContent(prevProps, nextProps)).toBe(true);
  });

  test("does not reuse the memoized row when the name column sizing mode flips", () => {
    const prevProps = createProps("To Do|Done", { name: { header: "auto", cell: "auto" } });
    const nextProps = createProps("To Do|Done", { name: { header: "fixed", cell: "fixed" } });

    expect(shouldReuseRowContent(prevProps, nextProps)).toBe(false);
  });

  test("does not reuse the memoized row when read-only flips", () => {
    const prevProps = createProps("To Do|Done");
    expect(shouldReuseRowContent(prevProps, { ...prevProps, readOnly: true })).toBe(false);
  });

  test("does not reuse the memoized row when the allowed status list changes", () => {
    const prevProps = createProps("To Do|Done");
    const nextProps = createProps("To Do|In Progress|Done");

    expect(shouldReuseRowContent(prevProps, nextProps)).toBe(false);
  });

  test("does not reuse the memoized row when visible columns change", () => {
    const prevProps = createProps("To Do|Done");
    const nextProps = {
      ...createProps("To Do|Done"),
      visibleColumnsVersion: "priority",
    };

    expect(shouldReuseRowContent(prevProps, nextProps)).toBe(false);
  });

  test("does not reuse the memoized row when the task type changes", () => {
    const prevProps = createProps("To Do|Done");
    const nextProps = withTask(
      createProps("To Do|Done"),
      createTask({
        taskType: {
          key: "feature",
          name: "Feature",
          icon: "Sparkles",
          color: "#22c55e",
          isSystem: true,
        },
      })
    );

    expect(shouldReuseRowContent(prevProps, nextProps)).toBe(false);
  });

  test("does not reuse the memoized row when the delegated Project agent changes", () => {
    const prevProps = withTask(
      createProps("To Do|Done"),
      createTask({
        delegatedToAgent: {
          type: "projectAgent",
          projectAgentId: "agent-1" as never,
          name: "Code Review",
          appearance: { color: "#3b82f6" },
          isDeleted: false,
        },
      })
    );
    const nextProps = withTask(
      createProps("To Do|Done"),
      createTask({
        delegatedToAgent: {
          type: "projectAgent",
          projectAgentId: "agent-2" as never,
          name: "QA Agent",
          appearance: { color: "#f97316" },
          isDeleted: false,
        },
      })
    );

    expect(shouldReuseRowContent(prevProps, nextProps)).toBe(false);
  });

  test("does not reuse the memoized row when completedChildCount changes (OS-868)", () => {
    const baseTreeFields: Pick<
      TaskTreeNode,
      "depth" | "childCount" | "completedChildCount" | "hasChildren" | "isExpanded"
    > = {
      depth: 0,
      childCount: 2,
      completedChildCount: 0,
      hasChildren: true,
      isExpanded: false,
    };

    const prevProps = withTask(
      createProps("To Do|Done"),
      { ...createTask(), ...baseTreeFields } as Task
    );
    const nextProps = withTask(
      createProps("To Do|Done"),
      {
        ...createTask(),
        ...baseTreeFields,
        completedChildCount: 1,
      } as Task
    );

    expect(shouldReuseRowContent(prevProps, nextProps)).toBe(false);
  });

  test("does not reuse the memoized row when agent thread work changes (OS-1094)", () => {
    const workEntry = {
      threadId: "thread-1" as never,
      threadTitle: "Fix login crash",
      userId: "user-1" as never,
      userName: "Robin",
      cliType: "claude-code",
      status: "pending" as const,
      source: "manual_attachment" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const prevProps = withTask(createProps("To Do|Done"), createTask());
    const nextProps = withTask(
      createProps("To Do|Done"),
      createTask({ agentThreadWork: [workEntry] })
    );
    expect(shouldReuseRowContent(prevProps, nextProps)).toBe(false);

    const statusChanged = withTask(
      createProps("To Do|Done"),
      createTask({
        agentThreadWork: [{ ...workEntry, status: "streaming" as const, updatedAt: 2 }],
      })
    );
    expect(shouldReuseRowContent(nextProps, statusChanged)).toBe(false);
    expect(
      shouldReuseRowContent(
        nextProps,
        withTask(
          createProps("To Do|Done"),
          createTask({ agentThreadWork: [{ ...workEntry }] })
        )
      )
    ).toBe(true);
  });

  test("does not reuse the memoized row when task PR links change", () => {
    const pullRequest = {
      kind: "pull_request" as const,
      id: "pr-1",
      url: "https://github.com/contoso/contoso/pull/1",
      title: "Add task PR icon",
      createdAt: 1,
      updatedAt: 1,
    };
    const withoutPullRequest = createProps("To Do|Done");
    const withPullRequest = withTask(
      createProps("To Do|Done"),
      createTask({ externalLinks: [pullRequest] })
    );
    const withChangedUrl = withTask(
      createProps("To Do|Done"),
      createTask({
        externalLinks: [
          {
            ...pullRequest,
            url: "https://github.com/contoso/contoso/pull/2",
          },
        ],
      })
    );

    expect(
      shouldReuseRowContent(withoutPullRequest, withPullRequest)
    ).toBe(false);
    expect(shouldReuseRowContent(withPullRequest, withChangedUrl)).toBe(false);
    expect(
      shouldReuseRowContent(
        withPullRequest,
        withTask(
          createProps("To Do|Done"),
          createTask({
            externalLinks: [{ ...pullRequest }],
          })
        )
      )
    ).toBe(true);
  });

  test("does not reuse content when TanStack reuses a row object and replaces its task", () => {
    const row = {
      original: createTask(),
    } as Row<Task>;
    const previousTask = row.original;
    const prevProps: RowContentProps = {
      ...createProps("To Do|Done"),
      row,
      task: previousTask,
    };

    row.original = createTask({
      externalLinks: [
        {
          kind: "pull_request",
          id: "pr-1",
          url: "https://github.com/contoso/contoso/pull/1",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const nextProps: RowContentProps = {
      ...createProps("To Do|Done"),
      row,
      task: row.original,
    };

    expect(shouldReuseRowContent(prevProps, nextProps)).toBe(false);
  });

  test("reuses the memoized row when only non-PR external links change", () => {
    const prevProps = withTask(
      createProps("To Do|Done"),
      createTask({
        externalLinks: [
          {
            kind: "url",
            id: "docs",
            url: "https://example.com/old",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })
    );
    const nextProps = withTask(
      createProps("To Do|Done"),
      createTask({
        externalLinks: [
          {
            kind: "url",
            id: "docs",
            url: "https://example.com/new",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      })
    );

    expect(shouldReuseRowContent(prevProps, nextProps)).toBe(true);
  });

  test("does not reuse the memoized row when the task type key changes", () => {
    const prevProps = createProps("To Do|Done");
    const nextProps = withTask(
      createProps("To Do|Done"),
      createTask({
        taskType: {
          key: "bug",
          name: "Bug",
          icon: "Bug",
          color: "#ef4444",
          isSystem: true,
        },
      })
    );

    expect(shouldReuseRowContent(prevProps, nextProps)).toBe(false);
  });
});
