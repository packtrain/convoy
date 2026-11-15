import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

/**
 * Context-window and usage-limit snapshots are denormalized onto the thread at
 * chunk-insert time (OS-1889), like the plan (OS-1442): the chunk window a
 * reader loads is bounded, so the newest snapshot may not be in it.
 */

function contextUsageChunk(usedTokens: number, maxTokens: number) {
  return {
    type: "convoy.context_usage",
    data: JSON.stringify({ type: "convoy.context_usage", usedTokens, maxTokens }),
  };
}

function rateLimitChunk(rateLimitType: string, utilization: number, resetsAt: number) {
  return {
    type: "rate_limit_event",
    data: JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", rateLimitType, utilization, resetsAt },
    }),
  };
}

function assistantUsageChunk(promptTokens: number) {
  return {
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "working" }],
        usage: { input_tokens: promptTokens, output_tokens: 5 },
      },
    }),
  };
}

function todoWriteChunk(todos: Array<{ content: string; status: string }>) {
  return {
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "tool_todo", name: "TodoWrite", input: { todos } }],
      },
    }),
  };
}

async function setupClaimedRun(cliType: "claude-code" | "opencode" = "claude-code") {
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

  const readMetadata = async () =>
    t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", chat._id);
      return thread?.metadata ?? null;
    });

  const readReports = () => t.run(async runCtx => (await runCtx.db.query("cliMessageChunks")
    .withIndex("by_thread_and_message_and_chunkOrder", q => q.eq("threadId", chat._id).eq("messageId", started.assistantMessageId)).collect())
    .flatMap(chunk => chunk.normalizedEvent?.kind === "account-usage" ? [chunk.normalizedEvent.usage] : []));
  const seedLegacy = () => t.run(async runCtx => runCtx.db.patch("cliThreads", chat._id, {
    metadata: { usageLimits: [{ window: "weekly", isUsingOverage: true }] },
  }));
  return { append, readMetadata, readReports, seedLegacy };
}

describe("thread usage snapshots", () => {
  const unavailable = {
    type: "convoy.account_usage",
    data: JSON.stringify({ provider: "claude-code", source: "unavailable", account: "Account unavailable", refreshedAt: 123, buckets: [] }),
  };

  test("usage fallback freezes the last observation, including quota below 80%", async () => {
    const { append, readReports, readMetadata } = await setupClaimedRun();
    await append([rateLimitChunk("five_hour", 0.25, 1000)]);
    const snapshot = (await readMetadata())?.usageLimits?.[0];
    expect(snapshot).toHaveProperty("reportedAt", expect.any(Number));
    await append([unavailable]);
    const [report] = await readReports();
    expect(report).toMatchObject({ source: "last-reported", account: "Historical thread data; account unverified", buckets: [
      { id: "5h", windows: [{ usedPercent: 25, reportedAt: snapshot?.reportedAt }] },
    ] });
    await append([rateLimitChunk("five_hour", 0.75, 2000)]);
    expect((await readReports())[0]).toEqual(report);
  });

  test("legacy snapshots keep unknown utilization and age instead of acquiring a lookup date", async () => {
    const { append, readReports, seedLegacy } = await setupClaimedRun();
    await seedLegacy();
    await append([unavailable]);
    expect((await readReports())[0]).toMatchObject({ source: "last-reported", buckets: [
      { windows: [{ name: "weekly", isUsingOverage: true }] },
    ] });
    expect((await readReports())[0].buckets[0].windows[0].reportedAt).toBeUndefined();
    expect((await readReports())[0].buckets[0].windows[0].usedPercent).toBeUndefined();
  });

  test("absent snapshots stay unavailable", async () => {
    const { append, readReports } = await setupClaimedRun();
    await append([unavailable]);
    expect((await readReports())[0]).toMatchObject({ source: "unavailable", buckets: [] });
  });
  test("OpenCode persists context and retains it when later chunks have no valid snapshot", async () => {
    const { append, readMetadata } = await setupClaimedRun("opencode");
    await append([contextUsageChunk(8650, 200_000)]);
    expect((await readMetadata())?.contextWindow).toEqual({ usedTokens: 8650, maxTokens: 200_000 });
    await append([{ type: "text.delta", data: JSON.stringify({ text: "follow-up" }) }, contextUsageChunk(0, 200_000)]);
    expect((await readMetadata())?.contextWindow).toEqual({ usedTokens: 8650, maxTokens: 200_000 });
    await append([contextUsageChunk(8800, 200_000)]);
    expect((await readMetadata())?.contextWindow).toEqual({ usedTokens: 8800, maxTokens: 200_000 });
  });

  test("the latest valid context-window snapshot lands on the thread", async () => {
    const { append, readMetadata } = await setupClaimedRun();

    await append([contextUsageChunk(50_000, 200_000)]);
    expect((await readMetadata())?.contextWindow).toEqual({
      usedTokens: 50_000,
      maxTokens: 200_000,
    });

    await append([contextUsageChunk(80_000, 200_000)]);
    expect((await readMetadata())?.contextWindow).toEqual({
      usedTokens: 80_000,
      maxTokens: 200_000,
    });

    // Non-positive values normalize to metadata, so the stored snapshot survives.
    await append([contextUsageChunk(0, 200_000)]);
    expect((await readMetadata())?.contextWindow).toEqual({
      usedTokens: 80_000,
      maxTokens: 200_000,
    });
  });

  test("per-call context events without a max leave the thread snapshot alone (OS-1900)", async () => {
    const { append, readMetadata } = await setupClaimedRun();

    await append([contextUsageChunk(50_000, 200_000)]);
    await append([assistantUsageChunk(90_000)]);

    expect((await readMetadata())?.contextWindow).toEqual({
      usedTokens: 50_000,
      maxTokens: 200_000,
    });
  });

  test("usage limits fold to the latest snapshot per window", async () => {
    const { append, readMetadata } = await setupClaimedRun();

    await append([
      rateLimitChunk("five_hour", 0.5, 1_000),
      rateLimitChunk("seven_day", 0.2, 2_000),
    ]);
    await append([rateLimitChunk("five_hour", 0.9, 1_500)]);

    expect((await readMetadata())?.usageLimits).toEqual([
      { window: "5h", utilization: 0.9, resetsAt: 1_500, reportedAt: expect.any(Number) },
      { window: "weekly", utilization: 0.2, resetsAt: 2_000, reportedAt: expect.any(Number) },
    ]);
  });

  test("snapshots merge into metadata without dropping the plan", async () => {
    const { append, readMetadata } = await setupClaimedRun();

    await append([todoWriteChunk([{ content: "Investigate", status: "in_progress" }])]);
    await append([contextUsageChunk(50_000, 200_000), rateLimitChunk("five_hour", 0.5, 1_000)]);

    const metadata = await readMetadata();
    expect(metadata?.plan?.steps).toEqual([{ text: "Investigate", status: "in-progress" }]);
    expect(metadata?.contextWindow).toEqual({ usedTokens: 50_000, maxTokens: 200_000 });
    expect(metadata?.usageLimits).toEqual([{ window: "5h", utilization: 0.5, resetsAt: 1_000, reportedAt: expect.any(Number) }]);
  });
});
