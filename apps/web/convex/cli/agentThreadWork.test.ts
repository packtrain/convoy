import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { createTestContext } from "../../convex-testing";

/**
 * OS-1094: denormalized `tasks.agentThreadWork` summary synced from the
 * cliThreads lifecycle (association, status, title, archive/delete).
 */

type TestContext = ReturnType<typeof createTestContext>;

async function setupThreadFixture(ctx: TestContext) {
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id, {
    paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
  });
  const task = await ctx.task(project._id, user._id, { name: "Automated task" });
  return { user, project, asUser, t, profile, task };
}

async function getAgentThreadWork(
  t: Awaited<ReturnType<TestContext["setupProject"]>>["t"],
  taskId: Id<"tasks">
): Promise<Doc<"tasks">["agentThreadWork"]> {
  return t.run(async (runCtx) => {
    const task = await runCtx.db.get("tasks", taskId);
    return task?.agentThreadWork;
  });
}

describe("agentThreadWork sync", () => {
  test("creating a thread with an attached task adds a pending manual_attachment entry", async () => {
    const ctx = createTestContext();
    const { user, asUser, t, profile, task } = await setupThreadFixture(ctx);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Work on this",
      taskId: task._id,
    });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries).toHaveLength(1);
    expect(entries?.[0]).toMatchObject({
      threadId,
      threadTitle: "Automated task",
      userId: user._id,
      userName: user.name,
      cliType: "claude-code",
      status: "pending",
      source: "manual_attachment",
    });
    expect(entries?.[0]?.updatedAt).toEqual(expect.any(Number));
  });

  test("creating a thread with agentWorkSource records assignment_automation", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);

    await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "codex",
      content: "Automation run",
      taskId: task._id,
      agentWorkSource: "assignment_automation",
    });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.source).toBe("assignment_automation");
    expect(entries?.[0]?.cliType).toBe("codex");
  });

  test("sending a task-attached message to an unassociated thread adds an entry", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "No task yet",
    });
    expect(await getAgentThreadWork(t, task._id)).toBeFalsy();

    await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "Now with a task",
      taskId: task._id,
    });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries).toHaveLength(1);
    expect(entries?.[0]).toMatchObject({ threadId, status: "pending", source: "manual_attachment" });
  });

  test("a task-attached message to an already-associated thread does not track the other task", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t, profile, task } = await setupThreadFixture(ctx);
    const otherTask = await ctx.task(project._id, user._id, { name: "Other task" });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Primary task",
      taskId: task._id,
    });

    await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "Mentioning another task",
      taskId: otherTask._id,
    });

    expect(await getAgentThreadWork(t, task._id)).toHaveLength(1);
    expect(await getAgentThreadWork(t, otherTask._id)).toBeFalsy();
  });

  test("stream lifecycle updates the entry status (streaming, completed, waiting_input)", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Run this",
      taskId: task._id,
    });

    const processRun = async (chatStatus?: "waiting_input") => {
      await t.mutation(api.cli.threads.runControl.claimThread, {
        threadId,
        sessionId: session._id,
        leaseMs: 60_000,
        apiKey: apiKeyResult.key,
      });
      const userMessageIds = await t.run(async (runCtx) => {
        const messages = await runCtx.db
          .query("cliMessages")
          .withIndex("by_thread", (q) => q.eq("threadId", threadId))
          .collect();
        return messages.filter((m) => m.role === "user" && !m.processedAt).map((m) => m._id);
      });
      const started = await t.mutation(api.cli.messages.startRunResponse, {
        threadId,
        sessionId: session._id,
        userMessageIds,
        apiKey: apiKeyResult.key,
      });

      const streamingEntries = await getAgentThreadWork(t, task._id);
      expect(streamingEntries?.[0]?.status).toBe("streaming");

      await t.mutation(api.cli.messages.complete, {
        messageId: started.assistantMessageId,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
        ...(chatStatus ? { chatStatus } : {}),
      });
    };

    await processRun();
    let entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.status).toBe("completed");

    await asUser.mutation(api.cli.messages.send, { threadId, content: "Follow up" });
    entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.status).toBe("pending");

    await processRun("waiting_input");
    entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.status).toBe("waiting_input");
  });

  test("a follow-up queued mid-stream keeps the entry streaming", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Run this",
      taskId: task._id,
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });
    const userMessageIds = await t.run(async (runCtx) => {
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect();
      return messages.filter((m) => m.role === "user" && !m.processedAt).map((m) => m._id);
    });
    await t.mutation(api.cli.messages.startRunResponse, {
      threadId,
      sessionId: session._id,
      userMessageIds,
      apiKey: apiKeyResult.key,
    });

    await asUser.mutation(api.cli.messages.send, { threadId, content: "Steer it differently" });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.status).toBe("streaming");
  });

  test("a mid-run pending interaction surfaces as waiting_input (OS-1287)", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Interactive run",
      taskId: task._id,
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });
    const userMessageIds = await t.run(async (runCtx) => {
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect();
      return messages.filter((m) => m.role === "user" && !m.processedAt).map((m) => m._id);
    });
    const started = await t.mutation(api.cli.messages.startRunResponse, {
      threadId,
      sessionId: session._id,
      userMessageIds,
      apiKey: apiKeyResult.key,
    });

    let entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.status).toBe("streaming");

    await t.mutation(api.cli.interactionRequests.create, {
      threadId,
      messageId: started.assistantMessageId,
      sessionId: session._id,
      requestId: "req-1",
      kind: "question",
      payloadJson: JSON.stringify({ question: "Which approach?" }),
      expiresAt: Date.now() + 60_000,
      apiKey: apiKeyResult.key,
    });

    entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.status).toBe("waiting_input");

    await asUser.mutation(api.cli.interactionRequests.respond, {
      threadId,
      requestId: "req-1",
      responseJson: JSON.stringify({ answer: "Option A" }),
    });

    entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.status).toBe("streaming");
  });

  test("renaming a thread updates the stored entry title", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Rename me",
      taskId: task._id,
    });

    await asUser.mutation(api.cli.threads.core.updateTitle, { threadId, title: "Renamed thread" });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.threadTitle).toBe("Renamed thread");
  });

  // OS-1561: done replaced archive, and done does NOT remove the entry —
  // users toggle it back and forth, so entry churn on every toggle is noise.
  test("marking a thread done keeps its entry", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Finish me",
      taskId: task._id,
      agentWorkSource: "assignment_automation",
    });

    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [threadId] });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries).toHaveLength(1);
    expect(entries?.[0]).toMatchObject({ threadId, source: "assignment_automation" });
  });

  test("soft-deleting a thread removes the entry", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Delete me",
      taskId: task._id,
    });

    await asUser.mutation(api.cli.threads.core.remove, { threadId });
    expect(await getAgentThreadWork(t, task._id)).toHaveLength(0);
  });

  test("supports multiple thread entries on the same task", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);

    const first = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "First run",
      taskId: task._id,
    });
    const second = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "codex",
      content: "Second run",
      taskId: task._id,
      agentWorkSource: "assignment_automation",
    });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries?.map((entry) => entry.threadId).sort()).toEqual([first, second].sort());
  });

  test("entries carry the bound agent identity (OS-1138)", async () => {
    const ctx = createTestContext();
    const { project, asUser, t, profile, task } = await setupThreadFixture(ctx);
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Reviewer",
      prompt: "Review carefully.",
      appearance: { color: "#22c55e" },
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Bound run",
      taskId: task._id,
      projectAgentId,
    });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries).toHaveLength(1);
    expect(entries?.[0]).toMatchObject({
      threadId,
      projectAgentId,
      agentName: "Reviewer",
    });
  });

  test("sync paths preserve the agent identity, including after agent deletion (OS-1138)", async () => {
    const ctx = createTestContext();
    const { project, asUser, t, profile, task } = await setupThreadFixture(ctx);
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Reviewer",
      appearance: { color: "#22c55e" },
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Bound run",
      taskId: task._id,
      projectAgentId,
    });

    await asUser.mutation(api.agents.projectAgents.deleteProjectAgent, { projectAgentId });
    await asUser.mutation(api.cli.threads.core.updateTitle, { threadId, title: "Renamed bound thread" });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]).toMatchObject({
      threadTitle: "Renamed bound thread",
      projectAgentId,
      agentName: "Reviewer",
    });
  });

  test("entries for unbound threads carry no agent fields (OS-1138)", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);

    await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Unbound run",
      taskId: task._id,
    });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.projectAgentId).toBeUndefined();
    expect(entries?.[0]?.agentName).toBeUndefined();
  });

  // OS-1588: the timeline orders every source by creation time, so an entry
  // needs the thread's own `createdAt` — `updatedAt` is restamped on each
  // status/title change and would drift a foreign row down the stream.
  test("a new entry records the thread's createdAt", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Timed run",
      taskId: task._id,
    });

    const threadCreatedAt = await t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", threadId);
      return thread?.createdAt;
    });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.createdAt).toBe(threadCreatedAt);
  });

  test("later syncs preserve the snapshotted createdAt", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Timed run",
      taskId: task._id,
    });

    const snapshotted = (await getAgentThreadWork(t, task._id))?.[0]?.createdAt;
    expect(snapshotted).toEqual(expect.any(Number));

    // Move the thread's own createdAt so a re-read would produce a different
    // value: only preservation from `existing` can keep the entry stable.
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", threadId, { createdAt: 1 });
    });
    await asUser.mutation(api.cli.threads.core.updateTitle, { threadId, title: "Renamed" });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries?.[0]?.threadTitle).toBe("Renamed");
    expect(entries?.[0]?.createdAt).toBe(snapshotted);
  });

  test("a legacy entry without createdAt still syncs, and is backfilled", async () => {
    const ctx = createTestContext();
    const { asUser, t, profile, task } = await setupThreadFixture(ctx);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Legacy run",
      taskId: task._id,
    });

    // Strip the field the way an entry written before OS-1588 looks.
    const { threadCreatedAt, threadTitle } = await t.run(async (runCtx) => {
      const stored = await runCtx.db.get("tasks", task._id);
      const legacy = (stored?.agentThreadWork ?? []).map((entry) => {
        const withoutCreatedAt = { ...entry };
        delete withoutCreatedAt.createdAt;
        return withoutCreatedAt;
      });
      await runCtx.db.patch("tasks", task._id, { agentThreadWork: legacy });
      const thread = await runCtx.db.get("cliThreads", threadId);
      return { threadCreatedAt: thread?.createdAt, threadTitle: thread?.title };
    });
    expect((await getAgentThreadWork(t, task._id))?.[0]?.createdAt).toBeUndefined();

    // Rename to the title it already has: title, status, and source all match,
    // so the *only* thing that can carry this write past the no-op
    // short-circuit is the missing field. Covers the backfill escape.
    await asUser.mutation(api.cli.threads.core.updateTitle, { threadId, title: threadTitle ?? "" });

    const entries = await getAgentThreadWork(t, task._id);
    expect(entries).toHaveLength(1);
    expect(entries?.[0]?.createdAt).toBe(threadCreatedAt);
  });

  test("thread lifecycle changes after the task is deleted fail soft", async () => {
    const ctx = createTestContext();
    const { asUser, profile, task } = await setupThreadFixture(ctx);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Task will disappear",
      taskId: task._id,
    });

    await asUser.mutation(api.tasks.core.remove, { id: task._id });

    await expect(
      asUser.mutation(api.cli.threads.core.updateTitle, { threadId, title: "Still fine" })
    ).resolves.toBeNull();
  });
});
