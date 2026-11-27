import { expect, test, describe, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { createTestContext, setupFakeTimers } from "../../../convex-testing";
import { deleteSession } from "../lib/cliSessionsRepo";
import { MAX_EXTERNAL_LINKS_PER_TASK } from "@/lib/tasks/external-links";

setupFakeTimers();

describe("chat claiming loop", () => {
  test("listPendingThreads returns threads with pending user messages", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/repo/path-1", label: "path-1" }],
    });

    const pendingChat = await ctx.cliThread(user._id, project._id, profile._id, {
      pathId: "path-1",
      hasPendingUserMessages: true,
      status: "pending",
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: false,
    });

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const result = await t.query(api.cli.threads.lists.listPendingThreads, {
      profileId: profile._id,
      apiKey: apiKeyResult.key,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?._id).toBe(pendingChat._id);
    expect(result[0]?.workingDirectory).toBe("/repo/path-1");
  });

  test("listPendingThreads returns no threads for a soft-deleted profile", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/repo/path-1", label: "path-1" }],
    });

    await ctx.cliThread(user._id, project._id, profile._id, {
      pathId: "path-1",
      hasPendingUserMessages: true,
      status: "pending",
    });

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliProfiles", profile._id, {
        isDeleted: true,
        deletedAt: Date.now(),
        deletedBy: user._id,
      });
    });

    const result = await t.query(api.cli.threads.lists.listPendingThreads, {
      profileId: profile._id,
      apiKey: apiKeyResult.key,
    });

    expect(result).toEqual([]);
  });

  test("claimThread rejects a container, and the queue never lists one (OS-1556)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });

    // `send` can't put a container in this state, so force it: the guard has
    // to hold on its own, not because the flag happens to be unset.
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", container._id, {
        hasPendingUserMessages: true,
        status: "pending",
        processingState: "idle",
      });
    });

    expect(
      await t.query(api.cli.threads.lists.listPendingThreads, {
        profileId: profile._id,
        apiKey: apiKeyResult.key,
      })
    ).toEqual([]);

    await expect(
      t.mutation(api.cli.threads.runControl.claimThread, {
        threadId: container._id,
        sessionId: session._id,
        leaseMs: 60_000,
        apiKey: apiKeyResult.key,
      })
    ).rejects.toThrow("Groups and workflow runs cannot be processed by a CLI");
  });

  test("claimThread allows one claimant and rejects another until lease expiry", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session1 = await ctx.cliSession(profile._id, apiKeyResult.id, {
      instanceId: "instance-1",
    });
    const session2 = await ctx.cliSession(profile._id, apiKeyResult.id, {
      instanceId: "instance-2",
    });

    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      processingState: "idle",
      status: "pending",
    });

    const claimedBySession1 = await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session1._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });
    const claimedBySession2 = await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session2._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });

    expect(claimedBySession1).toBe(true);
    expect(claimedBySession2).toBe(false);
  });

  test("claimThread allows takeover after lease expiry", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session1 = await ctx.cliSession(profile._id, apiKeyResult.id, {
      instanceId: "instance-1",
    });
    const session2 = await ctx.cliSession(profile._id, apiKeyResult.id, {
      instanceId: "instance-2",
    });

    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      processingState: "idle",
      status: "pending",
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session1._id,
      leaseMs: 1_000,
      apiKey: apiKeyResult.key,
    });

    await vi.advanceTimersByTimeAsync(1_100);

    const claimedBySession2 = await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session2._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });

    expect(claimedBySession2).toBe(true);
  });

  test("isClaimActiveForSession returns false instead of throwing when session is missing", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      status: "pending",
      processingState: "idle",
    });

    await t.run(async (runCtx) => {
      await runCtx.db.delete("cliSessions", session._id);
    });

    const isActive = await t.query(api.cli.threads.runControl.isClaimActiveForSession, {
      threadId: chat._id,
      sessionId: session._id,
      apiKey: apiKeyResult.key,
    });
    expect(isActive).toBe(false);
  });

  test("heartbeatClaim does not require the live session row after claim", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      claimedBySessionId: session._id,
      claimedAt: Date.now(),
      claimLeaseExpiresAt: Date.now() + 60_000,
      processingState: "claimed",
      status: "pending",
    });

    await t.run(async (runCtx) => {
      await runCtx.db.delete("cliSessions", session._id);
    });

    const renewed = await t.mutation(api.cli.threads.runControl.heartbeatClaim, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 120_000,
      apiKey: apiKeyResult.key,
    });

    expect(renewed).toBe(true);
  });

  test("releaseClaim clears claim fields", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      status: "pending",
    });
    const assistantMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        activeAssistantMessageId: assistantMessage._id,
      });
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });

    const released = await t.mutation(api.cli.threads.runControl.releaseClaim, {
      threadId: chat._id,
      sessionId: session._id,
      apiKey: apiKeyResult.key,
    });
    expect(released).toBe(true);

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.claimedBySessionId).toBeUndefined();
      expect(updated?.claimedAt).toBeUndefined();
      expect(updated?.claimLeaseExpiresAt).toBeUndefined();
      expect(updated?.activeAssistantMessageId).toBeUndefined();
      expect(updated?.processingState).toBe("idle");
    });
  });

  test("releaseClaim fails an active streaming assistant response", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: false,
      status: "streaming",
      processingState: "streaming",
    });
    const assistantMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        activeAssistantMessageId: assistantMessage._id,
        claimedBySessionId: session._id,
        claimedAt: Date.now(),
        claimLeaseExpiresAt: Date.now() + 60_000,
      });
      await runCtx.db.insert("cliMessageStreamHeads", {
        messageId: assistantMessage._id,
        nextChunkOrder: 5,
      });
    });

    const released = await t.mutation(api.cli.threads.runControl.releaseClaim, {
      threadId: chat._id,
      sessionId: session._id,
      apiKey: apiKeyResult.key,
    });
    expect(released).toBe(true);

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      const updatedAssistant = await runCtx.db.get("cliMessages", assistantMessage._id);

      expect(updatedAssistant?.status).toBe("failed");
      expect(updatedChat?.status).toBe("failed");
      expect(updatedChat?.processingState).toBe("idle");
      expect(updatedChat?.claimedBySessionId).toBeUndefined();
      expect(updatedChat?.activeAssistantMessageId).toBeUndefined();

      // The lost run's cursor folds back onto the envelope (OS-1729).
      expect(updatedAssistant?.nextChunkOrder).toBe(5);
      expect(await runCtx.db.query("cliMessageStreamHeads").collect()).toEqual([]);
    });
  });

  test("releaseClaim winds a parked run down as waiting_input (OS-1463)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: false,
      status: "streaming",
      processingState: "streaming",
    });
    const assistantMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        activeAssistantMessageId: assistantMessage._id,
        claimedBySessionId: session._id,
        claimedAt: Date.now(),
        claimLeaseExpiresAt: Date.now() + 60_000,
      });
    });

    await t.mutation(api.cli.interactionRequests.create, {
      threadId: chat._id,
      messageId: assistantMessage._id,
      sessionId: session._id,
      requestId: "req-plan",
      kind: "plan-approval",
      payloadJson: JSON.stringify({ toolName: "ExitPlanMode", plan: "# Plan" }),
      expiresAt: Date.now() + 120_000,
      apiKey: apiKeyResult.key,
    });

    const released = await t.mutation(api.cli.threads.runControl.releaseClaim, {
      threadId: chat._id,
      sessionId: session._id,
      apiKey: apiKeyResult.key,
    });
    expect(released).toBe(true);

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      const updatedAssistant = await runCtx.db.get("cliMessages", assistantMessage._id);

      expect(updatedAssistant?.status).toBe("completed");
      expect(updatedAssistant?.errorMessage).toBeUndefined();
      expect(updatedChat?.status).toBe("waiting_input");
      expect(updatedChat?.processingState).toBe("idle");
      expect(updatedChat?.claimedBySessionId).toBeUndefined();
      expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
    });
  });

  test("session disconnect reconcile winds a parked run down as waiting_input (OS-1463)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: false,
      status: "streaming",
      processingState: "streaming",
    });
    const assistantMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        activeAssistantMessageId: assistantMessage._id,
        claimedBySessionId: session._id,
        claimedAt: Date.now(),
        claimLeaseExpiresAt: Date.now() + 60_000,
      });
    });

    await t.mutation(api.cli.interactionRequests.create, {
      threadId: chat._id,
      messageId: assistantMessage._id,
      sessionId: session._id,
      requestId: "req-question",
      kind: "question",
      payloadJson: JSON.stringify({ toolName: "AskUserQuestion", questions: [] }),
      expiresAt: Date.now() + 120_000,
      apiKey: apiKeyResult.key,
    });

    await t.mutation(internal.cli.threads.runControl.reconcileClaimsForSessionDisconnect, {
      sessionId: session._id,
      reason: "CLI disconnected during response generation",
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      const updatedAssistant = await runCtx.db.get("cliMessages", assistantMessage._id);

      expect(updatedAssistant?.status).toBe("completed");
      expect(updatedAssistant?.errorMessage).toBeUndefined();
      expect(updatedChat?.status).toBe("waiting_input");
      expect(updatedChat?.processingState).toBe("idle");
      expect(updatedChat?.claimedBySessionId).toBeUndefined();
    });
  });
});

describe("reportExecutionBranch (OS-1247)", () => {
  async function setupClaimedThread(threadOverrides: Record<string, unknown> = {}) {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [
        {
          id: "repo-path",
          path: "/home/user/project",
          label: "project",
        },
        {
          id: "worktree-path",
          path: "/home/user/project-worktrees/feat-path",
          label: "feat/path",
          kind: "worktree",
          parentPathId: "repo-path",
          branch: "feat/path",
        },
      ],
    });

    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      pathId: "repo-path",
      path: "/home/user/project",
      hasPendingUserMessages: true,
      processingState: "idle",
      status: "pending",
      ...threadOverrides,
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });

    return { ctx, asUser, t, chat, session, apiKey: apiKeyResult.key, apiKeyId: apiKeyResult.id, profile };
  }

  test("persists the execution branch for local threads and exposes it as the canonical branch field", async () => {
    const { asUser, t, chat, session, apiKey } = await setupClaimedThread();

    await t.mutation(api.cli.threads.runControl.reportExecutionBranch, {
      threadId: chat._id,
      sessionId: session._id,
      branch: "feat/local",
      apiKey,
    });

    const result = await asUser.query(api.cli.threads.core.get, { threadId: chat._id });
    expect(result?.branch).toBe("feat/local");
  });

  test("execution snapshot wins over the live worktree path entry branch", async () => {
    const { asUser, t, chat, session, apiKey } = await setupClaimedThread({
      pathId: "worktree-path",
      path: "/home/user/project-worktrees/feat-path",
    });

    await t.mutation(api.cli.threads.runControl.reportExecutionBranch, {
      threadId: chat._id,
      sessionId: session._id,
      branch: "feat/actual",
      apiKey,
    });

    const result = await asUser.query(api.cli.threads.core.get, { threadId: chat._id });
    expect(result?.branch).toBe("feat/actual");
  });

  test("clears the snapshot when no branch is reported (detached HEAD / non-git)", async () => {
    const { asUser, t, chat, session, apiKey } = await setupClaimedThread();

    await t.mutation(api.cli.threads.runControl.reportExecutionBranch, {
      threadId: chat._id,
      sessionId: session._id,
      branch: "feat/old",
      apiKey,
    });
    await t.mutation(api.cli.threads.runControl.reportExecutionBranch, {
      threadId: chat._id,
      sessionId: session._id,
      apiKey,
    });

    const result = await asUser.query(api.cli.threads.core.get, { threadId: chat._id });
    expect(result?.branch).toBeUndefined();
  });

  test("normalizes whitespace-only branch names to an absent snapshot", async () => {
    const { asUser, t, chat, session, apiKey } = await setupClaimedThread();

    await t.mutation(api.cli.threads.runControl.reportExecutionBranch, {
      threadId: chat._id,
      sessionId: session._id,
      branch: "   ",
      apiKey,
    });

    const result = await asUser.query(api.cli.threads.core.get, { threadId: chat._id });
    expect(result?.branch).toBeUndefined();
  });

  test("ignores reports from a session that does not hold the claim", async () => {
    const { ctx, asUser, t, chat, session, apiKey, apiKeyId } = await setupClaimedThread();

    await t.mutation(api.cli.threads.runControl.reportExecutionBranch, {
      threadId: chat._id,
      sessionId: session._id,
      branch: "feat/claimed",
      apiKey,
    });

    const otherSession = await ctx.cliSession(chat.profileId, apiKeyId, {
      instanceId: "instance-other",
    });
    await t.mutation(api.cli.threads.runControl.reportExecutionBranch, {
      threadId: chat._id,
      sessionId: otherSession._id,
      branch: "feat/hijacked",
      apiKey,
    });

    const result = await asUser.query(api.cli.threads.core.get, { threadId: chat._id });
    expect(result?.branch).toBe("feat/claimed");
  });
});

describe("reportPullRequest (OS-1370)", () => {
  const snapshot = {
    provider: "github" as const,
    number: 123,
    title: "Add PR badge",
    url: "https://github.com/acme/repo/pull/123",
    state: "open" as const,
    headBranch: "feat/pr-badge",
    baseBranch: "main",
    capturedAt: 1_700_000_000_000,
  };

  /** `setupClaimedThread` with a guaranteed non-null associated task. */
  async function setupClaimedThreadWithTask() {
    const setup = await setupClaimedThread({ withTask: true });
    if (!setup.task) throw new Error("expected an associated task");
    return { ...setup, task: setup.task };
  }

  async function setupClaimedThread(options: { withTask?: boolean } = {}) {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    const task = options.withTask ? await ctx.task(project._id, user._id) : null;
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      processingState: "idle",
      status: "pending",
      ...(task ? { associatedTaskId: task._id } : {}),
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });

    return { ctx, asUser, t, chat, task, session, apiKey: apiKeyResult.key, apiKeyId: apiKeyResult.id };
  }

  test("stores the snapshot and exposes it on thread list items", async () => {
    const { asUser, t, chat, session, apiKey } = await setupClaimedThread();

    await t.mutation(api.cli.threads.runControl.reportPullRequest, {
      threadId: chat._id,
      sessionId: session._id,
      pullRequest: snapshot,
      apiKey,
    });

    const result = await asUser.query(api.cli.threads.core.get, { threadId: chat._id });
    expect(result?.pullRequest).toEqual(snapshot);
  });

  test("clears the snapshot when a successful lookup finds no PR", async () => {
    const { asUser, t, chat, session, apiKey } = await setupClaimedThread();

    await t.mutation(api.cli.threads.runControl.reportPullRequest, {
      threadId: chat._id,
      sessionId: session._id,
      pullRequest: snapshot,
      apiKey,
    });
    await t.mutation(api.cli.threads.runControl.reportPullRequest, {
      threadId: chat._id,
      sessionId: session._id,
      apiKey,
    });

    const result = await asUser.query(api.cli.threads.core.get, { threadId: chat._id });
    expect(result?.pullRequest).toBeUndefined();
  });

  test("ignores reports from a session that does not hold the claim", async () => {
    const { ctx, asUser, t, chat, session, apiKey, apiKeyId } = await setupClaimedThread();

    await t.mutation(api.cli.threads.runControl.reportPullRequest, {
      threadId: chat._id,
      sessionId: session._id,
      pullRequest: snapshot,
      apiKey,
    });

    const otherSession = await ctx.cliSession(chat.profileId, apiKeyId, {
      instanceId: "instance-other",
    });
    await t.mutation(api.cli.threads.runControl.reportPullRequest, {
      threadId: chat._id,
      sessionId: otherSession._id,
      pullRequest: { ...snapshot, state: "merged", number: 999 },
      apiKey,
    });

    const result = await asUser.query(api.cli.threads.core.get, { threadId: chat._id });
    expect(result?.pullRequest).toEqual(snapshot);
  });

  test("rejects reports for a thread on another profile", async () => {
    const { ctx, t, chat, apiKey, apiKeyId } = await setupClaimedThread();

    const otherProfile = await ctx.cliProfile(chat.userId, chat.projectId, {
      name: "Other profile",
    });
    const otherSession = await ctx.cliSession(otherProfile._id, apiKeyId, {
      instanceId: "instance-cross-profile",
    });

    await expect(
      t.mutation(api.cli.threads.runControl.reportPullRequest, {
        threadId: chat._id,
        sessionId: otherSession._id,
        pullRequest: snapshot,
        apiKey,
      })
    ).rejects.toThrow();
  });

  describe("task external link mirroring (OS-1455)", () => {
    async function readTaskState(
      t: Awaited<ReturnType<typeof setupClaimedThread>>["t"],
      taskId: Id<"tasks">
    ) {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      return t.run(async (runCtx) => {
        const task = await runCtx.db.get("tasks", taskId);
        const logs = await runCtx.db
          .query("taskActivityLogs")
          .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", taskId))
          .collect();
        return {
          links: task?.externalLinks ?? [],
          linkLogs: logs.filter((log) => log.eventType === "external_link_changed"),
        };
      });
    }

    test("upserts a pull_request link on the associated task and logs it once", async () => {
      const { t, chat, task, session, apiKey } = await setupClaimedThreadWithTask();

      await t.mutation(api.cli.threads.runControl.reportPullRequest, {
        threadId: chat._id,
        sessionId: session._id,
        pullRequest: snapshot,
        apiKey,
      });

      const first = await readTaskState(t, task._id);
      expect(first.links).toHaveLength(1);
      expect(first.links[0]).toMatchObject({
        id: "pr:github:123",
        kind: "pull_request",
        url: snapshot.url,
        title: snapshot.title,
        identifier: "PR #123",
        branch: "feat/pr-badge",
      });
      expect(first.linkLogs).toHaveLength(1);
      expect(first.linkLogs[0].changeDetails).toMatchObject({ op: "added", linkId: "pr:github:123" });

      // The refresh sweep re-reports the same PR: no churn, no extra rows.
      await t.mutation(api.cli.threads.runControl.reportPullRequest, {
        threadId: chat._id,
        sessionId: session._id,
        pullRequest: { ...snapshot, capturedAt: snapshot.capturedAt + 60_000 },
        apiKey,
      });

      const repeated = await readTaskState(t, task._id);
      expect(repeated.links).toEqual(first.links);
      expect(repeated.linkLogs).toHaveLength(1);

      await t.mutation(api.cli.threads.runControl.reportPullRequest, {
        threadId: chat._id,
        sessionId: session._id,
        pullRequest: { ...snapshot, title: "Add PR badge v2" },
        apiKey,
      });

      const updated = await readTaskState(t, task._id);
      expect(updated.links).toHaveLength(1);
      expect(updated.linkLogs).toHaveLength(2);
      expect(updated.linkLogs[1].changeDetails).toMatchObject({ op: "updated", label: "Add PR badge v2" });
    });

    test("a cleared snapshot leaves the task link in place", async () => {
      const { t, chat, task, session, apiKey } = await setupClaimedThreadWithTask();

      await t.mutation(api.cli.threads.runControl.reportPullRequest, {
        threadId: chat._id,
        sessionId: session._id,
        pullRequest: snapshot,
        apiKey,
      });
      await t.mutation(api.cli.threads.runControl.reportPullRequest, {
        threadId: chat._id,
        sessionId: session._id,
        apiKey,
      });

      const after = await readTaskState(t, task._id);
      expect(after.links).toHaveLength(1);
      expect(after.linkLogs).toHaveLength(1);
    });

    test("a task at the link cap does not fail the report", async () => {
      const { asUser, t, chat, task, session, apiKey } = await setupClaimedThreadWithTask();

      for (let i = 0; i < MAX_EXTERNAL_LINKS_PER_TASK; i++) {
        await asUser.mutation(api.tasks.core.updateExternalLink, {
          taskId: task._id,
          op: "upsert",
          id: `url-${i}`,
          link: { kind: "url", url: `https://example.com/${i}` },
        });
      }
      const before = await readTaskState(t, task._id);

      await t.mutation(api.cli.threads.runControl.reportPullRequest, {
        threadId: chat._id,
        sessionId: session._id,
        pullRequest: snapshot,
        apiKey,
      });

      // The report itself succeeds; the capped link write drops on its own.
      const after = await readTaskState(t, task._id);
      expect(after.links).toEqual(before.links);
      expect(after.linkLogs).toHaveLength(before.linkLogs.length);
    });
  });
});

describe("streamingWatchdogTick", () => {
  test("keeps a run alive on a legacy session that has not heartbeated since the deploy (OS-2549)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    // Pre-deploy shape: fresh legacy timestamp, no stored state, no heartbeat row.
    const session = await ctx.cliSession(profile._id, apiKeyResult.id, { isOnline: undefined, lastHeartbeatAt: Date.now() });
    const chat = await ctx.cliThread(user._id, project._id, profile._id, { hasPendingUserMessages: true, status: "pending" });
    const userMessage = await ctx.cliMessage(chat._id, profile._id, { role: "user" });
    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });
    const started = await t.mutation(api.cli.messages.startRunResponse, {
      threadId: chat._id,
      sessionId: session._id,
      userMessageIds: [userMessage._id],
      apiKey: apiKeyResult.key,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await t.mutation(internal.cli.threads.runControl.streamingWatchdogTick, {
      threadId: chat._id,
      intervalMs: 120_000,
      messageId: started.assistantMessageId,
    });

    const assistant = await t.run((runCtx) => runCtx.db.get("cliMessages", started.assistantMessageId));
    expect(assistant?.status).toBe("streaming");
  });

  test("reschedules watchdog when session is still online", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      status: "pending",
    });
    const userMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });

    const started = await t.mutation(api.cli.messages.startRunResponse, {
      threadId: chat._id,
      sessionId: session._id,
      userMessageIds: [userMessage._id],
      apiKey: apiKeyResult.key,
    });

    let initialWatchdogId: Id<"_scheduled_functions"> | undefined;
    let lastActivityBeforeTick: number | undefined;
    await t.run(async (runCtx) => {
      const currentChat = await runCtx.db.get("cliThreads", chat._id);
      initialWatchdogId = currentChat?.streamWatchdogId;
      lastActivityBeforeTick = currentChat?.lastActivityAt;
      expect(initialWatchdogId).toBeDefined();
    });

    await vi.advanceTimersByTimeAsync(10_000);

    await t.mutation(internal.cli.threads.runControl.streamingWatchdogTick, {
      threadId: chat._id,
      intervalMs: 120_000,
      messageId: started.assistantMessageId,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      const assistant = await runCtx.db.get("cliMessages", started.assistantMessageId);

      // A healthy tick must not touch the thread doc: appendRunContent
      // reads it on every chunk batch, and that collision is what retried.
      expect(updatedChat?.streamWatchdogId).toBe(initialWatchdogId);
      expect(updatedChat?.status).toBe("streaming");
      expect(updatedChat?.processingState).toBe("streaming");
      expect(updatedChat?.lastActivityAt).toBe(lastActivityBeforeTick);
      expect(assistant?.status).toBe("streaming");
    });
  });

  test("ignores a tick from a superseded run", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      status: "pending",
    });
    const userMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });

    const started = await t.mutation(api.cli.messages.startRunResponse, {
      threadId: chat._id,
      sessionId: session._id,
      userMessageIds: [userMessage._id],
      apiKey: apiKeyResult.key,
    });

    // Stale chain from an earlier run: the session is offline, but this tick
    // no longer owns the thread, so it must not fail the live run.
    await t.run(async (runCtx) => {
      for (const heartbeat of await runCtx.db.query("cliSessionHeartbeats").collect()) {
        await runCtx.db.patch("cliSessionHeartbeats", heartbeat._id, { lastHeartbeatAt: 0 });
      }
    });

    const staleMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
    });

    await t.mutation(internal.cli.threads.runControl.streamingWatchdogTick, {
      threadId: chat._id,
      intervalMs: 120_000,
      messageId: staleMessage._id,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      const assistant = await runCtx.db.get("cliMessages", started.assistantMessageId);

      expect(updatedChat?.processingState).toBe("streaming");
      expect(assistant?.status).toBe("streaming");
    });
  });

  test("fails streaming chat when claimed session is missing", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      status: "pending",
    });
    const userMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });

    const started = await t.mutation(api.cli.messages.startRunResponse, {
      threadId: chat._id,
      sessionId: session._id,
      userMessageIds: [userMessage._id],
      apiKey: apiKeyResult.key,
    });

    await t.run(async (runCtx) => {
      await deleteSession(runCtx, session._id);
    });

    await t.mutation(internal.cli.threads.runControl.streamingWatchdogTick, {
      threadId: chat._id,
      intervalMs: 120_000,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      const assistant = await runCtx.db.get("cliMessages", started.assistantMessageId);

      expect(assistant?.status).toBe("failed");
      expect(assistant?.errorMessage).toBe(
        "CLI disconnected during response generation"
      );
      expect(updatedChat?.status).toBe("failed");
      expect(updatedChat?.processingState).toBe("idle");
      expect(updatedChat?.claimedBySessionId).toBeUndefined();
      expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
      expect(updatedChat?.streamWatchdogId).toBeUndefined();
    });
  });

  test("fails streaming chat when claim lease expires even if session is online", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      status: "pending",
    });
    const userMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 1_000,
      apiKey: apiKeyResult.key,
    });

    const started = await t.mutation(api.cli.messages.startRunResponse, {
      threadId: chat._id,
      sessionId: session._id,
      userMessageIds: [userMessage._id],
      apiKey: apiKeyResult.key,
    });

    await vi.advanceTimersByTimeAsync(1_100);

    await t.mutation(internal.cli.threads.runControl.streamingWatchdogTick, {
      threadId: chat._id,
      intervalMs: 120_000,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      const assistant = await runCtx.db.get("cliMessages", started.assistantMessageId);

      expect(assistant?.status).toBe("failed");
      expect(updatedChat?.status).toBe("failed");
      expect(updatedChat?.processingState).toBe("idle");
      expect(updatedChat?.claimedBySessionId).toBeUndefined();
      expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
      expect(updatedChat?.streamWatchdogId).toBeUndefined();
    });
  });

  test("winds down as waiting_input when the run is parked on an interaction request", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      status: "pending",
    });
    const userMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 1_000,
      apiKey: apiKeyResult.key,
    });

    const started = await t.mutation(api.cli.messages.startRunResponse, {
      threadId: chat._id,
      sessionId: session._id,
      userMessageIds: [userMessage._id],
      apiKey: apiKeyResult.key,
    });

    // The run parks on a plan approval, then the CLI goes away (lease expires).
    await t.mutation(api.cli.interactionRequests.create, {
      threadId: chat._id,
      messageId: started.assistantMessageId,
      sessionId: session._id,
      requestId: "req-plan",
      kind: "plan-approval",
      payloadJson: JSON.stringify({ toolName: "ExitPlanMode", plan: "# Plan" }),
      expiresAt: Date.now() + 120_000,
      apiKey: apiKeyResult.key,
    });

    await vi.advanceTimersByTimeAsync(1_100);

    await t.mutation(internal.cli.threads.runControl.streamingWatchdogTick, {
      threadId: chat._id,
      intervalMs: 120_000,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      const assistant = await runCtx.db.get("cliMessages", started.assistantMessageId);

      // Parked on the user is the user's turn, not an error (OS-1463).
      expect(assistant?.status).toBe("completed");
      expect(assistant?.errorMessage).toBeUndefined();
      expect(updatedChat?.status).toBe("waiting_input");
      expect(updatedChat?.processingState).toBe("idle");
      expect(updatedChat?.claimedBySessionId).toBeUndefined();
      expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
      expect(updatedChat?.hasPendingInteraction).toBe(false);

      const requests = await runCtx.db.query("cliInteractionRequests").collect();
      expect(requests).toHaveLength(1);
      expect(requests[0]?.status).toBe("cancelled");
    });
  });

  test("queued user messages take precedence over a parked wind-down", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });

    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      status: "pending",
    });
    const userMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
    });

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 1_000,
      apiKey: apiKeyResult.key,
    });

    const started = await t.mutation(api.cli.messages.startRunResponse, {
      threadId: chat._id,
      sessionId: session._id,
      userMessageIds: [userMessage._id],
      apiKey: apiKeyResult.key,
    });

    await t.mutation(api.cli.interactionRequests.create, {
      threadId: chat._id,
      messageId: started.assistantMessageId,
      sessionId: session._id,
      requestId: "req-plan",
      kind: "plan-approval",
      payloadJson: JSON.stringify({ toolName: "ExitPlanMode", plan: "# Plan" }),
      expiresAt: Date.now() + 120_000,
      apiKey: apiKeyResult.key,
    });

    // A user message arrived behind the parked run.
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        hasPendingUserMessages: true,
      });
    });

    await vi.advanceTimersByTimeAsync(1_100);

    await t.mutation(internal.cli.threads.runControl.streamingWatchdogTick, {
      threadId: chat._id,
      intervalMs: 120_000,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      expect(updatedChat?.status).toBe("pending");
      expect(updatedChat?.hasPendingUserMessages).toBe(true);
    });
  });

  test("clears watchdog when chat is not streaming", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      status: "pending",
    });
    const userMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
    });

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });

    await t.mutation(api.cli.messages.startRunResponse, {
      threadId: chat._id,
      sessionId: session._id,
      userMessageIds: [userMessage._id],
      apiKey: apiKeyResult.key,
    });

    let lastActivityBeforeTick: number | undefined;
    await t.run(async (runCtx) => {
      const currentChat = await runCtx.db.get("cliThreads", chat._id);
      lastActivityBeforeTick = currentChat?.lastActivityAt;
      await runCtx.db.patch("cliThreads", chat._id, {
        status: "pending",
        processingState: "idle",
        activeAssistantMessageId: undefined,
      });
    });

    await vi.advanceTimersByTimeAsync(10_000);

    await t.mutation(internal.cli.threads.runControl.streamingWatchdogTick, {
      threadId: chat._id,
      intervalMs: 120_000,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      expect(updatedChat?.status).toBe("pending");
      expect(updatedChat?.streamWatchdogId).toBeUndefined();
      expect(updatedChat?.lastActivityAt).toBe(lastActivityBeforeTick);
    });
  });
});

describe("cancelProcessing", () => {
  test("is a no-op when thread is idle with no pending work", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "waiting_input",
      processingState: "idle",
      hasPendingUserMessages: false,
    });

    const before = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });

    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: chat._id,
    });

    await t.run(async (runCtx) => {
      const after = await runCtx.db.get("cliThreads", chat._id);
      expect(after?.status).toBe(before?.status);
      expect(after?.processingState).toBe(before?.processingState);
      expect(after?.hasPendingUserMessages).toBe(before?.hasPendingUserMessages);
      expect(after?.activeAssistantMessageId).toBe(before?.activeAssistantMessageId);
      expect(after?.claimedBySessionId).toBe(before?.claimedBySessionId);
    });
  });

  test("fails the sent run in place on a stop with no active run (OS-1459)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "pending",
      processingState: "idle",
      hasPendingUserMessages: true,
    });

    const userMessageA = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
      status: "completed",
      processedAt: undefined,
      processedBySessionId: undefined,
      runId: undefined,
    });
    const userMessageB = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
      status: "completed",
      processedAt: undefined,
      processedBySessionId: undefined,
      runId: undefined,
    });

    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: chat._id,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      // The run was sent (waiting for CLI pickup), so the stop fails the
      // turn in place — no held queue, nothing re-queued (OS-1459).
      expect(updatedChat?.status).toBe("failed");
      expect(updatedChat?.processingState).toBe("idle");
      expect(updatedChat?.hasPendingUserMessages).toBe(false);
      expect(updatedChat?.queueHeldAt).toBeUndefined();
      expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
      expect(updatedChat?.claimedBySessionId).toBeUndefined();

      // Messages are stamped into one run behind a synthetic failed
      // assistant, keeping the turn retryable.
      const messageA = await runCtx.db.get("cliMessages", userMessageA._id);
      const messageB = await runCtx.db.get("cliMessages", userMessageB._id);
      expect(messageA?.processedAt).toBeDefined();
      expect(messageB?.processedAt).toBeDefined();
      expect(messageA?.runId).toBeDefined();
      expect(messageB?.runId).toBe(messageA?.runId);

      const assistantMessages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", chat._id))
        .collect()
        .then((messages) => messages.filter((message) => message.role === "assistant"));
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].status).toBe("failed");
      expect(assistantMessages[0].errorMessage).toBe("Response stopped by user");
      expect(assistantMessages[0].runId).toBe(messageA?.runId);
    });
  });

  test("retry after a no-run stop requeues the stopped run (OS-1459)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "pending",
      processingState: "idle",
      hasPendingUserMessages: true,
    });
    const userMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
      status: "completed",
      processedAt: undefined,
      processedBySessionId: undefined,
      runId: undefined,
    });

    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: chat._id,
    });

    const failedAssistant = await t.run(async (runCtx) => {
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", chat._id))
        .collect();
      return messages.find((message) => message.role === "assistant");
    });
    expect(failedAssistant).toBeDefined();

    await asUser.mutation(api.cli.messages.retry, {
      messageId: failedAssistant!._id,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      expect(updatedChat?.status).toBe("pending");
      expect(updatedChat?.hasPendingUserMessages).toBe(true);
      expect(updatedChat?.queueHeldAt).toBeUndefined();

      // Synthetic assistant removed, user message back in the queue.
      const message = await runCtx.db.get("cliMessages", userMessage._id);
      expect(message?.processedAt).toBeUndefined();
      expect(message?.runId).toBeUndefined();
      expect(await runCtx.db.get("cliMessages", failedAssistant!._id)).toBeNull();
    });
  });

  test("held threads are excluded from CLI pickup until the next send", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "pending",
      processingState: "idle",
      hasPendingUserMessages: true,
    });
    await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
      status: "completed",
      processedAt: undefined,
      processedBySessionId: undefined,
      runId: undefined,
    });

    // Held state as an active-run stop leaves it (OS-1374); a no-run stop
    // no longer holds (OS-1459).
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, { queueHeldAt: Date.now() });
    });

    const pendingWhileHeld = await t.query(api.cli.threads.lists.listPendingThreads, {
      profileId: profile._id,
      apiKey: apiKeyResult.key,
    });
    expect(pendingWhileHeld).toHaveLength(0);

    const claimed = await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });
    expect(claimed).toBe(false);

    // A new send is the "go" signal: hold clears, thread is claimable again.
    await asUser.mutation(api.cli.messages.send, {
      threadId: chat._id,
      content: "resume with this",
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      expect(updatedChat?.queueHeldAt).toBeUndefined();
      expect(updatedChat?.hasPendingUserMessages).toBe(true);
    });

    const pendingAfterSend = await t.query(api.cli.threads.lists.listPendingThreads, {
      profileId: profile._id,
      apiKey: apiKeyResult.key,
    });
    expect(pendingAfterSend).toHaveLength(1);
  });

  test("cancels an active streaming run and holds the surviving queue", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      processingState: "streaming",
      hasPendingUserMessages: true,
      claimedBySessionId: session._id,
      claimedAt: Date.now(),
      claimLeaseExpiresAt: Date.now() + 60_000,
    });

    const activeAssistant = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
      runId: "run-active",
      claimedBySessionId: session._id,
      claimedAt: Date.now(),
      content: [],
    });
    await ctx.cliMessageChunks(activeAssistant._id, chat._id, profile._id, [
      {
        type: "assistant",
        data: JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Cancelled text" }],
          },
        }),
        timestamp: 1000,
      },
    ]);

    const queuedUser = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
      status: "completed",
      processedAt: undefined,
      processedBySessionId: undefined,
      runId: undefined,
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        activeAssistantMessageId: activeAssistant._id,
      });
    });

    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: chat._id,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      const updatedAssistant = await runCtx.db.get("cliMessages", activeAssistant._id);
      const updatedQueuedUser = await runCtx.db.get("cliMessages", queuedUser._id);

      expect(updatedAssistant?.status).toBe("failed");
      expect(updatedAssistant?.errorMessage).toBe("Response stopped by user");
      expect(updatedAssistant?.claimedBySessionId).toBeUndefined();
      expect(updatedAssistant?.claimedAt).toBeUndefined();
      expect(updatedAssistant?.runId).toBe("run-active");

      // The queued message survives the stop, unprocessed and held.
      expect(updatedQueuedUser?.processedAt).toBeUndefined();
      expect(updatedQueuedUser?.runId).toBeUndefined();

      expect(updatedChat?.status).toBe("failed");
      expect(updatedChat?.processingState).toBe("idle");
      expect(updatedChat?.hasPendingUserMessages).toBe(true);
      expect(updatedChat?.queueHeldAt).toBeDefined();
      expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
      expect(updatedChat?.claimedBySessionId).toBeUndefined();
      expect(updatedChat?.claimLeaseExpiresAt).toBeUndefined();
    });
  });

  test("a stop folds the streaming cursor back onto the assistant (OS-1729)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      processingState: "streaming",
      hasPendingUserMessages: false,
    });
    const activeAssistant = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
      runId: "run-stopped",
      nextChunkOrder: 0,
      content: [],
    });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        activeAssistantMessageId: activeAssistant._id,
      });
      await runCtx.db.insert("cliMessageStreamHeads", {
        messageId: activeAssistant._id,
        nextChunkOrder: 4,
      });
    });

    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: chat._id,
    });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliMessages", activeAssistant._id))?.nextChunkOrder).toBe(4);
      expect(await runCtx.db.query("cliMessageStreamHeads").collect()).toEqual([]);
    });
  });

  test("a superseded stop ends the parked run as completed (OS-1461)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      processingState: "streaming",
      hasPendingUserMessages: false,
    });
    const activeAssistant = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
      runId: "run-plan",
      content: [],
    });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        activeAssistantMessageId: activeAssistant._id,
      });
    });

    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: chat._id,
      superseded: true,
    });

    await t.run(async (runCtx) => {
      const updatedAssistant = await runCtx.db.get("cliMessages", activeAssistant._id);
      // Sending while parked is not a stop: the turn keeps its plan output
      // and reads as finished, with no error footer.
      expect(updatedAssistant?.status).toBe("completed");
      expect(updatedAssistant?.errorMessage).toBeUndefined();

      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      expect(updatedChat?.status).toBe("completed");
      expect(updatedChat?.processingState).toBe("idle");
      expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
    });
  });

  /**
   * A run parked on a prompt with an active claim — the state Stop is
   * pressed in when the composer is empty and a plan gate is open.
   */
  async function setupParkedRun() {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      processingState: "streaming",
      hasPendingUserMessages: false,
    });
    const activeAssistant = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
      runId: "run-plan",
      content: [],
    });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        activeAssistantMessageId: activeAssistant._id,
        claimedBySessionId: session._id,
        claimedAt: Date.now(),
        claimLeaseExpiresAt: Date.now() + 60_000,
      });
    });

    await t.mutation(api.cli.interactionRequests.create, {
      threadId: chat._id,
      messageId: activeAssistant._id,
      sessionId: session._id,
      requestId: "req-plan",
      kind: "plan-approval",
      payloadJson: JSON.stringify({ toolName: "ExitPlanMode", plan: "# Plan" }),
      expiresAt: Date.now() + 120_000,
      apiKey: apiKeyResult.key,
    });

    return { ctx, asUser, t, profile, chat, activeAssistant, session };
  }

  /**
   * `emitEvent` schedules the bus ingest, so the row only exists once the
   * scheduler has run — reading the table without draining first passes for
   * any expectation. The TTL janitor is 7 days out, so it stays put.
   */
  async function readThreadEvents(t: Awaited<ReturnType<typeof setupParkedRun>>["t"]) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
    return t.run(async (runCtx) => runCtx.db.query("events").collect());
  }

  test("a stop while parked hands the turn back instead of failing it (OS-1463)", async () => {
    const { asUser, t, chat, activeAssistant } = await setupParkedRun();

    // Stop pressed with an empty composer while the plan gate was open: the
    // run was the user's turn, not work in flight, so taking it back is not
    // a failure — the same rule every other wind-down already applies.
    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: chat._id,
    });

    await t.run(async (runCtx) => {
      const updatedAssistant = await runCtx.db.get("cliMessages", activeAssistant._id);
      expect(updatedAssistant?.status).toBe("completed");
      expect(updatedAssistant?.errorMessage).toBeUndefined();

      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      expect(updatedChat?.status).toBe("waiting_input");
      expect(updatedChat?.statusProjection?.watchTowerStatus).toBe("waiting_input");
      expect(updatedChat?.processingState).toBe("idle");
      expect(updatedChat?.hasPendingInteraction).toBe(false);
      expect(updatedChat?.queueHeldAt).toBeUndefined();
    });

    const events = await readThreadEvents(t);
    expect(events.some((event) => event.type === "thread.failed")).toBe(false);
  });

  test("a second stop after a parked stop is a no-op (OS-1463)", async () => {
    const { asUser, t, chat } = await setupParkedRun();

    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: chat._id,
    });
    // The parked landing state is idle with nothing unprocessed and no hold,
    // so a stale tab's second stop must not recompute it into a failure.
    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: chat._id,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      expect(updatedChat?.status).toBe("waiting_input");
      expect(updatedChat?.queueHeldAt).toBeUndefined();
    });

    const events = await readThreadEvents(t);
    expect(events.some((event) => event.type === "thread.failed")).toBe(false);
  });

  test("a stop while parked with queued work behind it still fails the turn", async () => {
    const { ctx, asUser, t, profile, chat, activeAssistant } = await setupParkedRun();
    const queued = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
      status: "completed",
      processedAt: undefined,
      processedBySessionId: undefined,
      runId: undefined,
    });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        hasPendingUserMessages: true,
      });
    });

    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: chat._id,
    });

    // Work was queued behind the stop, so the turn did not simply hand back
    // to the user: it stays a stopped run with a held, retryable queue.
    await t.run(async (runCtx) => {
      const updatedAssistant = await runCtx.db.get("cliMessages", activeAssistant._id);
      expect(updatedAssistant?.status).toBe("failed");
      expect(updatedAssistant?.errorMessage).toBe("Response stopped by user");

      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      expect(updatedChat?.status).toBe("failed");
      expect(updatedChat?.queueHeldAt).toBeDefined();
      // The parking prompt still goes away with the run it belonged to.
      expect(updatedChat?.hasPendingInteraction).toBe(false);

      const heldMessage = await runCtx.db.get("cliMessages", queued._id);
      expect(heldMessage?.processedAt).toBeUndefined();
    });

    const events = await readThreadEvents(t);
    expect(events.some((event) => event.type === "thread.failed")).toBe(true);
  });

  test("a second stop on a stopped, held thread is a no-op", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    // Post-stop state of an active-run stop: failed thread with a held
    // surviving queue.
    const heldAt = Date.now() - 5_000;
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      processingState: "idle",
      hasPendingUserMessages: true,
      queueHeldAt: heldAt,
    });
    await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
      status: "completed",
      processedAt: undefined,
      processedBySessionId: undefined,
      runId: undefined,
    });

    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: chat._id,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      // Not resurrected to pending, hold not re-stamped.
      expect(updatedChat?.status).toBe("failed");
      expect(updatedChat?.queueHeldAt).toBe(heldAt);
    });
  });
});

describe("releaseQueueHold", () => {
  test("releases a held queue for CLI pickup without a new send", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "pending",
      processingState: "idle",
      hasPendingUserMessages: true,
    });
    await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
      status: "completed",
      processedAt: undefined,
      processedBySessionId: undefined,
      runId: undefined,
    });
    // Held state as an active-run stop leaves it (OS-1374); a no-run stop
    // no longer holds (OS-1459).
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, { queueHeldAt: Date.now() });
    });

    const pendingWhileHeld = await t.query(api.cli.threads.lists.listPendingThreads, {
      profileId: profile._id,
      apiKey: apiKeyResult.key,
    });
    expect(pendingWhileHeld).toHaveLength(0);

    await asUser.mutation(api.cli.threads.runControl.releaseQueueHold, {
      threadId: chat._id,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      expect(updatedChat?.queueHeldAt).toBeUndefined();
      expect(updatedChat?.status).toBe("pending");
      expect(updatedChat?.hasPendingUserMessages).toBe(true);
      expect(updatedChat?.statusProjection?.watchTowerStatus).toBe("running");
    });

    const pendingAfterRelease = await t.query(api.cli.threads.lists.listPendingThreads, {
      profileId: profile._id,
      apiKey: apiKeyResult.key,
    });
    expect(pendingAfterRelease).toHaveLength(1);
  });

  test("is a no-op when the queue is not held", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      processingState: "idle",
      hasPendingUserMessages: false,
    });

    await asUser.mutation(api.cli.threads.runControl.releaseQueueHold, {
      threadId: chat._id,
    });

    await t.run(async (runCtx) => {
      const updatedChat = await runCtx.db.get("cliThreads", chat._id);
      expect(updatedChat?.status).toBe("completed");
      expect(updatedChat?.hasPendingUserMessages).toBe(false);
    });
  });
});

describe("project permission checks on CLI worker mutations", () => {
  test("claimThread rejects when the API key scope no longer covers the thread project", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, {
      name: "Other",
      alias: "OTHR",
    });
    const profile = await ctx.cliProfile(user._id, project._id);
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "Scoped CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: {
        organizationId: org._id,
        projectIds: [project._id],
      },
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      processingState: "idle",
      status: "pending",
    });
    await asUser.mutation(api.apiKeys.core.update, {
      id: apiKeyResult.id,
      name: "Scoped CLI Key",
      scope: {
        organizationId: org._id,
        projectIds: [otherProject._id],
      },
    });

    await expect(
      t.mutation(api.cli.threads.runControl.claimThread, {
        threadId: thread._id,
        sessionId: session._id,
        leaseMs: 60_000,
        apiKey: apiKeyResult.key,
      })
    ).rejects.toThrow("Permission denied");
  });

  test("claimThread rejects user without project access", async () => {
    const ctx = createTestContext();
    const { org, project } = await ctx.setupProject();

    // Create a second user with org membership but NO project membership
    const user2 = await ctx.user();
    await ctx.orgMember(org._id, user2._id, "member");
    const asUser2 = ctx.asUser(user2);

    // Create profile, session, and thread for user2 via builders (bypasses permission)
    const profile2 = await ctx.cliProfile(user2._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user2/project", label: "project" }],
    });
    const apiKeyResult = await asUser2.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session2 = await ctx.cliSession(profile2._id, apiKeyResult.id);
    const thread = await ctx.cliThread(user2._id, project._id, profile2._id, {
      hasPendingUserMessages: true,
      processingState: "idle",
      status: "pending",
    });

    await expect(
      asUser2.mutation(api.cli.threads.runControl.claimThread, {
        threadId: thread._id,
        sessionId: session2._id,
        leaseMs: 60_000,
      })
    ).rejects.toThrow();
  });

  test("heartbeatClaim stays claim-based for an already claimed thread", async () => {
    const ctx = createTestContext();
    const { org, project } = await ctx.setupProject();

    // Create a second user with org membership but NO project membership
    const user2 = await ctx.user();
    await ctx.orgMember(org._id, user2._id, "member");
    const asUser2 = ctx.asUser(user2);

    const profile2 = await ctx.cliProfile(user2._id, project._id);
    const apiKeyResult = await asUser2.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session2 = await ctx.cliSession(profile2._id, apiKeyResult.id);
    const thread = await ctx.cliThread(user2._id, project._id, profile2._id, {
      hasPendingUserMessages: true,
      processingState: "claimed",
      status: "pending",
      claimedBySessionId: session2._id,
      claimedAt: Date.now(),
      claimLeaseExpiresAt: Date.now() + 60_000,
    });

    const renewed = await asUser2.mutation(api.cli.threads.runControl.heartbeatClaim, {
      threadId: thread._id,
      sessionId: session2._id,
      leaseMs: 60_000,
    });

    expect(renewed).toBe(true);
  });

  test("releaseClaim rejects user without project access", async () => {
    const ctx = createTestContext();
    const { org, project } = await ctx.setupProject();

    // Create a second user with org membership but NO project membership
    const user2 = await ctx.user();
    await ctx.orgMember(org._id, user2._id, "member");
    const asUser2 = ctx.asUser(user2);

    const profile2 = await ctx.cliProfile(user2._id, project._id);
    const apiKeyResult = await asUser2.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session2 = await ctx.cliSession(profile2._id, apiKeyResult.id);
    const thread = await ctx.cliThread(user2._id, project._id, profile2._id, {
      hasPendingUserMessages: true,
      processingState: "claimed",
      status: "pending",
      claimedBySessionId: session2._id,
      claimedAt: Date.now(),
      claimLeaseExpiresAt: Date.now() + 60_000,
    });

    await expect(
      asUser2.mutation(api.cli.threads.runControl.releaseClaim, {
        threadId: thread._id,
        sessionId: session2._id,
      })
    ).rejects.toThrow();
  });
});

// The MCP thread tools authenticate by API key, with no Clerk identity at all
// (OS-1162), so every test here calls through `t` rather than `asUser`.

describe("service cancellation", () => {
  test("accepts a scoped API key and refuses a stale selected run", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant", status: "streaming", runId: "current" });
    await t.run(async c => { await c.db.patch("cliThreads", thread._id, { activeAssistantMessageId: message._id, processingState: "streaming" }); });
    const key = await asUser.mutation(api.apiKeys.core.create, { name: "service", expiresAt: Date.now() + 86400000, scope: { organizationId: project.organizationId, projectIds: [project._id] } });
    await expect(t.mutation(api.cli.threads.runControl.cancelProcessing, { threadId: thread._id, apiKey: key.key, expectedRunId: "old" })).rejects.toThrow("Selected run is no longer active");
    expect((await t.run(c => c.db.get("cliMessages", message._id)))?.status).toBe("streaming");
    await t.mutation(api.cli.threads.runControl.cancelProcessing, { threadId: thread._id, apiKey: key.key, expectedRunId: "current" });
    expect((await t.run(c => c.db.get("cliMessages", message._id)))?.status).toBe("failed");
  });
});

describe.each(["claude-code", "codex"] as const)("%s stop confirmation", (cliType) => {
  async function setup() {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const key = await asUser.mutation(api.apiKeys.core.create, { name: "CLI", expiresAt: Date.now() + 86400000 });
    const session = await ctx.cliSession(profile._id, key.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      cliType, status: "streaming", processingState: "streaming", claimedBySessionId: session._id,
      hasPendingUserMessages: false,
    });
    const assistant = await ctx.cliMessage(chat._id, profile._id, {
      cliType, role: "assistant", status: "streaming", runId: "stopped-run", claimedBySessionId: session._id,
    });
    await t.run(async (c) => c.db.patch("cliThreads", chat._id, {
      activeAssistantMessageId: assistant._id,
      metadata: { backgroundTasks: { messageId: assistant._id, totalCount: 1,
        tasks: [{ id: "job", type: "local_bash", description: "Tests" }] } },
    }));
    const read = () => t.run((c) => c.db.get("cliThreads", chat._id));
    const stop = () => asUser.mutation(api.cli.threads.runControl.cancelProcessing, { threadId: chat._id });
    return { ctx, user, project, profile, session, chat, assistant, asUser, t, read, stop };
  }

  test("retains last-known jobs after releasing the claim and repeated Stop", async () => {
    const s = await setup();
    await s.stop();
    const stopped = await s.read();
    expect(stopped?.metadata).toHaveProperty("stopConfirmation", expect.objectContaining({
      runId: "stopped-run", status: "stopping",
      jobs: expect.objectContaining({ totalCount: 1 }),
    }));
    expect(stopped?.claimedBySessionId).toBeUndefined();
    await s.stop();
    expect((await s.read())?.metadata).toEqual(stopped?.metadata);
  });
  test("timeout and late acknowledgment leave a newer run and its jobs intact", async () => {
    const s = await setup();
    await s.stop();
    const stop = (await s.read())!.metadata!.stopConfirmation!;
    await s.t.mutation(internal.cli.threads.runControl.expireStopConfirmation, {
      threadId: s.chat._id, runId: stop.runId, requestedAt: stop.requestedAt,
    });
    expect((await s.read())?.metadata?.stopConfirmation?.status).toBe("unconfirmed");
    const next = await s.ctx.cliMessage(s.chat._id, s.profile._id, {
      cliType, role: "assistant", status: "streaming", runId: "next-run",
    });
    await s.t.run(async (c) => c.db.patch("cliThreads", s.chat._id, {
      processingState: "streaming", status: "streaming", activeAssistantMessageId: next._id,
      claimedBySessionId: s.session._id,
      metadata: { stopConfirmation: stop, backgroundTasks: { messageId: next._id, totalCount: 0, tasks: [] } },
    }));
    const ack = { threadId: s.chat._id, sessionId: s.session._id, runId: stop.runId, messageId: s.assistant._id };
    await s.asUser.mutation(api.cli.threads.runControl.acknowledgeStop, ack);
    const after = await s.read();
    expect(after?.metadata?.stopConfirmation?.status).toBe("stopped");
    expect(after?.activeAssistantMessageId).toBe(next._id);
    expect(after?.processingState).toBe("streaming");
    expect(after?.metadata?.backgroundTasks?.messageId).toBe(next._id);
    await s.asUser.mutation(api.cli.threads.runControl.acknowledgeStop, ack);
    expect((await s.read())?.metadata).toEqual(after?.metadata);
    await s.stop();
    await s.asUser.mutation(api.cli.threads.runControl.acknowledgeStop, ack);
    await s.t.mutation(internal.cli.threads.runControl.expireStopConfirmation, {
      threadId: s.chat._id, runId: stop.runId, requestedAt: stop.requestedAt,
    });
    expect((await s.read())?.metadata?.stopConfirmation).toMatchObject({ runId: "next-run", status: "stopping" });
  });

  test("a confirmed goal pause on Stop marks an active goal paused (OS-2277)", async () => {
    const s = await setup();
    const goal = { objective: "count.txt holds 9", status: "active" as const, iterations: 0, tokensUsed: 40 };
    await s.t.run(async (c) => {
      const chat = await c.db.get("cliThreads", s.chat._id);
      await c.db.patch("cliThreads", s.chat._id, { metadata: { ...chat!.metadata, goal } });
    });
    await s.stop();
    const stop = (await s.read())!.metadata!.stopConfirmation!;
    await s.asUser.mutation(api.cli.threads.runControl.acknowledgeStop, {
      threadId: s.chat._id, sessionId: s.session._id, runId: stop.runId, messageId: s.assistant._id, goalPaused: true,
    });
    expect((await s.read())?.metadata?.goal).toEqual({ ...goal, status: "paused" });
  });

  test("disconnected CLI times out and an unrelated session cannot acknowledge", async () => {
    const s = await setup();
    await s.stop();
    const stop = (await s.read())!.metadata!.stopConfirmation!;
    const key = await s.asUser.mutation(api.apiKeys.core.create, { name: "Other CLI", expiresAt: Date.now() + 86400000 });
    const other = await s.ctx.cliSession(s.profile._id, key.id);
    await s.asUser.mutation(api.cli.threads.runControl.acknowledgeStop, {
      threadId: s.chat._id, sessionId: other._id, messageId: s.assistant._id, runId: stop.runId,
    });
    expect((await s.read())?.metadata?.stopConfirmation?.status).toBe("stopping");
    await s.t.run((c) => c.db.delete("cliSessions", s.session._id));
    await s.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(15_000));
    expect((await s.read())?.metadata?.stopConfirmation?.status).toBe("unconfirmed");
    expect((await s.read())?.metadata?.stopConfirmation?.jobs?.totalCount).toBe(1);
  });

  test("a previous run's claim watch stays false after the same session claims a new run", async () => {
    const s = await setup();
    await s.t.run((c) => c.db.patch("cliThreads", s.chat._id, { claimLeaseExpiresAt: Date.now() + 60000 }));
    expect(await s.asUser.query(api.cli.threads.runControl.isClaimActiveForSession, {
      threadId: s.chat._id, sessionId: s.session._id, messageId: s.assistant._id,
    })).toBe(true);
    const next = await s.ctx.cliMessage(s.chat._id, s.profile._id, { role: "assistant", status: "streaming", runId: "new" });
    await s.t.run((c) => c.db.patch("cliThreads", s.chat._id, { activeAssistantMessageId: next._id }));
    expect(await s.asUser.query(api.cli.threads.runControl.isClaimActiveForSession, {
      threadId: s.chat._id, sessionId: s.session._id, messageId: s.assistant._id,
    })).toBe(false);
  });

});
