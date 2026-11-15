import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

/**
 * The composer goal button reads `cliThreads.metadata.goal`, folded from goal events at
 * chunk insert (OS-2276). Fixtures follow the Claude Code traces L1–L6.
 * Spec: docs/specs/cli-thread-goal.md.
 */

function goalReply(text: string) {
  return {
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
      local_command_run: { command: "goal", args: "" },
    }),
  };
}

function stopHookFeedback(objective: string, reason: string) {
  return {
    type: "user",
    data: JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: `Stop hook feedback:\n[${objective}]: ${reason}` }] },
      parent_tool_use_id: null,
    }),
  };
}

function result(terminalReason?: string) {
  return {
    type: "result",
    data: JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      ...(terminalReason ? { terminal_reason: terminalReason } : {}),
    }),
  };
}

const OBJECTIVE = "count.txt contains the number 3";

async function setupClaimedRun(cliType: "claude-code" | "codex" = "claude-code") {
  const ctx = createTestContext();
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id);
  const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
    name: "CLI Key",
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  const session = await ctx.cliSession(profile._id, apiKeyResult.id);
  const chat = await ctx.cliThread(user._id, project._id, profile._id, {
    cliType,
    hasPendingUserMessages: true,
    status: "pending",
  });
  const userMessage = await ctx.cliMessage(chat._id, profile._id, {
    role: "user",
    content: [{ type: "text", data: `/goal ${OBJECTIVE}`, timestamp: 1000 }],
    createdAt: 1000,
    updatedAt: 1000,
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

  const append = (chunks: Array<{ type: string; data: string }>) =>
    t.mutation(api.cli.messages.appendRunContent, {
      messageId: started.assistantMessageId,
      sessionId: session._id,
      chunks,
      apiKey: apiKeyResult.key,
    });
  const readMetadata = () =>
    t.run(async (runCtx) => (await runCtx.db.get("cliThreads", chat._id))?.metadata);
  return { append, readMetadata };
}

describe("thread goal fold (OS-2276)", () => {
  test("set, two failed checks, then a completed run marks the goal met", async () => {
    const { append, readMetadata } = await setupClaimedRun();

    await append([goalReply(`Goal set: ${OBJECTIVE}`)]);
    expect((await readMetadata())?.goal).toEqual({ objective: OBJECTIVE, status: "active", iterations: 0 });

    await append([stopHookFeedback(OBJECTIVE, "count.txt contains 1, not 3.")]);
    await append([stopHookFeedback(OBJECTIVE, "count.txt contains 2, not 3.")]);
    expect((await readMetadata())?.goal).toEqual({
      objective: OBJECTIVE, status: "active", iterations: 2, lastReason: "count.txt contains 2, not 3.",
    });

    await append([result("completed")]);
    expect((await readMetadata())?.goal).toEqual({
      objective: OBJECTIVE, status: "complete", iterations: 2, lastReason: "count.txt contains 2, not 3.",
    });
  });

  test("Stop keeps the goal active", async () => {
    const { append, readMetadata } = await setupClaimedRun();

    await append([goalReply(`Goal set: ${OBJECTIVE}`), stopHookFeedback(OBJECTIVE, "1, not 3.")]);
    await append([result("aborted_streaming")]);

    expect((await readMetadata())?.goal).toMatchObject({ status: "active", iterations: 1 });
  });

  test("a status reply replaces the goal with the reported state", async () => {
    const { append, readMetadata } = await setupClaimedRun();

    await append([goalReply(`Goal set: ${OBJECTIVE}`)]);
    await append([goalReply(`Goal active: ${OBJECTIVE} (not yet evaluated)`)]);
    expect((await readMetadata())?.goal).toEqual({ objective: OBJECTIVE, status: "active", iterations: 0 });

    await append([goalReply(`Goal active: ${OBJECTIVE} (1 turn)\nLast check: 1, not 3.`)]);
    expect((await readMetadata())?.goal).toEqual({
      objective: OBJECTIVE, status: "active", iterations: 1, lastReason: "1, not 3.",
    });
  });

  test.each([`Goal cleared: ${OBJECTIVE}`, "No goal set"])("%j removes the goal", async (reply) => {
    const { append, readMetadata } = await setupClaimedRun();

    await append([goalReply(`Goal set: ${OBJECTIVE}`)]);
    await append([goalReply(reply)]);

    expect(await readMetadata()).not.toHaveProperty("goal");
  });

  test("a met goal stays until the next set", async () => {
    const { append, readMetadata } = await setupClaimedRun();

    await append([goalReply(`Goal set: ${OBJECTIVE}`), result("completed")]);
    await append([result("completed")]);
    expect((await readMetadata())?.goal).toMatchObject({ status: "complete" });

    await append([goalReply("Goal set: a.txt exists")]);
    expect((await readMetadata())?.goal).toEqual({ objective: "a.txt exists", status: "active", iterations: 0 });
  });

  test("an objective containing `]: ` survives checks and status replies", async () => {
    const { append, readMetadata } = await setupClaimedRun();
    const objective = "README contains [docs]: https://example.com";

    await append([goalReply(`Goal set: ${objective}`)]);
    await append([stopHookFeedback(objective, "The link is missing.")]);
    expect((await readMetadata())?.goal).toEqual({
      objective, status: "active", iterations: 1, lastReason: "The link is missing.",
    });

    await append([goalReply(`Goal active: ${objective} (1 turn)\nLast check: The link is missing.`)]);
    await append([stopHookFeedback(objective, "Still missing [see]: line 3.")]);
    expect((await readMetadata())?.goal).toEqual({
      objective, status: "active", iterations: 2, lastReason: "Still missing [see]: line 3.",
    });
  });

  test("a check without a known goal adopts the checked objective", async () => {
    const { append, readMetadata } = await setupClaimedRun();

    await append([stopHookFeedback(OBJECTIVE, "1, not 3.")]);

    expect((await readMetadata())?.goal).toEqual({
      objective: OBJECTIVE, status: "active", iterations: 1, lastReason: "1, not 3.",
    });
  });

  test("a completed run without a goal writes nothing", async () => {
    const { append, readMetadata } = await setupClaimedRun();

    await append([result("completed")]);

    expect(await readMetadata()).toBeFalsy();
  });
});

const ROOT = "t-root";

function codexGoal(status: string, overrides: Record<string, unknown> = {}) {
  return { threadId: ROOT, objective: OBJECTIVE, status, tokenBudget: null, tokensUsed: 40,
    timeUsedSeconds: 3, createdAt: 100, updatedAt: 101, ...overrides };
}

function codexSnapshot(action: string, goal: Record<string, unknown> | null) {
  return { type: "convoy/goal/snapshot", data: JSON.stringify({ action, threadId: ROOT, goal }) };
}

function codexGoalUpdated(goal: Record<string, unknown>, threadId = ROOT) {
  return { type: "thread/goal/updated", data: JSON.stringify({ threadId, turnId: "turn-1", goal, convoyRootThreadId: ROOT }) };
}

describe("Codex thread goal fold (OS-2277)", () => {
  test("a set snapshot, then a native complete update, marks the goal met", async () => {
    const { append, readMetadata } = await setupClaimedRun("codex");

    await append([codexSnapshot("set", codexGoal("active", { tokensUsed: 0 }))]);
    expect((await readMetadata())?.goal).toEqual({ objective: OBJECTIVE, status: "active", iterations: 0, tokensUsed: 0 });

    await append([codexGoalUpdated(codexGoal("complete", { tokensUsed: 900 }))]);
    expect((await readMetadata())?.goal).toEqual({ objective: OBJECTIVE, status: "complete", iterations: 0, tokensUsed: 900 });
  });

  test("pause, budget limit and the budget itself land on the thread", async () => {
    const { append, readMetadata } = await setupClaimedRun("codex");

    await append([codexSnapshot("auto-pause", codexGoal("paused"))]);
    expect((await readMetadata())?.goal).toMatchObject({ status: "paused" });

    await append([codexGoalUpdated(codexGoal("budgetLimited", { tokenBudget: 1000, tokensUsed: 1000 }))]);
    expect((await readMetadata())?.goal).toMatchObject({ status: "budgetLimited", tokensUsed: 1000, tokenBudget: 1000 });
  });

  test("clear and an empty read remove the goal", async () => {
    const { append, readMetadata } = await setupClaimedRun("codex");

    await append([codexSnapshot("set", codexGoal("active"))]);
    await append([{ type: "thread/goal/cleared", data: JSON.stringify({ threadId: ROOT, convoyRootThreadId: ROOT }) }]);
    expect((await readMetadata())?.goal).toBeUndefined();

    await append([codexSnapshot("set", codexGoal("active"))]);
    await append([codexSnapshot("read", null)]);
    expect((await readMetadata())?.goal).toBeUndefined();
  });

  test("a sync read repairs a goal whose pause never reached Convoy (CR1 #2)", async () => {
    const { append, readMetadata } = await setupClaimedRun("codex");

    await append([codexSnapshot("set", codexGoal("active"))]);
    await append([codexSnapshot("sync", codexGoal("paused"))]);
    expect((await readMetadata())?.goal).toMatchObject({ status: "paused" });

    await append([codexSnapshot("sync", null)]);
    expect((await readMetadata())?.goal).toBeUndefined();
  });

  test("a child thread's goal does not drive the parent", async () => {
    const { append, readMetadata } = await setupClaimedRun("codex");

    await append([codexSnapshot("set", codexGoal("active"))]);
    await append([codexGoalUpdated(codexGoal("complete", { threadId: "child-a" }), "child-a")]);
    expect((await readMetadata())?.goal).toMatchObject({ status: "active" });
  });
});
