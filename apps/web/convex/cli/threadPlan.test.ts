import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

/**
 * The plan is denormalized onto the thread at chunk-insert time (OS-1442)
 * precisely because it must not depend on which chunks a reader has loaded.
 * These tests assert the stored fold, not a client derivation.
 */

function todoWriteChunk(todos: Array<{ content: string; status: string }>) {
  return {
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tool_todo", name: "TodoWrite", input: { todos } },
        ],
      },
    }),
  };
}

function taskCreateResultChunk(id: string, subject: string) {
  return {
    type: "user",
    data: JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `tool_${id}`, content: "ok" }],
      },
      tool_use_result: { task: { id, subject, status: "pending" } },
    }),
  };
}

function taskUpdateChunk(taskId: string, status: string) {
  return {
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tool_up", name: "TaskUpdate", input: { taskId, status } },
        ],
      },
    }),
  };
}

function codexTodoListChunk(items: Array<{ text: string; completed: boolean }>) {
  return {
    type: "item.updated",
    data: JSON.stringify({
      type: "item.updated",
      item: { id: "item_1", type: "todo_list", items },
    }),
  };
}

async function setupClaimedRun(cliType?: "claude-code" | "codex") {
  const ctx = createTestContext();
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id);

  const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
    name: "CLI Key",
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  const session = await ctx.cliSession(profile._id, apiKeyResult.id);
  const chat = await ctx.cliThread(user._id, project._id, profile._id, {
    hasPendingUserMessages: true,
    status: "pending",
    ...(cliType ? { cliType } : {}),
  });

  const userMessage = await ctx.cliMessage(chat._id, profile._id, {
    role: "user",
    content: [{ type: "text", data: "hello", timestamp: 1000 }],
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

  const readPlan = async () =>
    t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", chat._id);
      // `t.run` serializes undefined to null across the boundary.
      return thread?.metadata?.plan?.steps ?? null;
    });

  return { append, readPlan, chat, t };
}

describe("thread plan metadata", () => {
  test("threads without a plan keep metadata unset", async () => {
    const { append, readPlan } = await setupClaimedRun();

    await append([
      {
        type: "assistant",
        data: JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
        }),
      },
    ]);

    expect(await readPlan()).toBeNull();
  });

  test("a TodoWrite snapshot replaces the stored plan", async () => {
    const { append, readPlan } = await setupClaimedRun();

    await append([
      todoWriteChunk([
        { content: "Investigate", status: "in_progress" },
        { content: "Implement", status: "pending" },
      ]),
    ]);
    expect(await readPlan()).toEqual([
      { text: "Investigate", status: "in-progress" },
      { text: "Implement", status: "pending" },
    ]);

    await append([todoWriteChunk([{ content: "Investigate", status: "completed" }])]);
    expect(await readPlan()).toEqual([{ text: "Investigate", status: "completed" }]);
  });

  test("task-tool deltas accumulate across separate appends", async () => {
    const { append, readPlan } = await setupClaimedRun();

    await append([taskCreateResultChunk("1", "Count files")]);
    await append([taskCreateResultChunk("2", "Print the branch")]);
    expect(await readPlan()).toEqual([
      { id: "1", text: "Count files", status: "pending" },
      { id: "2", text: "Print the branch", status: "pending" },
    ]);

    await append([taskUpdateChunk("1", "in_progress")]);
    expect(await readPlan()).toEqual([
      { id: "1", text: "Count files", status: "in-progress" },
      { id: "2", text: "Print the branch", status: "pending" },
    ]);

    await append([taskUpdateChunk("1", "completed"), taskUpdateChunk("2", "in_progress")]);
    expect(await readPlan()).toEqual([
      { id: "1", text: "Count files", status: "completed" },
      { id: "2", text: "Print the branch", status: "in-progress" },
    ]);
  });

  test("codex todo_list snapshots land on the thread too", async () => {
    const { append, readPlan } = await setupClaimedRun("codex");

    await append([
      codexTodoListChunk([
        { text: "Alpha", completed: true },
        { text: "Beta", completed: false },
      ]),
    ]);

    expect(await readPlan()).toEqual([
      { text: "Alpha", status: "completed" },
      { text: "Beta", status: "pending" },
    ]);
  });

  test("the plan reaches the client through the thread query", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        metadata: { plan: { steps: [{ id: "1", text: "Alpha", status: "in-progress" }] } },
      });
    });

    const thread = await asUser.query(api.cli.threads.core.get, { threadId: chat._id });
    expect(thread?.metadata?.plan?.steps).toEqual([
      { id: "1", text: "Alpha", status: "in-progress" },
    ]);
  });
});
