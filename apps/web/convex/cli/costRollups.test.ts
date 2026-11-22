import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestContext } from "../../convex-testing";
import codexFixtures from "./lib/runtimes/codex/costUsage.fixtures.json";

function claudeResultChunk(costUsd: number) {
  return {
    type: "result",
    data: JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "sess-1",
      total_cost_usd: costUsd,
      usage: { input_tokens: 100, output_tokens: 200 },
      modelUsage: {
        "claude-opus-4-6": {
          inputTokens: 100,
          outputTokens: 200,
          cacheReadInputTokens: 300,
          costUSD: costUsd,
        },
      },
    }),
  };
}

/** A claimed thread with one started run, ready for appendRunContent. */
async function setupClaimedRun(options?: {
  associatedTaskId?: Id<"tasks">;
  cliType?: "codex" | "opencode" | "antigravity";
  cliModel?: string;
}) {
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
    ...(options?.cliType ? { cliType: options.cliType } : {}),
    ...(options?.associatedTaskId
      ? { associatedTaskId: options.associatedTaskId }
      : {}),
  });

  const userMessage = await ctx.cliMessage(chat._id, profile._id, {
    role: "user",
    ...(options?.cliModel ? { cliModel: options.cliModel } : {}),
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

  return { ctx, user, project, asUser, t, session, chat, apiKeyResult, started, userMessage };
}

describe("cost rollup sink (appendRunContent)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("OpenCode follow-up runs add step costs and count each run once", async () => {
    const base = await setupClaimedRun({ cliType: "opencode", cliModel: "anthropic/claude-sonnet-5" });
    const credentials = { sessionId: base.session._id, apiKey: base.apiKeyResult.key };
    const appendStep = (messageId: Id<"cliMessages">, id: string, cost: number) =>
      base.t.mutation(api.cli.messages.appendRunContent, {
        messageId, ...credentials,
        chunks: [{ type: "message.part.updated", data: JSON.stringify({
          type: "message.part.updated", properties: { sessionID: "ses_same", part: {
            id, sessionID: "ses_same", type: "step-finish", cost,
            tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 200, write: 0 } },
          } },
        }) }],
      });
    await appendStep(base.started.assistantMessageId, "step-1", 0.04);
    await base.t.mutation(api.cli.messages.complete, { messageId: base.started.assistantMessageId, ...credentials });
    const followUp = await base.ctx.cliMessage(base.chat._id, base.chat.profileId, {
      role: "user", cliModel: "anthropic/claude-sonnet-5", content: [],
    });
    await base.t.mutation(api.cli.threads.runControl.claimThread, { threadId: base.chat._id, leaseMs: 60_000, ...credentials });
    const next = await base.t.mutation(api.cli.messages.startRunResponse, {
      threadId: base.chat._id, userMessageIds: [followUp._id], ...credentials,
    });
    await appendStep(next.assistantMessageId, "step-2", 0.001);
    await appendStep(next.assistantMessageId, "step-3", 0.002);
    await base.t.mutation(api.cli.messages.complete, { messageId: next.assistantMessageId, ...credentials });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    for (const table of ["costRollups", "threadCostRollups"] as const) {
      const rows = await base.t.run((ctx) => ctx.db.query(table).collect());
      expect(rows).toHaveLength(1);
      expect(rows[0]?.costUsd).toBeCloseTo(0.043, 12);
      expect(rows[0]?.runCount).toBe(2);
      expect(rows[0]?.byModel[0]).toMatchObject({ inputTokens: 300, cachedInputTokens: 600, outputTokens: 60 });
    }
    const summary = await base.asUser.query(api.costs.core.getThreadCostSummary, { threadId: base.chat._id });
    expect(summary?.totalCostUsd).toBeCloseTo(0.043, 12);
  });

  test.each([
    ["gpt-6-astra", "gpt-6-astra"], ["default", "unknown"], ["gpt-5", "unknown"],
  ])("exec slot %s attributes only an explicit resolved model", async (cliModel, expected) => {
    const base = await setupClaimedRun({ cliType: "codex", cliModel });
    await base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId, sessionId: base.session._id,
      chunks: [{ type: "turn.completed", data: JSON.stringify({ usage: {
        input_tokens: 100, cached_input_tokens: 0, output_tokens: 20,
      } }) }], apiKey: base.apiKeyResult.key,
    });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    const rows = await base.t.run((runCtx) => runCtx.db.query("costRollups").collect());
    expect(rows[0]?.byModel[0]).toMatchObject({ model: expected, inputTokens: 100 });
  });

  test("a model-only reroute persists until usage crosses the change", async () => {
    const base = await setupClaimedRun({ cliType: "codex" });
    const append = (type: string, params: object) => base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId, sessionId: base.session._id,
      chunks: [{ type, data: JSON.stringify(params) }], apiKey: base.apiKeyResult.key,
    });
    await append("thread/started", { thread: { id: "thread" }, model: "gpt-5.5" });
    await append("turn/started", { turn: { id: "turn" } });
    await append("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 } } });
    await append("model/rerouted", { threadId: "thread", turnId: "turn", fromModel: "gpt-5.5", toModel: "gpt-6-astra" });
    expect(await base.t.run((runCtx) => runCtx.db.get("cliMessages", base.started.assistantMessageId)))
      .toMatchObject({ codexModelState: { model: "gpt-6-astra", pendingChange: true } });
    for (const inputTokens of [150, 200]) {
      await append("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens, cachedInputTokens: 0, outputTokens: 20 } } });
    }
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    for (const table of ["costRollups", "threadCostRollups"] as const) {
      const rows = await base.t.run((runCtx) => runCtx.db.query(table).collect());
      expect(rows[0]?.runCount).toBe(1);
      expect(rows[0]?.byModel.map(({ model, inputTokens }) => ({ model, inputTokens }))).toEqual([
        { model: "gpt-5.5", inputTokens: 100 }, { model: "unknown", inputTokens: 50 }, { model: "gpt-6-astra", inputTokens: 50 },
      ]);
    }
  });

  test.each(["resume", "retry"])("%s starts with fresh model evidence", async (kind) => {
    const base = await setupClaimedRun({ cliType: "codex" });
    const credentials = { sessionId: base.session._id, apiKey: base.apiKeyResult.key };
    const append = (messageId: Id<"cliMessages">, type: string, params: object) => base.t.mutation(api.cli.messages.appendRunContent, {
      messageId, ...credentials, chunks: [{ type, data: JSON.stringify(params) }],
    });
    await append(base.started.assistantMessageId, "thread/started", { thread: { id: "continued-thread" }, model: "gpt-5.5" });
    await append(base.started.assistantMessageId, "thread/tokenUsage/updated", { tokenUsage: { total: {
      inputTokens: 100, cachedInputTokens: 0, outputTokens: 20,
    } } });
    let userMessageId = base.userMessage._id;
    if (kind === "retry") {
      await base.t.mutation(api.cli.messages.fail, { messageId: base.started.assistantMessageId, ...credentials, errorMessage: "test failure" });
      await base.t.mutation(api.cli.messages.retry, { messageId: base.started.assistantMessageId, apiKey: base.apiKeyResult.key });
    } else {
      await base.t.mutation(api.cli.messages.complete, { messageId: base.started.assistantMessageId, ...credentials });
      const next = await base.ctx.cliMessage(base.chat._id, base.chat.profileId, { role: "user", content: [] });
      userMessageId = next._id;
    }
    await base.t.mutation(api.cli.threads.runControl.claimThread, { threadId: base.chat._id, ...credentials, leaseMs: 60_000 });
    const next = await base.t.mutation(api.cli.messages.startRunResponse, { threadId: base.chat._id, userMessageIds: [userMessageId], ...credentials });
    expect(await base.t.run((runCtx) => runCtx.db.get("cliMessages", next.assistantMessageId))).not.toHaveProperty("codexModelState");
    // Old CLI metadata provides only the continuation, never the previous run's model.
    await append(next.assistantMessageId, "thread/started", { thread: { id: "continued-thread" } });
    await append(next.assistantMessageId, "thread/tokenUsage/updated", { tokenUsage: { total: {
      inputTokens: 150, cachedInputTokens: 0, outputTokens: 20,
    } } });
    await append(next.assistantMessageId, "thread/started", { thread: { id: "continued-thread" }, model: "gpt-6-astra" });
    await append(next.assistantMessageId, "thread/tokenUsage/updated", { tokenUsage: { total: {
      inputTokens: 200, cachedInputTokens: 0, outputTokens: 20,
    } } });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    for (const table of ["costRollups", "threadCostRollups"] as const) {
      const rows = await base.t.run((runCtx) => runCtx.db.query(table).collect());
      expect(rows[0]?.runCount).toBe(2);
      expect(Object.fromEntries(rows[0]!.byModel.map((row) => [row.model, row.inputTokens])))
        .toEqual({ "gpt-5.5": 100, unknown: 50, "gpt-6-astra": 50 });
    }
  });

  test.each(["envelopes", "page"])("startup without usage persists the run model in %s and later appends", async (query) => {
    const base = await setupClaimedRun({ cliType: "codex" });
    const append = (type: string, params: object) => base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId, sessionId: base.session._id,
      chunks: [{ type, data: JSON.stringify(params) }], apiKey: base.apiKeyResult.key,
    });
    await append("thread/started", { thread: { id: "resolved-thread" }, model: "gpt-6-astra" });
    const message = await base.t.run((runCtx) => runCtx.db.get("cliMessages", base.started.assistantMessageId));
    expect(message).toMatchObject({ codexModelState: { model: "gpt-6-astra", source: "startup" } });
    expect(message?.costRecordedAt).toBeUndefined();
    expect(message?.cliModel).not.toBe("gpt-6-astra");
    expect(message?.cliContext?.continuationId).toBe("resolved-thread");
    const rows = query === "envelopes"
      ? (await base.asUser.query(api.cli.messages.listEnvelopesByThread, { threadId: base.chat._id })).envelopes
      : (await base.asUser.query(api.cli.messages.listByThread, {
          threadId: base.chat._id, paginationOpts: { numItems: 10, cursor: null },
        })).page;
    expect(rows.find((row) => row._id === base.started.assistantMessageId))
      .toMatchObject({ resolvedCliModel: "gpt-6-astra" });
    for (const inputTokens of [100, 150]) {
      await append("thread/tokenUsage/updated", { tokenUsage: { total: {
        inputTokens, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 10,
      } } });
    }
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    for (const table of ["costRollups", "threadCostRollups"] as const) {
      const rows = await base.t.run((runCtx) => runCtx.db.query(table).collect());
      expect(rows[0]).toMatchObject({ runCount: 1, byModel: [{ model: "gpt-6-astra", inputTokens: 150 }] });
    }
  });

  test("captured app-server snapshots deduplicate across appends in both grains", async () => {
    const base = await setupClaimedRun({ cliType: "codex" });
    for (const params of codexFixtures.appServer) {
      await base.t.mutation(api.cli.messages.appendRunContent, {
        messageId: base.started.assistantMessageId,
        sessionId: base.session._id,
        chunks: [{ type: "thread/tokenUsage/updated", data: JSON.stringify(params) }],
        apiKey: base.apiKeyResult.key,
      });
    }
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    for (const table of ["costRollups", "threadCostRollups"] as const) {
      const rows = await base.t.run((runCtx) => runCtx.db.query(table).collect());
      expect(rows).toHaveLength(1);
      expect(rows[0]?.runCount).toBe(1);
      expect(rows[0]?.byModel[0]).toMatchObject({
        inputTokens: 750, cachedInputTokens: 750,
        cacheReadTokens: 600, cacheWriteTokens: 150, outputTokens: 300,
      });
    }
  });

  test("a zero snapshot resets persisted state without creating a run", async () => {
    const base = await setupClaimedRun({ cliType: "codex" });
    await base.t.run((runCtx) => runCtx.db.patch("cliThreads", base.chat._id, {
      codexUsageCursor: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 },
    }));
    await base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId,
      sessionId: base.session._id,
      chunks: [{ type: "turn.completed", data: JSON.stringify({ usage: {
        input_tokens: 0, cached_input_tokens: 0, output_tokens: 0,
      } }) }],
      apiKey: base.apiKeyResult.key,
    });
    const thread = await base.t.run((runCtx) => runCtx.db.get("cliThreads", base.chat._id));
    expect(thread?.codexUsageCursor?.inputTokens).toBe(0);
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    expect(await base.t.run((runCtx) => runCtx.db.query("costRollups").collect())).toEqual([]);
    const message = await base.t.run((runCtx) => runCtx.db.get("cliMessages", base.started.assistantMessageId));
    expect(message?.costRecordedAt).toBeUndefined();
    await base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId,
      sessionId: base.session._id,
      chunks: [{ type: "turn.completed", data: JSON.stringify({ usage: {
        input_tokens: 150, cached_input_tokens: 0, output_tokens: 0,
      } }) }],
      apiKey: base.apiKeyResult.key,
    });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    const rows = await base.t.run((runCtx) => runCtx.db.query("costRollups").collect());
    expect(rows[0]?.byModel[0]?.inputTokens).toBe(150);
    expect(rows[0]?.runCount).toBe(1);
  });

  test("a resume baseline persists before later usage and never counts as a run", async () => {
    const base = await setupClaimedRun({ cliType: "codex" });
    const append = (params: object) => base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId,
      sessionId: base.session._id,
      chunks: [{ type: "thread/tokenUsage/updated", data: JSON.stringify(params) }],
      apiKey: base.apiKeyResult.key,
    });
    await append({ ...codexFixtures.appServer[2], convoyUsageBaseline: true });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    expect(await base.t.run((runCtx) => runCtx.db.query("costRollups").collect())).toEqual([]);
    await append(codexFixtures.appServer[3]);
    await append(codexFixtures.appServer[3]);
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    for (const table of ["costRollups", "threadCostRollups"] as const) {
      const rows = await base.t.run((runCtx) => runCtx.db.query(table).collect());
      expect(rows).toHaveLength(1);
      expect(rows[0]?.runCount).toBe(1);
      expect(rows[0]?.byModel[0]).toMatchObject({
        inputTokens: 150, cachedInputTokens: 150,
        cacheReadTokens: 120, cacheWriteTokens: 30, outputTokens: 60,
      });
    }
  });

  test("claude result chunk records a rollup row attributed to the thread's task", async () => {
    const base = await setupClaimedRun();
    const task = await base.ctx.task(base.project._id, base.user._id);

    // Attach the task to the thread the way production stores it.
    await base.t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", base.chat._id, {
        associatedTaskId: task._id,
      });
    });

    await base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId,
      sessionId: base.session._id,
      chunks: [claudeResultChunk(0.25)],
      apiKey: base.apiKeyResult.key,
    });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();

    const rows = await base.t.run(async (runCtx) =>
      runCtx.db.query("costRollups").collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: base.project._id,
      userId: base.user._id,
      taskId: task._id,
      cliType: "claude-code",
      costUsd: 0.25,
    });
    expect(rows[0]?.byModel).toMatchObject([
      {
        model: "claude-opus-4-6",
        inputTokens: 100,
        cachedInputTokens: 300,
        cacheReadTokens: 300,
        outputTokens: 200,
        costUsd: 0.25,
      },
    ]);

    // Companion thread-grain row for the thread summary.
    const threadRows = await base.t.run(async (runCtx) =>
      runCtx.db.query("threadCostRollups").collect()
    );
    expect(threadRows).toHaveLength(1);
    expect(threadRows[0]).toMatchObject({
      threadId: base.chat._id,
      costUsd: 0.25,
    });

    const taskSummary = await base.asUser.query(
      api.costs.core.getTaskCostSummary,
      { taskId: task._id }
    );
    expect(taskSummary.totalCostUsd).toBeCloseTo(0.25);
    const threadSummary = await base.asUser.query(
      api.costs.core.getThreadCostSummary,
      { threadId: base.chat._id }
    );
    expect(threadSummary.totalCostUsd).toBeCloseTo(0.25);
  });

  test("unattached thread records a taskless rollup; non-result chunks record nothing", async () => {
    const base = await setupClaimedRun();

    await base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId,
      sessionId: base.session._id,
      chunks: [
        { type: "assistant", data: JSON.stringify({ type: "assistant" }) },
      ],
      apiKey: base.apiKeyResult.key,
    });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    expect(
      await base.t.run(async (runCtx) =>
        runCtx.db.query("costRollups").collect()
      )
    ).toHaveLength(0);

    await base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId,
      sessionId: base.session._id,
      chunks: [claudeResultChunk(0.1)],
      apiKey: base.apiKeyResult.key,
    });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();

    const rows = await base.t.run(async (runCtx) =>
      runCtx.db.query("costRollups").collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.taskId).toBeUndefined();
    expect(rows[0]?.costUsd).toBeCloseTo(0.1);
  });

  test("codex exec cumulative snapshots record per-batch deltas via the thread cursor", async () => {
    const base = await setupClaimedRun({ cliType: "codex" });

    const codexTurn = (usage: Record<string, number>) => ({
      type: "turn.completed",
      data: JSON.stringify({ type: "turn.completed", usage }),
    });

    await base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId,
      sessionId: base.session._id,
      chunks: [
        codexTurn({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 }),
      ],
      apiKey: base.apiKeyResult.key,
    });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();

    // Second batch reports the grown cumulative counters, not an increment.
    await base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId,
      sessionId: base.session._id,
      chunks: [
        codexTurn({ input_tokens: 260, cached_input_tokens: 170, output_tokens: 65 }),
      ],
      apiKey: base.apiKeyResult.key,
    });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();

    const rows = await base.t.run(async (runCtx) =>
      runCtx.db.query("costRollups").collect()
    );
    expect(rows).toHaveLength(1);
    // Uncached input: (100-40) + (160-130); cached and output are plain deltas.
    expect(rows[0]?.byModel[0]).toMatchObject({
      inputTokens: 90,
      cachedInputTokens: 170,
      cacheReadTokens: 170,
      outputTokens: 65,
    });

    const thread = await base.t.run(async (runCtx) =>
      runCtx.db.get("cliThreads", base.chat._id)
    );
    expect(thread?.codexUsageCursor).toMatchObject({
      inputTokens: 260,
      cachedInputTokens: 170,
      outputTokens: 65,
    });
  });

  test("a run streaming usage across several batches counts as one run", async () => {
    const base = await setupClaimedRun({ cliType: "codex" });

    // Codex app-server emits tokenUsage/updated after each model call, so a
    // single run can flush usage in more than one append batch.
    const tokenUsageChunk = (total: Record<string, number>) => ({
      type: "thread/tokenUsage/updated",
      data: JSON.stringify({ tokenUsage: { total, last: total } }),
    });

    for (const last of [
      { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 },
      { inputTokens: 160, cachedInputTokens: 90, outputTokens: 45 },
    ]) {
      await base.t.mutation(api.cli.messages.appendRunContent, {
        messageId: base.started.assistantMessageId,
        sessionId: base.session._id,
        chunks: [tokenUsageChunk(last)],
        apiKey: base.apiKeyResult.key,
      });
      vi.advanceTimersByTime(1);
      await base.t.finishInProgressScheduledFunctions();
    }

    const rows = await base.t.run(async (runCtx) =>
      runCtx.db.query("costRollups").collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.runCount).toBe(1);
    expect(rows[0]?.byModel[0]).toMatchObject({
      inputTokens: 70,
      cachedInputTokens: 90,
      outputTokens: 45,
    });

    const threadRows = await base.t.run(async (runCtx) =>
      runCtx.db.query("threadCostRollups").collect()
    );
    expect(threadRows[0]?.runCount).toBe(1);
  });
});

describe("cost estimation integration", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  test.each([0, 10])("append records reported aggregate %s without model usage", async (costUsd) => {
    const base = await setupClaimedRun();
    await base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId, sessionId: base.session._id, apiKey: base.apiKeyResult.key,
      chunks: [{ type: "result", data: JSON.stringify({ total_cost_usd: costUsd }) }],
    });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    for (const table of ["costRollups", "threadCostRollups"] as const) {
      const rows = await base.t.run((runCtx) => runCtx.db.query(table).collect());
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ costUsd, runCount: 1, costMetadata: { hasReported: true, hasUnpriced: false, modelAllocationIncomplete: true } });
    }
  });

  test.each([undefined, "false", "true"])("multi-batch Codex estimates automatically with obsolete flag=%s", async (obsoleteFlag) => {
    vi.stubEnv("COST_ESTIMATION_ENABLED", obsoleteFlag);
    const base = await setupClaimedRun({ cliType: "codex" });
    const task = await base.ctx.task(base.project._id, base.user._id);
    await base.t.run((runCtx) => runCtx.db.patch("cliThreads", base.chat._id, { associatedTaskId: task._id }));
    const append = (type: string, params: object) => base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId, sessionId: base.session._id, apiKey: base.apiKeyResult.key,
      chunks: [{ type, data: JSON.stringify(params) }],
    });
    await append("thread/started", { model: "gpt-5.5", thread: { id: "thread-cost" } });
    for (const inputTokens of [100, 200, 200]) {
      await append("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens, cachedInputTokens: 20, cacheWriteInputTokens: 0, outputTokens: 50 } } });
    }
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    const taskSummary = await base.asUser.query(api.costs.core.getTaskCostSummary, { taskId: task._id });
    const threadSummary = await base.asUser.query(api.costs.core.getThreadCostSummary, { threadId: base.chat._id });
    expect(taskSummary).toEqual(threadSummary);
    expect(threadSummary.byModel[0]).toMatchObject({ model: "gpt-5.5", inputTokens: 180, cacheReadTokens: 20, cacheWriteTokens: 0, outputTokens: 50 });
    expect(threadSummary.costMetadata).toMatchObject({ hasEstimated: true, hasUnpriced: false, hasLegacy: false });
    // Pinned GPT-5.5 baseline: input $5/M, cache reads $0.50/M, output $30/M.
    expect(threadSummary.totalCostUsd).toBeCloseTo(180 * 5e-6 + 20 * 5e-7 + 50 * 30e-6);
    const day = Date.now() - Date.now() % 86_400_000;
    const dashboard = await base.asUser.query(api.costs.core.getProjectUsageDashboard, { projectId: base.project._id, fromDayStartMs: day, toDayStartMs: day });
    expect(dashboard.totalRuns).toBe(1);
    expect(dashboard.totalCostUsd).toBe(threadSummary.totalCostUsd);
    expect(dashboard.costMetadata).toEqual(threadSummary.costMetadata);
    for (const table of ["costRollups", "threadCostRollups"] as const) {
      const rows = await base.t.run((runCtx) => runCtx.db.query(table).collect());
      expect(rows).toHaveLength(1);
      expect(rows[0]?.runCount).toBe(1);
      expect(rows[0]?.costMetadata).toEqual(threadSummary.costMetadata);
      expect(rows[0]?.costUsd).toBe(threadSummary.totalCostUsd);
    }
  });
});

describe("Antigravity estimates (OS-2481)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const usage = { inputTokens: 1000, outputTokens: 200, cachedReadTokens: 400, cachedWriteTokens: 0, thoughtTokens: 150, totalTokens: 1600 };
  async function runWith(model: string | undefined) {
    const base = await setupClaimedRun({ cliType: "antigravity" });
    await base.t.mutation(api.cli.messages.appendRunContent, {
      messageId: base.started.assistantMessageId, sessionId: base.session._id, apiKey: base.apiKeyResult.key,
      chunks: [{ type: "convoy/acp_prompt_result", data: JSON.stringify({ sessionId: "s1", stopReason: "end_turn", usage, ...(model ? { model } : {}) }) }],
    });
    vi.advanceTimersByTime(1);
    await base.t.finishInProgressScheduledFunctions();
    return base.asUser.query(api.costs.core.getThreadCostSummary, { threadId: base.chat._id });
  }

  test("prices the effective Gemini model at its catalog rate", async () => {
    const summary = await runWith("gemini-3.8-flash");
    expect(summary.byModel[0]).toMatchObject({ model: "gemini-3.8-flash", inputTokens: 1000, cacheReadTokens: 400, outputTokens: 200 });
    expect(summary.costMetadata).toMatchObject({ hasEstimated: true, hasUnpriced: false });
    // LiteLLM gemini/gemini-3.8-flash: input $0.75/M, cache reads $0.075/M, output $3.75/M.
    expect(summary.totalCostUsd).toBeCloseTo(1000 * 7.5e-7 + 400 * 7.5e-8 + 200 * 3.75e-6, 12);
  });

  test("prices Claude Sonnet 5.5 through agy at the Sonnet rate", async () => {
    const summary = await runWith("claude-sonnet-5-5");
    expect(summary.totalCostUsd).toBeCloseTo(1000 * 2e-6 + 400 * 1e-7 + 200 * 1e-5, 12);
  });

  test.each(["gemini-pro-orchestrator-neon", undefined])("leaves model %s unpriced rather than free", async (model) => {
    const summary = await runWith(model);
    expect(summary.byModel[0]?.outputTokens).toBe(200);
    expect(summary.costMetadata).toMatchObject({ hasEstimated: false, hasUnpriced: true });
  });
});

describe("Codex pricing across append boundaries", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  test("a legacy cache cursor prices complete deltas identically in one or two appends", async () => {
    const results = [];
    for (const split of [false, true]) {
      const base = await setupClaimedRun({ cliType: "codex", cliModel: "gpt-5.5" });
      const task = await base.ctx.task(base.project._id, base.user._id);
      await base.t.run((ctx) => ctx.db.patch("cliThreads", base.chat._id, {
        associatedTaskId: task._id,
        codexUsageCursor: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 },
      }));
      const chunks = [200, 300].map((inputTokens) => ({
        type: "thread/tokenUsage/updated",
        data: JSON.stringify({ tokenUsage: { total: {
          inputTokens, cachedInputTokens: 20, cacheWriteInputTokens: 0, outputTokens: 10,
        } } }),
      }));
      for (const batch of split ? chunks.map((chunk) => [chunk]) : [chunks]) {
        await base.t.mutation(api.cli.messages.appendRunContent, {
          messageId: base.started.assistantMessageId, sessionId: base.session._id,
          apiKey: base.apiKeyResult.key, chunks: batch,
        });
      }
      vi.advanceTimersByTime(1);
      await base.t.finishInProgressScheduledFunctions();
      const summary = await base.asUser.query(api.costs.core.getThreadCostSummary, { threadId: base.chat._id });
      results.push(summary);
      expect(summary.totalCostUsd).toBeCloseTo(0.0005, 12);
      expect(summary.costMetadata).toMatchObject({ hasEstimated: true, hasUnpriced: true });
      expect(summary.byModel[0]).toMatchObject({ model: "gpt-5.5", inputTokens: 200, cachedInputTokens: 0, outputTokens: 0 });
      expect(summary.byModel[0]?.cacheWriteTokens).toBeUndefined();
      expect(await base.asUser.query(api.costs.core.getTaskCostSummary, { taskId: task._id })).toEqual(summary);
      for (const table of ["costRollups", "threadCostRollups"] as const) {
        const rows = await base.t.run((ctx) => ctx.db.query(table).collect());
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ runCount: 1, costUsd: expect.closeTo(0.0005, 12), costMetadata: summary.costMetadata });
      }
    }
    expect(results[0]).toEqual(results[1]);
  });
});
