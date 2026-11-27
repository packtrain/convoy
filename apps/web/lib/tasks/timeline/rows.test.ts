import { describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { ActivityLog, Comment, TaskAgentThreadWorkEntry } from "@/lib/tasks/types";
import {
  buildTimelineThreadRows,
  groupTimelineRows,
  mergeTimelineRows,
  spliceThreadRows,
  type OwnTimelineThread,
  type TimelineRow,
  type TimelineThreadRow,
} from "./rows";

function activity(id: string, at: number, overrides: Partial<ActivityLog> = {}): ActivityLog {
  return {
    _id: id as Id<"taskActivityLogs">,
    _creationTime: at,
    taskId: "task_1" as Id<"tasks">,
    userId: "user_1" as Id<"users">,
    userName: "Ada Lovelace",
    userAvatarUrl: null,
    eventType: "archived",
    createdAt: at,
    ...overrides,
  } as ActivityLog;
}

function comment(id: string, at: number): Comment {
  return {
    _id: id as Id<"taskComments">,
    _creationTime: at,
    taskId: "task_1" as Id<"tasks">,
    authorId: "user_1" as Id<"users">,
    authorName: "Ada Lovelace",
    authorAvatarUrl: null,
    content: "hello",
    createdAt: at,
    updatedAt: at,
    isEdited: false,
    attachments: [],
    canEdit: false,
    canDelete: false,
  };
}

function ownThread(id: string, overrides: Partial<OwnTimelineThread> = {}): OwnTimelineThread {
  return {
    _id: id as Id<"cliThreads">,
    title: "Own run",
    status: "completed",
    cliType: "claude-code",
    createdAt: 1_000,
    lastActivityAt: 9_000,
    requiresAttention: false,
    pullRequestChecksRunning: false,
    hasUnread: false,
    isDone: false,
    ...overrides,
  };
}

function workEntry(
  threadId: string,
  overrides: Partial<TaskAgentThreadWorkEntry> = {}
): TaskAgentThreadWorkEntry {
  return {
    threadId: threadId as Id<"cliThreads">,
    threadTitle: "Their run",
    userId: "user_2" as Id<"users">,
    userName: "Morgan Doe",
    cliType: "codex",
    status: "streaming",
    source: "manual_attachment",
    createdAt: 2_000,
    updatedAt: 8_000,
    ...overrides,
  };
}

const passthroughStatus = (thread: OwnTimelineThread) => thread.status;

function threadRow(overrides: Partial<TimelineThreadRow> = {}): TimelineThreadRow {
  return {
    threadId: "thread_1" as Id<"cliThreads">,
    title: "Run",
    status: "completed",
    cliType: "claude-code",
    createdAt: 1_000,
    lastActivityAt: 1_000,
    hasUnread: false,
    isDone: false,
    isOwn: true,
    isWorkflowRun: false,
    ...overrides,
  };
}

describe("buildTimelineThreadRows", () => {
  test("marks the viewer's own threads and attributes foreign ones", () => {
    const rows = buildTimelineThreadRows({
      ownThreads: [ownThread("mine")],
      agentThreadWork: [workEntry("mine"), workEntry("theirs")],
      deriveOwnStatus: passthroughStatus,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ threadId: "mine", isOwn: true });
    // No attribution on the viewer's own row — the name is what marks a row as
    // someone else's.
    expect(rows[0].userName).toBeUndefined();
    expect(rows[1]).toMatchObject({ threadId: "theirs", isOwn: false, userName: "Morgan Doe" });
  });

  // An own thread also has an `agentThreadWork` entry, so without the id filter
  // it would render twice — once as an openable row, once as a foreign one.
  test("does not duplicate a thread that appears in both sources", () => {
    const rows = buildTimelineThreadRows({
      ownThreads: [ownThread("mine")],
      agentThreadWork: [workEntry("mine")],
      deriveOwnStatus: passthroughStatus,
    });

    expect(rows.map((row) => row.threadId)).toEqual(["mine"]);
  });

  // The load-order guard: an empty own-id set matches everything, so foreign
  // rows must wait for the query rather than briefly claiming the viewer's own
  // threads.
  test("withholds foreign rows while the own-threads query is unresolved", () => {
    const rows = buildTimelineThreadRows({
      ownThreads: undefined,
      agentThreadWork: [workEntry("mine"), workEntry("theirs")],
      deriveOwnStatus: passthroughStatus,
    });

    expect(rows).toEqual([]);
  });

  test("carries the viewer's read state on an own row", () => {
    const [row] = buildTimelineThreadRows({
      ownThreads: [ownThread("mine", { hasUnread: true, isDone: true })],
      agentThreadWork: [],
      deriveOwnStatus: passthroughStatus,
    });

    expect(row).toMatchObject({ hasUnread: true, isDone: true });
  });

  // Read state is per-viewer and `agentThreadWork` holds none, so a foreign row
  // must not claim to be unread — it would show a blue dot the viewer can never
  // clear.
  test("reports a foreign row as neither unread nor done", () => {
    const rows = buildTimelineThreadRows({
      ownThreads: [],
      agentThreadWork: [workEntry("theirs")],
      deriveOwnStatus: passthroughStatus,
    });

    expect(rows[0]).toMatchObject({ isOwn: false, hasUnread: false, isDone: false });
  });

  test("sorts an own row by createdAt while displaying lastActivityAt", () => {
    const [row] = buildTimelineThreadRows({
      ownThreads: [ownThread("mine", { createdAt: 1_000, lastActivityAt: 9_000 })],
      agentThreadWork: [],
      deriveOwnStatus: passthroughStatus,
    });

    expect(row.createdAt).toBe(1_000);
    expect(row.lastActivityAt).toBe(9_000);
  });

  // The glyph means "this row *is* the run" (OS-1879): only an own container
  // qualifies. A lane thread carries the run's id too but sits inside it, and a
  // foreign `workflow_run` entry is a lane — the container's entry syncs as
  // `manual_attachment` — so no foreign row can claim the glyph.
  test("flags only the run's own container row", () => {
    const rows = buildTimelineThreadRows({
      ownThreads: [
        ownThread("mine-run", { workflowRunId: "run_1" as Id<"workflowRuns"> }),
        ownThread("mine-lane", { workflowRunId: "run_1" as Id<"workflowRuns">, parentThreadId: "mine-run" as Id<"cliThreads"> }),
        ownThread("mine-plain"),
      ],
      agentThreadWork: [workEntry("theirs-lane", { source: "workflow_run" }), workEntry("theirs-plain")],
      deriveOwnStatus: passthroughStatus,
    });

    expect(rows.map((row) => [row.threadId, row.isWorkflowRun])).toEqual([
      ["mine-run", true],
      ["mine-lane", false],
      ["mine-plain", false],
      ["theirs-lane", false],
      ["theirs-plain", false],
    ]);
  });

  test("derives an own row's display status through the injected policy", () => {
    const [row] = buildTimelineThreadRows({
      ownThreads: [ownThread("mine", { status: "streaming", hasPendingInteraction: true })],
      agentThreadWork: [],
      deriveOwnStatus: (thread) => (thread.hasPendingInteraction ? "waiting_input" : thread.status),
    });

    expect(row.status).toBe("waiting_input");
  });
});

describe("spliceThreadRows", () => {
  test("drops threads older than the page floor", () => {
    const rows = spliceThreadRows(
      [threadRow({ threadId: "old" as Id<"cliThreads">, createdAt: 100 }), threadRow({ threadId: "new" as Id<"cliThreads">, createdAt: 900 })],
      500
    );

    expect(rows.map((row) => row.threadId)).toEqual(["new"]);
  });

  test("renders a thread tied with the floor", () => {
    expect(spliceThreadRows([threadRow({ createdAt: 500 })], 500)).toHaveLength(1);
  });

  // `isDone`, or no enabled server source at all: the floor is unbounded.
  test("renders every thread when the floor is null", () => {
    expect(spliceThreadRows([threadRow({ createdAt: 1 })], null)).toHaveLength(1);
  });

  test("does not mutate the input", () => {
    const rows = [threadRow()];
    spliceThreadRows(rows, null);
    expect(rows).toHaveLength(1);
  });
});

describe("mergeTimelineRows", () => {
  const items = [
    { kind: "comment" as const, at: 300, comment: comment("c1", 300) },
    { kind: "activity" as const, at: 100, activity: activity("a1", 100) },
  ];

  test("orders newest-first for descending display", () => {
    const rows = mergeTimelineRows({
      items,
      threadRows: [threadRow({ createdAt: 200 })],
      direction: "desc",
    });

    expect(rows.map((row) => row.at)).toEqual([300, 200, 100]);
  });

  test("orders oldest-first for ascending display", () => {
    const rows = mergeTimelineRows({
      items,
      threadRows: [threadRow({ createdAt: 200 })],
      direction: "asc",
    });

    expect(rows.map((row) => row.at)).toEqual([100, 200, 300]);
  });

  // Server rows arrive in an order that is already exact by
  // (createdAt, _creationTime); a stable sort must not reshuffle a tied group.
  test("keeps the server's order within one millisecond", () => {
    const tied = [
      { kind: "activity" as const, at: 500, activity: activity("first", 500) },
      { kind: "activity" as const, at: 500, activity: activity("second", 500) },
      { kind: "activity" as const, at: 500, activity: activity("third", 500) },
    ];

    const rows = mergeTimelineRows({ items: tied, threadRows: [], direction: "desc" });

    expect(rows.map((row) => (row.kind === "activity" ? row.activity._id : null))).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  test("mirrors a tied group when flipped to ascending", () => {
    const tied = [
      { kind: "activity" as const, at: 500, activity: activity("first", 500) },
      { kind: "activity" as const, at: 500, activity: activity("second", 500) },
    ];

    const rows = mergeTimelineRows({ items: tied, threadRows: [], direction: "asc" });

    expect(rows.map((row) => (row.kind === "activity" ? row.activity._id : null))).toEqual([
      "second",
      "first",
    ]);
  });
});

describe("groupTimelineRows", () => {
  const activityRow = (id: string, at: number, overrides: Partial<ActivityLog> = {}): TimelineRow => ({
    kind: "activity",
    at,
    activity: activity(id, at, overrides),
  });

  test("collapses consecutive activity rows into one rail group", () => {
    const blocks = groupTimelineRows([activityRow("a1", 300), activityRow("a2", 200), activityRow("a3", 100)]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "activity-group" });
    expect(blocks[0].kind === "activity-group" && blocks[0].activities).toHaveLength(3);
  });

  test("a comment breaks a group", () => {
    const blocks = groupTimelineRows([
      activityRow("a1", 400),
      { kind: "comment", at: 300, comment: comment("c1", 300) },
      activityRow("a2", 200),
    ]);

    expect(blocks.map((block) => block.kind)).toEqual(["activity-group", "comment", "activity-group"]);
  });

  test("a thread breaks a group", () => {
    const blocks = groupTimelineRows([
      activityRow("a1", 400),
      { kind: "thread", at: 300, thread: threadRow({ createdAt: 300 }) },
      activityRow("a2", 200),
    ]);

    expect(blocks.map((block) => block.kind)).toEqual(["activity-group", "thread", "activity-group"]);
  });

  // Unlike the avatar-attributed activity log, the rail carries per-row actor
  // and time, so a different user is not a reason to break the shared line.
  test("does not split a group on a different user or a time gap", () => {
    const blocks = groupTimelineRows([
      activityRow("a1", 100_000, { userId: "user_1" as Id<"users">, userName: "Ada" }),
      activityRow("a2", 1_000, { userId: "user_2" as Id<"users">, userName: "Morgan" }),
    ]);

    expect(blocks).toHaveLength(1);
  });

  test("keys a block by its first row, not its index", () => {
    const blocks = groupTimelineRows([activityRow("a1", 300), activityRow("a2", 200)]);

    expect(blocks[0].key).toBe("activity:a1");
  });

  test("returns no blocks for an empty stream", () => {
    expect(groupTimelineRows([])).toEqual([]);
  });
});
