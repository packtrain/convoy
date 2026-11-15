import { convexToJson, jsonToConvex } from "convex/values";
import { scrubOversizedChunk } from "../../../../../cli/src/agent/app/chunk-scrub";
import { describe, expect, test, vi } from "vitest";
import { createTestContext } from "../../../../convex-testing";
import { api, internal } from "../../../_generated/api";
import { appendAssistantChunks } from "./lifecycle";
import {
  applyThreadClaim,
  markThreadStreamEnded,
  markThreadStreaming,
  markThreadUnread,
  resetThreadClaim,
} from "../../threads/lib/cliThreadsRepo";

const task = (id: string) => ({
  task_id: id,
  task_type: "local_bash",
  description: `Run ${id}`,
});
const system = (subtype: string, extra: Record<string, unknown> = {}) => ({
  type: "system",
  data: JSON.stringify({ type: "system", subtype, session_id: "claude-1", ...extra }),
});

async function setup(cliType: "claude-code" | "codex" = "claude-code") {
  const ctx = createTestContext();
  const { user, project, t, asUser } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id);
  const key = await asUser.mutation(api.apiKeys.core.create, { name: "Background task test" });
  const session = await ctx.cliSession(profile._id, key.id);
  const thread = await ctx.cliThread(user._id, project._id, profile._id, {
    cliType, status: "streaming", processingState: "streaming",
  });
  const message = await ctx.cliMessage(thread._id, profile._id, {
    role: "assistant", cliType, status: "streaming", content: [], nextChunkOrder: 0,
  });
  await t.run((c) => c.db.patch("cliThreads", thread._id, {
    activeAssistantMessageId: message._id,
    metadata: { plan: { steps: [{ text: "Keep this plan", status: "pending" }] } },
  }));
  const append = (chunks: Array<{ type: string; data: string }>) =>
    t.run(async (c) => {
      const stored = await c.db.get("cliMessages", message._id);
      if (!stored) throw new Error("Missing test message");
      await appendAssistantChunks(c, stored, chunks, Date.now());
    });
  const read = () => t.run((c) => c.db.get("cliThreads", thread._id));
  return { ctx, t, thread, message, session, asUser, append, read };
}

describe("live background tasks", () => {
  test("replaces snapshots, keeps them after result, and clears on an empty snapshot", async () => {
    const { append, read, message, asUser, thread } = await setup();
    await append([system("background_tasks_changed", { tasks: [task("a"), task("b")] })]);
    expect((await read())?.metadata).toMatchObject({
      backgroundTasks: {
        messageId: message._id, sessionId: "claude-1", totalCount: 2,
        tasks: [{ id: "a", type: "local_bash", description: "Run a" }, { id: "b" }],
      },
      plan: { steps: [{ text: "Keep this plan" }] },
    });
    const visible = await asUser.query(api.cli.threads.core.get, { threadId: thread._id });
    expect(visible?.metadata).toMatchObject({ backgroundTasks: { totalCount: 2 } });
    await append([system("background_tasks_changed", { tasks: [task("b")] }),
      { type: "result", data: JSON.stringify({ type: "result", subtype: "success" }) }]);
    expect((await read())?.metadata).toMatchObject({ backgroundTasks: { totalCount: 1, tasks: [{ id: "b" }] } });
    await append([system("background_tasks_changed", { tasks: [] })]);
    expect((await read())?.metadata).toMatchObject({ backgroundTasks: { totalCount: 0, tasks: [] } });
  });

  test("a new run clears membership and ignores snapshots from the previous message", async () => {
    const { ctx, t, thread, message, append, read } = await setup();
    await append([system("background_tasks_changed", { tasks: [task("old")] })]);
    expect((await read())?.metadata).toHaveProperty("backgroundTasks");
    const next = await ctx.cliMessage(thread._id, message.profileId, {
      role: "assistant", cliType: "claude-code", status: "streaming", content: [], nextChunkOrder: 0,
    });
    await t.run(async (c) => {
      const watchdog = await c.scheduler.runAfter(60_000, internal.cli.threads.runControl.streamingWatchdogTick, { threadId: thread._id, messageId: next._id, intervalMs: 60_000 });
      await markThreadStreaming(c, thread._id, { activeAssistantMessageId: next._id, streamWatchdogId: watchdog, hasPendingUserMessages: false, lastActivityAt: Date.now() });
      await c.scheduler.cancel(watchdog);
    });
    expect((await read())?.metadata).not.toHaveProperty("backgroundTasks");
    await append([system("background_tasks_changed", { tasks: [task("stale")] })]);
    expect((await read())?.metadata).not.toHaveProperty("backgroundTasks");
    await t.run(async (c) => {
      const stored = await c.db.get("cliMessages", next._id);
      if (!stored) throw new Error("Missing test message");
      await appendAssistantChunks(c, stored, [system("background_tasks_changed", { tasks: [task("new")] })], Date.now());
    });
    expect((await read())?.metadata).toMatchObject({ backgroundTasks: { messageId: next._id, tasks: [{ id: "new" }] } });
  });

  test("ignores malformed snapshots and uses event order for init and membership changes", async () => {
    const { append, read } = await setup();
    await append([system("background_tasks_changed", { tasks: [task("a")] })]);
    await append([system("background_tasks_changed", { tasks: null })]);
    expect((await read())?.metadata).toMatchObject({ backgroundTasks: { totalCount: 1 } });
    await append([system("background_tasks_changed", { tasks: [task("b")] }), system("init")]);
    expect((await read())?.metadata).toMatchObject({ backgroundTasks: { totalCount: 0 } });
    await append([system("init", { session_id: "claude-2" }),
      system("background_tasks_changed", { session_id: "claude-2", tasks: [task("c")] })]);
    expect((await read())?.metadata).toMatchObject({ backgroundTasks: { sessionId: "claude-2", tasks: [{ id: "c" }] } });
  });

  test.each(["complete", "fail", "stop", "new-claim"])("clears tasks on %s and rejects late old-run snapshots", async (end) => {
    const { t, thread, session, append, read } = await setup();
    await append([system("background_tasks_changed", { tasks: [task("a")] })]);
    expect((await read())?.metadata).toHaveProperty("backgroundTasks");
    await t.run(async (c) => {
      if (end === "stop") {
        await resetThreadClaim(c, thread._id, { status: "completed", hasPendingUserMessages: false, queueHeldAt: Date.now(), now: Date.now() });
      } else if (end === "new-claim") {
        await applyThreadClaim(c, thread._id, { sessionId: session._id, claimedAt: Date.now(), claimLeaseExpiresAt: Date.now() + 1000, processingState: "claimed", now: Date.now() });
      } else {
        await markThreadStreamEnded(c, thread._id, { status: end === "fail" ? "failed" : "waiting_input", hasPendingUserMessages: false, processingState: "idle", lastActivityAt: Date.now() });
      }
    });
    expect((await read())?.metadata).not.toHaveProperty("backgroundTasks");
    await append([system("background_tasks_changed", { tasks: [task("stale")] })]);
    expect((await read())?.metadata).not.toHaveProperty("backgroundTasks");
  });
});

test("Codex snapshots reach the shared projection and clear at process init", async () => {
  const { append, read, message } = await setup("codex");
  await append([{ type: "convoy/background_tasks", data: JSON.stringify({ session_id: "codex-root", tasks: [task("command:a")] }) }]);
  expect((await read())?.metadata?.backgroundTasks).toMatchObject({ messageId: message._id, sessionId: "codex-root", totalCount: 1, tasks: [{ id: "command:a" }] });
  await append([{ type: "convoy/background_tasks", data: JSON.stringify({ tasks: null }) }]);
  expect((await read())?.metadata?.backgroundTasks?.totalCount).toBe(1);
  await append([{ type: "thread/started", data: JSON.stringify({ thread: { id: "codex-next" } }) }]);
  expect((await read())?.metadata?.backgroundTasks).toMatchObject({ sessionId: "codex-next", totalCount: 0, tasks: [] });
});

test("does not write identical snapshots after Convex canonicalizes object keys", async () => {
  const { t, thread, message, append } = await setup();
  const chunk = system("background_tasks_changed", { tasks: [task("a")] });
  await append([chunk]);
  await t.run(async c => {
    const stored = await c.db.get("cliThreads", thread._id);
    if (!stored) throw new Error("Missing test thread");
    await c.db.patch("cliThreads", thread._id, { metadata: jsonToConvex(convexToJson(stored!.metadata!)) as typeof stored.metadata });
    const patch = vi.spyOn(c.db, "patch");
    await appendAssistantChunks(c, (await c.db.get("cliMessages", message._id))!, [chunk], Date.now());
    expect(patch.mock.calls.filter(call => call[0] === "cliThreads")).toEqual([]);
    patch.mockRestore();
  });
});

test.each(["claude-code", "codex"] as const)("projects large %s snapshots after the real upload scrubber", async cliType => {
  const { append, read } = await setup(cliType);
  const tasks = Array.from({ length: 240 }, (_, i) => ({ ...task(`job-${i}`), description: "prompt words ".repeat(1700) }));
  const chunk = cliType === "codex" ? { type: "convoy/background_tasks", data: JSON.stringify({ tasks }) }
    : system("background_tasks_changed", { tasks });
  await append([scrubOversizedChunk(chunk)]);
  const snapshot = (await read())?.metadata?.backgroundTasks;
  expect(snapshot?.totalCount).toBe(240);
  expect(snapshot?.tasks.length).toBeGreaterThan(0);
  expect(snapshot?.tasks.length).toBeLessThanOrEqual(200);
  await append([scrubOversizedChunk(cliType === "codex" ? { type: "convoy/background_tasks", data: JSON.stringify({ tasks: [] }) }
    : system("background_tasks_changed", { tasks: [] }))]);
  expect((await read())?.metadata?.backgroundTasks?.totalCount).toBe(0);
});

test("clearing a child's stale jobs does not overwrite container metadata through a reused patch", async () => {
  const { ctx, t, thread, message, append } = await setup();
  await append([system("background_tasks_changed", { tasks: [task("stale")] })]);
  const container = await ctx.cliThread(thread.userId, thread.projectId!, message.profileId, {
    kind: "group", metadata: { plan: { steps: [{ text: "Container plan", status: "pending" }] } },
  });
  await t.run(async c => {
    await c.db.patch("cliThreads", thread._id, { parentThreadId: container._id, processingState: "idle", status: "completed", readAt: Date.now() });
    await markThreadUnread(c, container._id);
    expect((await c.db.get("cliThreads", container._id))?.metadata?.plan?.steps[0].text).toBe("Container plan");
  });
});
