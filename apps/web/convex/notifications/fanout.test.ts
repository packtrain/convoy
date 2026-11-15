/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { NOTIFICATION_RETENTION_MS } from "./lib/constants";
import { normalizeCliChunkToEvent } from "../cli/lib/chunks/normalizedEvents";
import { notificationsFanout, THREAD_MESSAGE_PREVIEW_CHUNK_SCAN } from "./fanout";

async function drain(t: { finishInProgressScheduledFunctions: () => Promise<void> }) {
  vi.advanceTimersByTime(1);
  await t.finishInProgressScheduledFunctions();
}

/** Full pipeline: task mutation → emitEvents → ingest → notifications fan-out. */
describe("notifications fan-out", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("status change notifies creator and assignee, never the actor", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user: creator, org, project, t } = await ctx.setupProject();
    const assignee = await ctx.user();
    await ctx.orgMember(org._id, assignee._id, "member");
    await ctx.projectMember(project._id, assignee._id, "member");
    const asAssignee = ctx.asUser(assignee);

    const task = await ctx.task(project._id, creator._id, { assigneeId: assignee._id });

    await asAssignee.mutation(api.tasks.core.update, { id: task._id, status: "In Progress" });
    await drain(t);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: creator._id,
        type: "task.status_changed",
        actorUserId: assignee._id,
        // Inbox reads are org-scoped, so every row is stamped with its org.
        organizationId: org._id,
        projectId: project._id,
        subject: { kind: "task", id: task._id },
        read: false,
        snapshot: {
          taskRef: `${project.alias}-${task.refNumber}`,
          taskTitle: task.name,
          actorName: assignee.name,
          newStatus: "In Progress",
        },
      });
    });
  });

  test("status change to Done becomes task.completed; delete notifies from the soft-deleted task", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user: creator, org, project, asUser, t } = await ctx.setupProject();
    const assignee = await ctx.user();
    await ctx.orgMember(org._id, assignee._id, "member");
    await ctx.projectMember(project._id, assignee._id, "member");

    const task = await ctx.task(project._id, creator._id, { assigneeId: assignee._id });

    await asUser.mutation(api.tasks.core.update, { id: task._id, status: "Done" });
    await drain(t);
    // api.tasks.core.remove's 30-day permanentlyDelete timer overflows in
    // convex-test and hard-deletes the row on drain, so soft-delete manually
    // and ingest the event directly to exercise the deleted-task snapshot path.
    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", task._id, { isDeleted: true, deletedAt: Date.now(), deletedBy: creator._id });
    });
    await t.mutation(internal.events.core.ingest, {
      events: [
        {
          type: "task.deleted",
          actorUserId: creator._id,
          projectId: project._id,
          subject: { kind: "task", id: task._id },
          payload: {},
        },
      ],
    });

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows.map((row) => [row.userId, row.type]).sort()).toEqual(
        [
          [assignee._id, "task.completed"],
          [assignee._id, "task.deleted"],
        ].sort()
      );
      const completed = rows.find((row) => row.type === "task.completed");
      expect(completed?.snapshot.newStatus).toBe("Done");
    });
  });

  test("self-action with no other recipient produces nothing", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id, { assigneeId: user._id });

    await asUser.mutation(api.tasks.core.update, { id: task._id, status: "In Progress" });
    await drain(t);

    await t.run(async (runCtx) => {
      expect(await runCtx.db.query("notifications").collect()).toHaveLength(0);
    });
  });

  test("comment notifies the assignee when the creator comments", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user: creator, org, project, asUser, t } = await ctx.setupProject();
    const assignee = await ctx.user();
    await ctx.orgMember(org._id, assignee._id, "member");
    await ctx.projectMember(project._id, assignee._id, "member");
    const task = await ctx.task(project._id, creator._id, { assigneeId: assignee._id });

    await asUser.mutation(api.tasks.comments.create, { taskId: task._id, content: "ping" });
    await drain(t);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: assignee._id, type: "task.comment_added" });
    });
  });

  test("rapid same-type events coalesce into one unread row; read rows survive", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user: creator, org, project, t } = await ctx.setupProject();
    const assignee = await ctx.user();
    await ctx.orgMember(org._id, assignee._id, "member");
    await ctx.projectMember(project._id, assignee._id, "member");
    const asAssignee = ctx.asUser(assignee);
    const task = await ctx.task(project._id, creator._id, { assigneeId: assignee._id });

    await asAssignee.mutation(api.tasks.core.update, { id: task._id, status: "In Progress" });
    await drain(t);
    await asAssignee.mutation(api.tasks.core.update, { id: task._id, status: "In Review" });
    await drain(t);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0].snapshot.newStatus).toBe("In Review");
      await runCtx.db.patch("notifications", rows[0]._id, { read: true, readAt: Date.now() });
    });

    await asAssignee.mutation(api.tasks.core.update, { id: task._id, status: "To Do" });
    await drain(t);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => !row.read)).toHaveLength(1);
    });
  });

  test("a disabled inApp preference makes that type's rows toast-only (born read)", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user: creator, org, project, t } = await ctx.setupProject();
    const assignee = await ctx.user();
    await ctx.orgMember(org._id, assignee._id, "member");
    await ctx.projectMember(project._id, assignee._id, "member");
    const asAssignee = ctx.asUser(assignee);
    const task = await ctx.task(project._id, creator._id, { assigneeId: assignee._id });

    await t.run(async (runCtx) => {
      await runCtx.db.insert("notificationPreferences", {
        userId: creator._id,
        type: "task.status_changed",
        channel: "inApp",
        enabled: false,
      });
    });

    await asAssignee.mutation(api.tasks.core.update, { id: task._id, status: "In Progress" });
    await drain(t);
    await asAssignee.mutation(api.tasks.core.update, { id: task._id, status: "Done" });
    await drain(t);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      // status_changed still lands (toast stays on) but arrives pre-read —
      // no badge/unread noise, no readAt (nobody read it); completed unread.
      const statusChanged = rows.find((row) => row.type === "task.status_changed");
      const completed = rows.find((row) => row.type === "task.completed");
      expect(rows).toHaveLength(2);
      expect(statusChanged).toMatchObject({ read: true });
      expect(statusChanged?.readAt).toBeUndefined();
      expect(completed).toMatchObject({ read: false });
    });
  });

  test("disabling both inApp and toast suppresses the row entirely", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user: creator, org, project, t } = await ctx.setupProject();
    const assignee = await ctx.user();
    await ctx.orgMember(org._id, assignee._id, "member");
    await ctx.projectMember(project._id, assignee._id, "member");
    const asAssignee = ctx.asUser(assignee);
    const task = await ctx.task(project._id, creator._id, { assigneeId: assignee._id });

    await t.run(async (runCtx) => {
      for (const channel of ["inApp", "toast"] as const) {
        await runCtx.db.insert("notificationPreferences", {
          userId: creator._id,
          type: "task.status_changed",
          channel,
          enabled: false,
        });
      }
    });

    await asAssignee.mutation(api.tasks.core.update, { id: task._id, status: "In Progress" });
    await drain(t);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toEqual([]);
    });
  });

  test("task created with an assignee notifies the assignee", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();
    const assignee = await ctx.user();
    await ctx.orgMember(org._id, assignee._id, "member");
    await ctx.projectMember(project._id, assignee._id, "member");

    await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: "client-created-notify",
      name: "created with assignee",
      priority: "None",
      status: "To Do",
      assigneeId: assignee._id,
      tags: [],
    });
    await drain(t);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: assignee._id, type: "task.created" });
    });
  });

  test("thread completion and failure notify the owner with the runtime label", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    const profile = await ctx.cliProfile(user._id, project._id);
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    const streamingThread = (title: string) =>
      ctx.cliThread(user._id, project._id, profile._id, {
        title,
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });

    const completedChat = await streamingThread("Refactor auth");
    const completedMessage = await ctx.cliMessage(completedChat._id, profile._id, {
      role: "assistant",
      status: "streaming",
      claimedBySessionId: session._id,
    });
    await t.run(async (runCtx) => {
      await runCtx.db.insert("cliMessageChunks", {
        messageId: completedMessage._id,
        threadId: completedChat._id,
        profileId: profile._id,
        chunkOrder: 0,
        type: "assistant",
        data: "{}",
        normalizedEvent: { kind: "text", text: "All done — auth refactored." },
        timestamp: Date.now(),
        createdAt: Date.now(),
      });
    });
    await t.mutation(api.cli.messages.complete, {
      messageId: completedMessage._id,
      sessionId: session._id,
      apiKey: apiKeyResult.key,
    });
    await drain(t);

    const failedChat = await streamingThread("Fix tests");
    const failedMessage = await ctx.cliMessage(failedChat._id, profile._id, {
      role: "assistant",
      status: "streaming",
      claimedBySessionId: session._id,
    });
    await t.mutation(api.cli.messages.fail, {
      messageId: failedMessage._id,
      sessionId: session._id,
      errorMessage: "boom",
      apiKey: apiKeyResult.key,
    });
    await drain(t);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toHaveLength(2);
      const completed = rows.find((row) => row.type === "thread.completed");
      expect(completed).toMatchObject({
        userId: user._id,
        organizationId: org._id,
        projectId: project._id,
        subject: { kind: "thread", id: completedChat._id },
        // Agent runs default to toast-only: the row is born read.
        read: true,
        snapshot: {
          threadTitle: "Refactor auth",
          threadCliType: "claude-code",
          threadMessage: "All done — auth refactored.",
          actorName: "Claude Code",
        },
      });
      expect(completed?.actorUserId).toBeUndefined();
      expect(completed?.readAt).toBeUndefined();
      const failed = rows.find((row) => row.type === "thread.failed");
      expect(failed).toMatchObject({
        subject: { kind: "thread", id: failedChat._id },
        snapshot: { threadTitle: "Fix tests" },
      });
    });
  });

  test.each(["text", "proposed-plan"] as const)("the completion preview includes %s and skips ephemeral streaming deltas", async kind => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    const profile = await ctx.cliProfile(user._id, project._id);
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Refactor auth",
      status: "streaming",
      claimedBySessionId: session._id,
      claimLeaseExpiresAt: Date.now() + 60_000,
      processingState: "streaming",
    });
    const message = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
      claimedBySessionId: session._id,
    });

    // The real text, then enough ephemeral rows to bury it past the scan
    // window: the tail scan must not see them at all (OS-1673) — they are the
    // rows `cleanupEphemeralChunks` deletes concurrently, and a scan that
    // includes them both conflicts with that janitor and loses the preview.
    // Derived from the real cap, so raising it can't quietly leave the stored
    // row inside a pre-fix broad scan and strand this test green.
    const ephemeralRowCount = THREAD_MESSAGE_PREVIEW_CHUNK_SCAN + 1;
    await t.run(async (runCtx) => {
      const now = Date.now();
      await runCtx.db.insert("cliMessageChunks", {
        messageId: message._id,
        threadId: chat._id,
        profileId: profile._id,
        chunkOrder: 0,
        type: "assistant",
        data: "{}",
        normalizedEvent: kind === "text"
          ? { kind, text: "All done — auth refactored." }
          : { kind, phase: "completed", itemId: "plan-1", turnId: "turn-1", text: "All done — auth refactored." },
        timestamp: now,
        createdAt: now,
      });
      await runCtx.db.insert("cliMessageChunks", {
        messageId: message._id, threadId: chat._id, profileId: profile._id,
        chunkOrder: ephemeralRowCount + 1, type: "assistant", data: "{}",
        normalizedEvent: { kind: "text", text: "child result", source: { scope: "child", parentToolUseId: "task" } },
        timestamp: now + 1, createdAt: now + 1,
      });
      // `kind: "text"` on purpose, where production deltas normalize to
      // `text-delta`: a `text-delta` row is skipped by the reader's kind check
      // anyway, so the test would pass without the index pin doing any work.
      // Every row here is individually a valid preview match, which makes the
      // stored-only index range the only reason the right one wins.
      for (let index = 1; index <= ephemeralRowCount; index++) {
        await runCtx.db.insert("cliMessageChunks", {
          messageId: message._id,
          threadId: chat._id,
          profileId: profile._id,
          chunkOrder: index,
          type: "assistant",
          data: "{}",
          normalizedEvent: { kind: "text", text: `delta ${index}` },
          ephemeral: true,
          timestamp: now,
          createdAt: now,
        });
      }
    });

    // `fail`, not `complete`: failed messages keep their ephemeral rows on
    // purpose (the deltas are the only record of partial output), so the
    // reader's window is the whole story here.
    await t.mutation(api.cli.messages.fail, {
      messageId: message._id,
      sessionId: session._id,
      errorMessage: "boom",
      apiKey: apiKeyResult.key,
    });
    await drain(t);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "thread.failed",
        snapshot: { threadMessage: "All done — auth refactored." },
      });
    });
  });

  test("a new interaction request notifies the owner that input is needed", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    const profile = await ctx.cliProfile(user._id, project._id);
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      claimedBySessionId: session._id,
      claimLeaseExpiresAt: Date.now() + 60_000,
      processingState: "streaming",
    });
    const message = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
      claimedBySessionId: session._id,
    });
    // The run is still streaming when this event dispatches: reading this
    // chunk is exactly what conflicted with appendRunContent, so the prompt
    // — not the chunk — must be the preview.
    await t.run(async (runCtx) => {
      await runCtx.db.insert("cliMessageChunks", {
        messageId: message._id,
        threadId: chat._id,
        profileId: profile._id,
        chunkOrder: 0,
        type: "assistant",
        data: "{}",
        normalizedEvent: { kind: "text", text: "Thinking about the schema..." },
        timestamp: Date.now(),
        createdAt: Date.now(),
      });
    });

    await t.mutation(api.cli.interactionRequests.create, {
      threadId: chat._id,
      messageId: message._id,
      sessionId: session._id,
      requestId: "req-1",
      kind: "question",
      payloadJson: JSON.stringify({
        toolName: "AskUserQuestion",
        questions: [{ question: "Which database should we use?", options: [] }],
      }),
      expiresAt: Date.now() + 60_000,
      apiKey: apiKeyResult.key,
    });
    await drain(t);
    // Lease refresh of the same pending request must not emit again.
    await t.mutation(api.cli.interactionRequests.create, {
      threadId: chat._id,
      messageId: message._id,
      sessionId: session._id,
      requestId: "req-1",
      kind: "question",
      payloadJson: "{}",
      expiresAt: Date.now() + 90_000,
      apiKey: apiKeyResult.key,
    });
    await drain(t);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: user._id,
        type: "thread.waiting_input",
        snapshot: { threadMessage: "Which database should we use?" },
      });
    });
  });

  test("completing a run after a pending interaction request keeps the original waiting_input row", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    const profile = await ctx.cliProfile(user._id, project._id);
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      claimedBySessionId: session._id,
      claimLeaseExpiresAt: Date.now() + 60_000,
      processingState: "streaming",
    });
    const message = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
      claimedBySessionId: session._id,
    });

    await t.mutation(api.cli.interactionRequests.create, {
      threadId: chat._id,
      messageId: message._id,
      sessionId: session._id,
      requestId: "req-1",
      kind: "question",
      payloadJson: "{}",
      expiresAt: Date.now() + 60_000,
      apiKey: apiKeyResult.key,
    });
    await drain(t);

    const originalId = await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toHaveLength(1);
      return rows[0]._id;
    });

    // The run then completes still waiting for input — the same wait episode
    // must not re-emit: a coalesced reinsert would mint a fresh toast identity.
    await t.mutation(api.cli.messages.complete, {
      messageId: message._id,
      sessionId: session._id,
      chatStatus: "waiting_input",
      apiKey: apiKeyResult.key,
    });
    await drain(t);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]._id).toBe(originalId);
      expect(rows[0].type).toBe("thread.waiting_input");
    });
  });

  test("cancelling your own run self-suppresses the thread.failed notification", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    const profile = await ctx.cliProfile(user._id, project._id);
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      claimedBySessionId: session._id,
      claimLeaseExpiresAt: Date.now() + 60_000,
      processingState: "streaming",
    });
    const message = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
      claimedBySessionId: session._id,
    });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, { activeAssistantMessageId: message._id });
    });

    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, { threadId: chat._id });
    await drain(t);

    await t.run(async (runCtx) => {
      expect(await runCtx.db.query("notifications").collect()).toHaveLength(0);
    });
  });

  test("retention sweep deletes rows older than 90 days and keeps fresh ones", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user, project, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    const row = {
      userId: user._id,
      type: "task.status_changed" as const,
      projectId: project._id,
      subject: { kind: "task" as const, id: task._id },
      read: false,
      snapshot: { taskRef: "T-1", taskTitle: "old" },
    };
    await t.run(async (runCtx) => {
      await runCtx.db.insert("notifications", row);
    });

    vi.advanceTimersByTime(NOTIFICATION_RETENTION_MS + 60_000);

    await t.run(async (runCtx) => {
      await runCtx.db.insert("notifications", { ...row, snapshot: { taskRef: "T-1", taskTitle: "fresh" } });
    });

    await t.mutation(internal.notifications.core.retentionSweep, {});

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0].snapshot.taskTitle).toBe("fresh");
    });
  });
});


test("Codex notification previews need no message identity lookup", async () => {
  const ctx = createTestContext();
  const { user, project } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id);
  const thread = await ctx.cliThread(user._id, project._id, profile._id, { cliType: "codex" });
  const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant" });
  await ctx.t.run(async (runCtx) => {
    for (const [index, provider] of ["root", "child"].entries()) {
      const chunk = {
        type: "item/completed",
        data: JSON.stringify({ threadId: provider, convoyRootThreadId: "root", item: { type: "agentMessage", id: provider, text: provider === "root" ? "Root answer" : "Child answer" } }),
      };
      await runCtx.db.insert("cliMessageChunks", {
        ...chunk, messageId: message._id, threadId: thread._id, profileId: profile._id,
        normalizedEvent: normalizeCliChunkToEvent(chunk, "codex"),
        chunkOrder: index, createdAt: Date.now(), timestamp: Date.now(),
      });
    }
    const event = { type: "thread.completed" as const, subject: { kind: "thread" as const, id: thread._id }, payload: { messageId: message._id } };
    const eventId = await runCtx.db.insert("events", event);
    const get = vi.spyOn(runCtx.db, "get");
    try {
      await notificationsFanout.handle(runCtx, { ...event, eventId });
      expect(get.mock.calls.filter(([table]) => table === "cliMessages")).toHaveLength(0);
      const rows = await runCtx.db.query("notifications").collect();
      expect(rows[0]?.snapshot.threadMessage).toBe("Root answer");
    } finally { get.mockRestore(); }
  });
});
