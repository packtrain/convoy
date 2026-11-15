/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { Status, type Task } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { TaskTimelineComposer } from "./task-timeline-composer";

vi.mock("@/components/blocks/tasks/comments", () => ({
  CommentComposer: ({ disabled }: { disabled?: boolean }) => (
    <textarea aria-label="Comment composer" disabled={disabled} />
  ),
}));

vi.mock("@/components/blocks/tasks/task-thread-composer", () => ({
  TaskThreadComposer: ({ focusRequestKey }: { focusRequestKey?: number }) => (
    <div>
      <textarea aria-label="Thread composer" />
      <span data-testid="thread-focus-key">{String(focusRequestKey ?? 0)}</span>
    </div>
  ),
}));

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    delegatedToAgent: null,
    _id: "task_1" as Task["_id"],
    clientId: "task_1",
    refNumber: 1,
    refId: "ABC-1",
    name: "Task name",
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
    ...overrides,
  };
}

const THREAD_CONTEXT = {
  projectId: "project_1" as Id<"projects">,
  organizationSlug: "contoso",
  projectAlias: "OS",
};

function renderComposer(
  overrides: Partial<Parameters<typeof TaskTimelineComposer>[0]> = {}
) {
  const onModeChange = vi.fn();
  const result = render(
    <TaskTimelineComposer
      task={buildTask()}
      threadContext={THREAD_CONTEXT}
      mode="thread"
      onModeChange={onModeChange}
      threadFocusRequestKey={0}
      sortDirection="asc"
      {...overrides}
    />
  );
  return { ...result, onModeChange };
}

/**
 * True when the collapsed trigger row precedes the composers in document order.
 * Both composers are always mounted, so this compares against the thread one
 * rather than "whichever is visible".
 */
function triggerPrecedesComposers(): boolean {
  const trigger = screen.getByRole("button", { name: /\.\.\.$/ });
  const composer = screen.getByLabelText("Thread composer");
  return Boolean(
    trigger.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING
  );
}

describe("TaskTimelineComposer", () => {
  afterEach(() => {
    cleanup();
  });

  test("opens the thread side by default, with the comment side collapsed", () => {
    renderComposer();

    expect(screen.getByRole("button", { name: "Add comment..." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start a thread..." })).toBeNull();
  });

  test("the trigger row requests the other mode rather than swapping locally", () => {
    // Mode is owned by the sidebar so the metadata row's "+" can drive it too.
    const { onModeChange } = renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Add comment..." }));

    expect(onModeChange).toHaveBeenCalledWith("comment");
  });

  test("comment mode collapses the thread side to its own trigger", () => {
    renderComposer({ mode: "comment" });

    expect(screen.getByRole("button", { name: "Start a thread..." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add comment..." })).toBeNull();
  });

  test("keeps the collapsed composer mounted so its pending state survives", () => {
    // Unmounting would drop in-flight comment attachment uploads and tear down
    // the thread composer's draft provider mid-edit.
    renderComposer({ mode: "comment" });

    expect(screen.getByLabelText("Comment composer")).toBeTruthy();
    expect(screen.getByLabelText("Thread composer")).toBeTruthy();
  });

  test("without project context there is no thread side and no trigger rows", () => {
    renderComposer({
      threadContext: undefined,
      // Even asked for `thread`, there is nothing to show.
      mode: "thread",
    });

    expect(screen.getByLabelText("Comment composer")).toBeTruthy();
    expect(screen.queryByLabelText("Thread composer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add comment..." })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start a thread..." })).toBeNull();
  });

  test("forwards the focus request key to the thread composer", () => {
    renderComposer({ threadFocusRequestKey: 3 });

    expect(screen.getByTestId("thread-focus-key").textContent).toBe("3");
  });

  test("an archived task disables the comment composer", () => {
    renderComposer({ task: buildTask({ isArchived: true }), mode: "comment" });

    expect(screen.getByLabelText("Comment composer")).toHaveProperty("disabled", true);
  });
});

describe("TaskTimelineComposer order", () => {
  afterEach(cleanup);

  // The trigger faces the stream in both directions: the stream is above the
  // composer reading oldest-first, below it reading newest-first.
  test("puts the trigger above the composer reading oldest-first", () => {
    renderComposer({ sortDirection: "asc" });

    expect(triggerPrecedesComposers()).toBe(true);
  });

  test("puts the trigger below the composer reading newest-first", () => {
    renderComposer({ sortDirection: "desc" });

    expect(triggerPrecedesComposers()).toBe(false);
  });

  test("flips the comment-mode trigger too, not just the thread one", () => {
    renderComposer({ sortDirection: "desc", mode: "comment" });

    expect(screen.getByRole("button", { name: "Start a thread..." })).toBeTruthy();
    expect(triggerPrecedesComposers()).toBe(false);
  });

  test("pads the bottom edge only when it closes the panel", () => {
    const { container, unmount } = renderComposer({ sortDirection: "asc" });
    expect(container.firstElementChild?.className).toContain("pb-4");

    unmount();

    // Newest-first it sits under the header, which already spaces it off.
    const flipped = renderComposer({ sortDirection: "desc" });
    expect(flipped.container.firstElementChild?.className).not.toContain("pt-4");
  });

  // A reorder must move the mounted instances, not remount them: a remount
  // drops in-flight attachment uploads and tears down the draft provider.
  test("keeps the composers mounted across a direction flip", () => {
    const { rerender } = render(
      <TaskTimelineComposer
        task={buildTask()}
        threadContext={THREAD_CONTEXT}
        mode="thread"
        onModeChange={vi.fn()}
        threadFocusRequestKey={0}
        sortDirection="asc"
      />
    );

    const before = screen.getByLabelText("Thread composer");

    rerender(
      <TaskTimelineComposer
        task={buildTask()}
        threadContext={THREAD_CONTEXT}
        mode="thread"
        onModeChange={vi.fn()}
        threadFocusRequestKey={0}
        sortDirection="desc"
      />
    );

    // The same DOM node, moved — a remount would produce a different one.
    expect(screen.getByLabelText("Thread composer")).toBe(before);
    expect(triggerPrecedesComposers()).toBe(false);
  });

  test("without a thread side there is no trigger to place", () => {
    renderComposer({ threadContext: undefined, sortDirection: "desc" });

    expect(screen.getByLabelText("Comment composer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /\.\.\.$/ })).toBeNull();
  });

  describe("without comment access (docs/specs/read-only-viewer-ux.md)", () => {
    test("a viewer sees a one-line note instead of a dead composer", () => {
      renderComposer({ canComment: false, threadContext: undefined });

      expect(screen.getByText("You have view-only access to this project")).toBeTruthy();
      expect(screen.queryByLabelText("Comment composer")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });

    test("keeps the thread side alone, with no trigger to swap to comments", () => {
      renderComposer({ canComment: false, mode: "comment" });

      expect(screen.queryByLabelText("Comment composer")).toBeNull();
      expect(screen.getByLabelText("Thread composer")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /add comment/i })).toBeNull();
    });
  });
});
