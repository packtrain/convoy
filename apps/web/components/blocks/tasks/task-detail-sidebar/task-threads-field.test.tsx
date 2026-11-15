/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { TaskThreadsField } from "./task-threads-field";

const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/blocks/thread/thread-list-item", () => ({
  ThreadListItem: ({
    chat,
    compactLayout,
    showAssociatedTask,
    showActions,
    rowClassName,
    linkTarget,
    linkRel,
  }: {
    chat: { title: string };
    compactLayout: boolean;
    showAssociatedTask?: boolean;
    showActions?: boolean;
    rowClassName?: string;
    linkTarget?: string;
    linkRel?: string;
  }) => (
    <a
      href={`/o/contoso/OS/threads/${chat.title}`}
      target={linkTarget}
      rel={linkRel}
      data-testid={`thread-row-${chat.title}`}
    >
      <span>{chat.title}</span>
      <span data-testid={`thread-row-compact-${chat.title}`}>
        {String(compactLayout)}
      </span>
      <span data-testid={`thread-row-associated-task-${chat.title}`}>
        {String(showAssociatedTask !== false)}
      </span>
      <span data-testid={`thread-row-actions-${chat.title}`}>
        {String(Boolean(showActions))}
      </span>
      <span data-testid={`thread-row-class-${chat.title}`}>
        {rowClassName ?? ""}
      </span>
    </a>
  ),
}));

const projectId = "project_1" as Id<"projects">;
const taskId = "task_1" as Id<"tasks">;

function buildThreads(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    _id: `thread_${index + 1}`,
    title: `Thread ${index + 1}`,
    status: "completed",
    cliType: "codex",
    hasUnread: false,
    lastActivityAt: Date.now() - index * 1000,
  }));
}

function renderField() {
  return render(
    <TaskThreadsField
      projectId={projectId}
      organizationSlug="contoso"
      projectAlias="OS"
      taskId={taskId}
      onOpenThreadsComposer={vi.fn()}
    />
  );
}

/** Rendered thread titles in DOM order, via the row mock's testid. */
function renderedTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('a[data-testid^="thread-row-"]')).map(
    (row) => row.getAttribute("data-testid")!.replace("thread-row-", "")
  );
}

describe("TaskThreadsField", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("renders plain empty text and threads composer action when no threads exist", () => {
    useQueryMock.mockReturnValue([]);

    renderField();

    expect(screen.getByText("No threads")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "No threads" })).toBeNull();
    expect(screen.queryByText("No associated threads yet.")).toBeNull();
    expect(screen.getByRole("button", { name: "Open threads composer" })).toBeTruthy();
  });

  test("does not flash an empty state while associated threads are still loading", () => {
    useQueryMock.mockReturnValue(undefined);

    renderField();

    expect(screen.queryByText("No threads")).toBeNull();
    expect(screen.queryByTestId("thread-row-Fix flaky thread")).toBeNull();
  });

  test("renders a single associated thread using the compact thread row style", () => {
    useQueryMock.mockReturnValue([
      {
        _id: "thread_1",
        title: "Fix flaky thread",
        status: "completed",
        cliType: "codex",
        hasUnread: false,
        lastActivityAt: Date.now(),
      },
    ]);

    renderField();

    const threadLink = screen.getByTestId("thread-row-Fix flaky thread");
    expect(threadLink.getAttribute("target")).toBe("_blank");
    expect(threadLink.getAttribute("rel")).toBe("noreferrer");
    expect(screen.getByTestId("thread-row-compact-Fix flaky thread").textContent).toBe(
      "true"
    );
    expect(
      screen.getByTestId("thread-row-associated-task-Fix flaky thread").textContent
    ).toBe("false");
    expect(screen.queryByRole("button", { name: "1 thread" })).toBeNull();
  });

  test("renders every associated thread as a compact row without a count trigger", () => {
    useQueryMock.mockReturnValue([
      {
        _id: "thread_1",
        title: "First thread",
        associatedTask: { refId: "OS-1", name: "Current task" },
        status: "completed",
        cliType: "codex",
        hasUnread: false,
        lastActivityAt: Date.now(),
      },
      {
        _id: "thread_2",
        title: "Second thread",
        associatedTask: { refId: "OS-1", name: "Current task" },
        status: "pending",
        cliType: "claude-code",
        hasUnread: true,
        lastActivityAt: Date.now() - 1000,
      },
      {
        _id: "thread_3",
        title: "Third thread",
        status: "pending",
        cliType: "claude-code",
        hasUnread: false,
        lastActivityAt: Date.now() - 2000,
      },
    ]);

    renderField();

    expect(screen.queryByRole("button", { name: "3 threads" })).toBeNull();
    expect(screen.getByTestId("thread-row-First thread")).toBeTruthy();
    expect(screen.getByTestId("thread-row-Second thread")).toBeTruthy();
    expect(screen.getByTestId("thread-row-Third thread")).toBeTruthy();
    expect(screen.getByTestId("thread-row-compact-First thread").textContent).toBe("true");
    expect(screen.getByTestId("thread-row-associated-task-First thread").textContent).toBe(
      "false"
    );
    expect(screen.getByTestId("thread-row-actions-First thread").textContent).toBe("false");
  });

  test("renders the composer action inside the first thread's row only", () => {
    useQueryMock.mockReturnValue([
      {
        _id: "thread_1",
        title: "First thread",
        status: "completed",
        cliType: "codex",
        hasUnread: false,
        lastActivityAt: Date.now(),
      },
      {
        _id: "thread_2",
        title: "Last thread",
        status: "pending",
        cliType: "claude-code",
        hasUnread: false,
        lastActivityAt: Date.now() - 1000,
      },
    ]);

    renderField();

    const composerAction = screen.getByRole("button", {
      name: "Open threads composer",
    });
    // The row is the wrapper's parent: row > width wrapper > thread link.
    const firstRow =
      screen.getByTestId("thread-row-First thread").closest("div")?.parentElement;
    const lastRow =
      screen.getByTestId("thread-row-Last thread").closest("div")?.parentElement;

    expect(firstRow?.contains(composerAction)).toBe(true);
    expect(lastRow?.contains(composerAction)).toBe(false);
  });

  test("renders every thread when collapsing would hide only one", () => {
    useQueryMock.mockReturnValue(buildThreads(5));

    renderField();

    expect(screen.getByTestId("thread-row-Thread 5")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /more thread/ })).toBeNull();
  });

  test("collapses to four rows plus a show-more row and expands in place", () => {
    useQueryMock.mockReturnValue(buildThreads(6));

    renderField();

    expect(screen.getByTestId("thread-row-Thread 4")).toBeTruthy();
    expect(screen.queryByTestId("thread-row-Thread 5")).toBeNull();
    expect(screen.queryByTestId("thread-row-Thread 6")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show 2 more threads" }));

    expect(screen.getByTestId("thread-row-Thread 5")).toBeTruthy();
    expect(screen.getByTestId("thread-row-Thread 6")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /more thread/ })).toBeNull();
  });

  test("invokes the sidebar threads-composer action in every thread-count state", () => {
    const onOpenThreadsComposer = vi.fn();

    useQueryMock.mockReturnValue([]);
    const { rerender } = render(
      <TaskThreadsField
        projectId={projectId}
        organizationSlug="contoso"
        projectAlias="OS"
        taskId={taskId}
        onOpenThreadsComposer={onOpenThreadsComposer}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open threads composer" }));

    useQueryMock.mockReturnValue([
      {
        _id: "thread_1",
        title: "Only thread",
        status: "completed",
        cliType: "codex",
        hasUnread: false,
        lastActivityAt: Date.now(),
      },
    ]);
    rerender(
      <TaskThreadsField
        projectId={projectId}
        organizationSlug="contoso"
        projectAlias="OS"
        taskId={taskId}
        onOpenThreadsComposer={onOpenThreadsComposer}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Open threads composer" }));

    useQueryMock.mockReturnValue([
      {
        _id: "thread_1",
        title: "First thread",
        status: "completed",
        cliType: "codex",
        hasUnread: false,
        lastActivityAt: Date.now(),
      },
      {
        _id: "thread_2",
        title: "Second thread",
        status: "pending",
        cliType: "claude-code",
        hasUnread: true,
        lastActivityAt: Date.now() - 1000,
      },
    ]);
    rerender(
      <TaskThreadsField
        projectId={projectId}
        organizationSlug="contoso"
        projectAlias="OS"
        taskId={taskId}
        onOpenThreadsComposer={onOpenThreadsComposer}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Open threads composer" }));

    expect(onOpenThreadsComposer).toHaveBeenCalledTimes(3);
  });

  test("lane threads nest under their run container, marked as children", () => {
    useQueryMock.mockReturnValue([
      {
        _id: "thread_manual",
        title: "Manual thread",
        status: "completed",
        cliType: "codex",
        hasUnread: false,
        lastActivityAt: Date.now(),
      },
      {
        _id: "thread_lane",
        title: "Simple — Lane 1",
        workflowRunId: "run_1",
        status: "pending",
        cliType: "claude-code",
        hasUnread: false,
        lastActivityAt: Date.now() - 1000,
      },
      {
        _id: "thread_container",
        title: "Simple",
        kind: "group",
        workflowRunId: "run_1",
        status: "pending",
        cliType: "claude-code",
        hasUnread: false,
        lastActivityAt: Date.now() - 2000,
      },
    ]);

    const { container } = renderField();

    expect(renderedTitles(container)).toEqual(["Manual thread", "Simple", "Simple — Lane 1"]);
    expect(screen.getAllByTestId("workflow-child-glyph")).toHaveLength(1);

    // The glyph shifts a child row right, so its cap shrinks by the same
    // 1.375rem (glyph 0.875 + gap 0.5) to keep right edges aligned.
    expect(screen.getByTestId("thread-row-Simple").closest("div")?.className).toContain("max-w-88");
    expect(screen.getByTestId("thread-row-Simple — Lane 1").closest("div")?.className).toContain(
      "max-w-[20.625rem]"
    );
  });

  test("a lane thread without its container present renders as a plain row", () => {
    useQueryMock.mockReturnValue([
      {
        _id: "thread_lane",
        title: "Orphan lane",
        workflowRunId: "run_1",
        status: "pending",
        cliType: "claude-code",
        hasUnread: false,
        lastActivityAt: Date.now(),
      },
    ]);

    renderField();

    expect(screen.getByTestId("thread-row-Orphan lane")).toBeTruthy();
    expect(screen.queryByTestId("workflow-child-glyph")).toBeNull();
  });

  test("a plain group container gets no children and no corner glyph", () => {
    useQueryMock.mockReturnValue([
      {
        _id: "thread_group",
        title: "Plain group",
        kind: "group",
        status: "pending",
        cliType: "claude-code",
        hasUnread: false,
        lastActivityAt: Date.now(),
      },
      {
        _id: "thread_manual",
        title: "Manual thread",
        status: "completed",
        cliType: "codex",
        hasUnread: false,
        lastActivityAt: Date.now() - 1000,
      },
    ]);

    const { container } = renderField();

    expect(renderedTitles(container)).toEqual(["Plain group", "Manual thread"]);
    expect(screen.queryByTestId("workflow-child-glyph")).toBeNull();
  });
});
