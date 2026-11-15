/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { Status, type Task } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { TaskTimeline } from "./task-timeline";

const useTaskTimelineMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const loadMoreMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tasks/hooks/detail/use-task-timeline", () => ({
  useTaskTimeline: (...args: unknown[]) => useTaskTimelineMock(...args),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/lib/tasks/hooks/comments/use-task-comments", () => ({
  useTaskComments: () => ({ updateComment: vi.fn(), deleteComment: vi.fn() }),
}));

vi.mock("./task-timeline-composer", () => ({
  TaskTimelineComposer: ({ sortDirection }: { sortDirection: string }) => (
    <div data-testid="composer">Composer:{sortDirection}</div>
  ),
}));

vi.mock("./timeline-block", () => ({
  TimelineBlockRow: ({ block }: { block: { kind: string; key: string } }) => (
    <div data-testid={`block-${block.kind}`}>{block.key}</div>
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

function activityItem(id: string, at: number) {
  return {
    kind: "activity" as const,
    at,
    activity: {
      _id: id,
      createdAt: at,
      eventType: "archived",
      userName: "Ada",
      userAvatarUrl: null,
    },
  };
}

function foreignThreadWork() {
  return {
    threadId: "thread_1" as Id<"cliThreads">,
    threadTitle: "Someone's run",
    userId: "user_2" as Id<"users">,
    userName: "Morgan",
    cliType: "claude-code",
    status: "completed" as const,
    source: "manual_attachment" as const,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function timelineState(overrides: Partial<ReturnType<typeof baseState>> = {}) {
  useTaskTimelineMock.mockReturnValue({ ...baseState(), ...overrides });
}

/**
 * Radix opens a dropdown on `pointerdown`, not on `click` — `fireEvent.click`
 * alone leaves the menu closed and every query for its items fails.
 */
async function openFilterMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: /^Filter timeline/ }), {
    button: 0,
    pointerType: "mouse",
  });
  // Radix mounts the content asynchronously, so wait on a known item rather
  // than assuming it is present on the next tick.
  await screen.findByRole("menuitemradio", { name: "Oldest first" });
}

/** Opens the filter menu and clicks one source row. */
async function toggleSourceMenuItem(label: string) {
  await openFilterMenu();
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: label }));
}

async function chooseSortDirection(label: string) {
  await openFilterMenu();
  fireEvent.click(await screen.findByRole("menuitemradio", { name: label }));
}

function baseState() {
  return {
    items: [] as ReturnType<typeof activityItem>[],
    nextBefore: null as { at: number; creationTime: number } | null,
    isDone: true,
    isLoading: false,
    isLoadingMore: false,
    loadMore: loadMoreMock,
  };
}

const THREAD_CONTEXT = {
  projectId: "project_1" as Id<"projects">,
  organizationSlug: "contoso",
  projectAlias: "OS",
};

function renderTimeline(
  overrides: Partial<Parameters<typeof TaskTimeline>[0]> = {}
) {
  return render(
    <TaskTimeline
      task={buildTask()}
      threadContext={THREAD_CONTEXT}
      composerMode="thread"
      onComposerModeChange={vi.fn()}
      threadFocusRequestKey={0}
      {...overrides}
    />
  );
}

beforeEach(() => {
  useQueryMock.mockReturnValue([]);
  timelineState();
});

afterEach(() => {
  useTaskTimelineMock.mockReset();
  useQueryMock.mockReset();
  loadMoreMock.mockReset();
  // The view prefs are read in a `useState` initializer, so a leaked key would
  // silently change the next test's starting sources.
  window.localStorage.clear();
  cleanup();
});

describe("TaskTimeline", () => {
  test("renders skeletons while the first page is loading", () => {
    timelineState({ isLoading: true, isDone: false });

    renderTimeline();

    expect(screen.getByTestId("task-timeline-loading-skeleton")).toBeTruthy();
    expect(screen.queryByText("No activity yet")).toBeNull();
  });

  test("renders the empty state once every source has resolved empty", () => {
    renderTimeline();

    expect(screen.getByText("No activity yet")).toBeTruthy();
  });

  test("does not render the empty state for a trailing empty page", () => {
    // The evenly-divided case: rows are loaded, the newest page came back empty
    // and done. Showing "No activity yet" here would contradict the stream.
    timelineState({ items: [activityItem("a1", 1000)] });

    renderTimeline();

    expect(screen.queryByText("No activity yet")).toBeNull();
    expect(screen.getByTestId("block-activity-group")).toBeTruthy();
  });

  // A resolved page can render zero blocks while older rows remain: retired
  // `comment_added` rows are dropped client-side and the server does not filter
  // them. Showing "No activity yet" beside a `Load more` button contradicts
  // itself, so the empty state waits for `isDone`.
  test("withholds the empty state while older rows are still reachable", () => {
    timelineState({ isDone: false, nextBefore: { at: 900, creationTime: 90 } });

    renderTimeline();

    expect(screen.queryByText("No activity yet")).toBeNull();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  // Done and empty: no rows, no `Load more`. The wrapper would otherwise
  // contribute bare padding between the empty-state copy and the composer.
  test("collapses the stream wrapper when it has nothing to render", () => {
    renderTimeline();

    const wrapper = screen.getByTestId("task-timeline-stream");
    expect(wrapper.className).toContain("empty:hidden");
    expect(wrapper.childElementCount).toBe(0);
  });

  test("gates Load more on isDone rather than on a non-empty page", () => {
    timelineState({ items: [activityItem("a1", 1000)], isDone: false });

    renderTimeline();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(loadMoreMock).toHaveBeenCalled();
  });

  test("shows an ellipsis while older rows load", () => {
    timelineState({ items: [activityItem("a1", 1000)], isDone: false, isLoadingMore: true });

    renderTimeline();

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  test("hides Load more once done", () => {
    timelineState({ items: [activityItem("a1", 1000)] });

    renderTimeline();

    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  test("withholds foreign thread rows until the own-thread query resolves", () => {
    // With an empty own-id set every entry matches the "not mine" test, so the
    // viewer's own thread would flash as a foreign row.
    useQueryMock.mockReturnValue(undefined);
    timelineState({ items: [activityItem("a1", 1000)] });

    renderTimeline({ task: buildTask({ agentThreadWork: [foreignThreadWork()] }) });

    expect(screen.queryByTestId("block-thread")).toBeNull();
  });

  test("renders a foreign thread row once the own-thread query resolves", () => {
    timelineState({ items: [activityItem("a1", 1000)] });

    renderTimeline({ task: buildTask({ agentThreadWork: [foreignThreadWork()] }) });

    expect(screen.getByTestId("block-thread")).toBeTruthy();
  });

  test("splices out threads older than the loaded stream", () => {
    // A thread from before the page floor would otherwise sit above content
    // that has not been fetched yet.
    timelineState({
      items: [activityItem("a1", 1000)],
      nextBefore: { at: 900, creationTime: 90 },
      isDone: false,
    });

    renderTimeline({
      task: buildTask({
        agentThreadWork: [
          {
            threadId: "thread_old" as Id<"cliThreads">,
            threadTitle: "Ancient run",
            userId: "user_2" as Id<"users">,
            userName: "Morgan",
            cliType: "claude-code",
            status: "completed",
            source: "manual_attachment",
            createdAt: 10,
            updatedAt: 10,
          },
        ],
      }),
    });

    expect(screen.queryByTestId("block-thread")).toBeNull();
  });

  // One absent value, not three: `threadContext` is present or it is not, so
  // there is no partial project route to represent.
  test("skips the own-thread query entirely outside a project route", () => {
    renderTimeline({ threadContext: undefined });

    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), "skip");
  });

  test("requests every source by default", () => {
    renderTimeline();

    expect(useTaskTimelineMock).toHaveBeenCalledWith({
      taskId: "task_1",
      sources: { activity: true, comments: true, threads: true },
    });
  });
});

describe("TaskTimeline source filters", () => {
  // Reading the stored prefs in a `useState` initializer is what keeps this to
  // one subscription: seeding from the defaults and correcting in an effect
  // would subscribe page 0 under the wrong source set and immediately refetch.
  test("subscribes with the stored sources on the first render", () => {
    window.localStorage.setItem("convoy.task-timeline-source-activity", "0");

    renderTimeline();

    expect(useTaskTimelineMock).toHaveBeenCalledTimes(1);
    expect(useTaskTimelineMock).toHaveBeenCalledWith({
      taskId: "task_1",
      sources: { activity: false, comments: true, threads: true },
    });
  });

  test("passes a disabled source through to the query and persists the toggle", async () => {
    renderTimeline();

    await toggleSourceMenuItem("Activity");

    expect(useTaskTimelineMock).toHaveBeenLastCalledWith({
      taskId: "task_1",
      sources: { activity: false, comments: true, threads: true },
    });
    expect(window.localStorage.getItem("convoy.task-timeline-source-activity")).toBe("0");
  });

  // A disabled source is a read that does not happen. The thread source is
  // client-side, so "skipped" means the query itself is skipped.
  test("skips the own-thread query when the threads source is off", async () => {
    renderTimeline();

    await toggleSourceMenuItem("Threads");

    expect(useQueryMock).toHaveBeenLastCalledWith(expect.anything(), "skip");
  });

  test("drops thread rows when the threads source is off", async () => {
    timelineState({ items: [activityItem("a1", 1000)] });

    renderTimeline({ task: buildTask({ agentThreadWork: [foreignThreadWork()] }) });
    expect(screen.getByTestId("block-thread")).toBeTruthy();

    await toggleSourceMenuItem("Threads");

    expect(screen.queryByTestId("block-thread")).toBeNull();
  });

  test("says the viewer hid everything rather than claiming the task is empty", async () => {
    renderTimeline();

    await toggleSourceMenuItem("Comments");
    await toggleSourceMenuItem("Threads");
    await toggleSourceMenuItem("Activity");

    expect(screen.getByText(/Every source is hidden/)).toBeTruthy();
    expect(screen.queryByText("No activity yet")).toBeNull();
    expect(screen.queryByTestId("task-timeline-stream")).toBeNull();
  });

  // With every source off there is no page to wait for, so the skeleton would
  // be waiting on a request that is never made.
  test("does not render the skeleton with every source off", () => {
    window.localStorage.setItem("convoy.task-timeline-source-activity", "0");
    window.localStorage.setItem("convoy.task-timeline-source-comments", "0");
    window.localStorage.setItem("convoy.task-timeline-source-threads", "0");
    timelineState({ isLoading: true, isDone: false });

    renderTimeline();

    expect(screen.queryByTestId("task-timeline-loading-skeleton")).toBeNull();
    expect(screen.getByText(/Every source is hidden/)).toBeTruthy();
  });

  // Outside a project route the toggle is hidden, so a stored-off `threads`
  // pref must not flag the menu as filtered — there would be nothing to restore.
  test("hides the threads toggle outside a project route", async () => {
    window.localStorage.setItem("convoy.task-timeline-source-threads", "0");

    renderTimeline({ threadContext: undefined });

    // Asserted before opening: Radix takes the trigger out of the a11y tree
    // while its menu is open. The stored-off thread pref must not read as
    // "filtered" where the toggle is not even offered.
    expect(screen.getByRole("button", { name: "Filter timeline" })).toBeTruthy();

    await openFilterMenu();
    expect(screen.getByRole("menuitemcheckbox", { name: "Comments" })).toBeTruthy();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Threads" })).toBeNull();
  });

  test("marks the trigger filtered while a visible source is off", async () => {
    renderTimeline();
    expect(screen.getByRole("button", { name: "Filter timeline" })).toBeTruthy();

    await toggleSourceMenuItem("Activity");

    expect(screen.getByRole("button", { name: "Filter timeline (filtered)" })).toBeTruthy();
  });
});

describe("TaskTimeline sort direction", () => {
  test("defaults to oldest-first with Load more above the stream", () => {
    timelineState({ items: [activityItem("a1", 1000)], isDone: false });

    renderTimeline();

    const stream = screen.getByTestId("task-timeline-stream");
    const [first] = Array.from(stream.children);
    expect(first.textContent).toContain("Load more");
  });

  // `Load more` always walks backwards in time, so it belongs at whichever end
  // holds the oldest row — the bottom once the stream reads newest-first.
  test("moves Load more below the stream when reading newest-first", async () => {
    timelineState({ items: [activityItem("a1", 1000)], isDone: false });

    renderTimeline();
    await chooseSortDirection("Newest first");

    const stream = screen.getByTestId("task-timeline-stream");
    const last = stream.children[stream.children.length - 1];
    expect(last.textContent).toContain("Load more");
  });

  test("flips the merge direction and persists the choice", async () => {
    renderTimeline();

    await chooseSortDirection("Newest first");

    expect(window.localStorage.getItem("convoy.task-timeline-sort-direction")).toBe("desc");
  });

  test("reads the stored direction on the first render", () => {
    window.localStorage.setItem("convoy.task-timeline-sort-direction", "desc");
    timelineState({ items: [activityItem("a1", 1000)], isDone: false });

    renderTimeline();

    const stream = screen.getByTestId("task-timeline-stream");
    const last = stream.children[stream.children.length - 1];
    expect(last.textContent).toContain("Load more");
  });

  test("passes the direction down so the composer can invert its own parts", () => {
    renderTimeline();

    expect(screen.getByTestId("composer").textContent).toBe("Composer:asc");
  });
});

/** True when the composer precedes the stream region in document order. */
function composerPrecedesStream(): boolean {
  const composer = screen.getByTestId("composer");
  const stream = screen.getByTestId("task-timeline-stream-region");
  return Boolean(composer.compareDocumentPosition(stream) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("TaskTimeline surface order", () => {
  test("puts the composer below the stream reading oldest-first", () => {
    timelineState({ items: [activityItem("a1", 1000)] });

    renderTimeline();

    expect(composerPrecedesStream()).toBe(false);
  });

  // The composer belongs at the end the newest row is at, so the whole surface
  // reverses with the sort — not just the row order inside the stream.
  test("puts the composer above the stream reading newest-first", async () => {
    timelineState({ items: [activityItem("a1", 1000)] });

    renderTimeline();
    await chooseSortDirection("Newest first");

    expect(composerPrecedesStream()).toBe(true);
    expect(screen.getByTestId("composer").textContent).toBe("Composer:desc");
  });

  // It labels the section and owns the control that does the flipping, so it
  // would be self-defeating for it to move out from under the pointer.
  test("keeps the header at the top in both directions", async () => {
    timelineState({ items: [activityItem("a1", 1000)] });

    renderTimeline();
    // Precedes *both* halves of the flip, whichever order they are in.
    const headerIsFirst = () => {
      const header = screen.getByRole("button", { name: /^Filter timeline/ });
      return [
        screen.getByTestId("composer"),
        screen.getByTestId("task-timeline-stream-region"),
      ].every((el) =>
        Boolean(header.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    };

    expect(headerIsFirst()).toBe(true);

    await chooseSortDirection("Newest first");
    expect(headerIsFirst()).toBe(true);
  });
});
