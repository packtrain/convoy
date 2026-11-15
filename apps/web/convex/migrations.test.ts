import { describe, expect, test } from "vitest";
import { LexoRank } from "lexorank";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createTestContext } from "../convex-testing";
import { Status as StatusValues } from "@/lib/tasks/status";
import { INBOX_LIST_NAME, INBOX_LIST_REF } from "./tasks/lib/lists/resolution";
import { createPersistedTaskListKey } from "./lib/contracts/taskListKeys";
import { BACKLOG_SYSTEM_LIST_KEY } from "@/lib/task-lists/system-lists";
import { createTaskListSearchText, normalizeListName } from "./tasks/lib/lists/naming";

const DAY_MS = 24 * 60 * 60 * 1000;

async function runEnsureProjectInbox(t: ReturnType<typeof createTestContext>["t"]) {
  return t.mutation(internal.migrations.ensureProjectInbox, { reset: true });
}

async function runBackfillDefaultListTasks(t: ReturnType<typeof createTestContext>["t"]) {
  return t.mutation(internal.migrations.backfillDefaultListTasks, {
    reset: true,
  });
}

async function runClearLegacyCostRollupThreadIds(t: ReturnType<typeof createTestContext>["t"]) {
  return t.mutation(internal.migrations.clearLegacyCostRollupThreadIds, {
    reset: true,
  });
}

async function runClearLegacySlashCommandTitles(t: ReturnType<typeof createTestContext>["t"]) {
  return t.mutation(internal.migrations.clearLegacySlashCommandTitles, {
    reset: true,
  });
}

async function runBackfillSlashCommandAutoSubmit(t: ReturnType<typeof createTestContext>["t"]) {
  return t.mutation(internal.migrations.backfillSlashCommandAutoSubmit, {
    reset: true,
  });
}

async function runBackfillTaskListRanks(t: ReturnType<typeof createTestContext>["t"]) {
  return t.mutation(internal.migrations.backfillTaskListRanks, {
    reset: true,
  });
}

async function insertInboxList(
  t: ReturnType<typeof createTestContext>["t"],
  args: {
    projectId: Id<"projects">;
    userId: Id<"users">;
    isArchived?: boolean;
  }
) {
  return t.run(async (runCtx) => {
    const now = Date.now();
    return runCtx.db.insert("taskLists", {
      projectId: args.projectId,
      name: INBOX_LIST_NAME,
      normalizedName: normalizeListName(INBOX_LIST_NAME),
      ref: INBOX_LIST_REF,
      searchText: createTaskListSearchText(INBOX_LIST_NAME, INBOX_LIST_REF),
      isArchived: args.isArchived ?? false,
      ...(args.isArchived ? { archivedAt: now, archivedBy: args.userId } : {}),
      createdBy: args.userId,
      updatedBy: args.userId,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function insertTaskList(
  t: ReturnType<typeof createTestContext>["t"],
  args: {
    projectId: Id<"projects">;
    userId: Id<"users">;
    name: string;
    ref: string;
  }
) {
  return t.run(async (runCtx) => {
    const now = Date.now();
    return runCtx.db.insert("taskLists", {
      projectId: args.projectId,
      name: args.name,
      normalizedName: normalizeListName(args.name),
      ref: args.ref,
      searchText: createTaskListSearchText(args.name, args.ref),
      isArchived: false,
      createdBy: args.userId,
      updatedBy: args.userId,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("OS-842 default List migrations", () => {
  test("ensureProjectInbox creates an Inbox List and default pointer", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject({
      project: { defaultListId: undefined },
    });

    await runEnsureProjectInbox(t);

    const { updatedProject, inboxLists } = await t.run(async (runCtx) => {
      const updatedProject = await runCtx.db.get("projects", project._id);
      const inboxLists = await runCtx.db
        .query("taskLists")
        .withIndex("by_project_and_ref", (q) => q.eq("projectId", project._id).eq("ref", INBOX_LIST_REF))
        .collect();
      return { updatedProject, inboxLists };
    });

    expect(inboxLists).toHaveLength(1);
    expect(updatedProject?.defaultListId).toBe(inboxLists[0]._id);
    expect(inboxLists[0].isArchived).toBe(false);
  });

  test("ensureProjectInbox reuses an existing active INBOX List", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject({
      project: { defaultListId: undefined },
    });
    const inboxId = await insertInboxList(t, {
      projectId: project._id,
      userId: user._id,
    });

    await runEnsureProjectInbox(t);
    await runEnsureProjectInbox(t);

    const { updatedProject, inboxLists } = await t.run(async (runCtx) => {
      const updatedProject = await runCtx.db.get("projects", project._id);
      const inboxLists = await runCtx.db
        .query("taskLists")
        .withIndex("by_project_and_ref", (q) => q.eq("projectId", project._id).eq("ref", INBOX_LIST_REF))
        .collect();
      return { updatedProject, inboxLists };
    });

    expect(updatedProject?.defaultListId).toBe(inboxId);
    expect(inboxLists.map((list) => list._id)).toEqual([inboxId]);
  });

  test("ensureProjectInbox reuses and unarchives an archived INBOX List", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject({
      project: { defaultListId: undefined },
    });
    const inboxId = await insertInboxList(t, {
      projectId: project._id,
      userId: user._id,
      isArchived: true,
    });

    await runEnsureProjectInbox(t);

    const { updatedProject, inbox } = await t.run(async (runCtx) => ({
      updatedProject: await runCtx.db.get("projects", project._id),
      inbox: await runCtx.db.get("taskLists", inboxId),
    }));

    expect(updatedProject?.defaultListId).toBe(inboxId);
    expect(inbox?.isArchived).toBe(false);
    expect(inbox?.archivedAt).toBeUndefined();
    expect(inbox?.archivedBy).toBeUndefined();
  });

  test("backfillDefaultListTasks assigns eligible active tasks and leaves inactive tasks untouched", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject({
      project: { defaultListId: undefined },
    });
    await runEnsureProjectInbox(t);
    const defaultListId = await t.run(async (runCtx) => {
      const updatedProject = await runCtx.db.get("projects", project._id);
      if (!updatedProject?.defaultListId) {
        throw new Error("expected defaultListId");
      }
      return updatedProject.defaultListId;
    });
    const otherListId = await insertTaskList(t, {
      name: "Sprint",
      projectId: project._id,
      ref: "SPRINT",
      userId: user._id,
    });
    const defaultListKey = createPersistedTaskListKey(defaultListId);
    const otherListKey = createPersistedTaskListKey(otherListId);
    const eligibleTask = await ctx.task(project._id, user._id, {
      status: StatusValues.TODO,
    });
    const archivedTask = await ctx.task(project._id, user._id, {
      status: StatusValues.TODO,
      isArchived: true,
    });
    const deletedTask = await ctx.task(project._id, user._id, {
      status: StatusValues.TODO,
      isDeleted: true,
    });
    const alreadyListedTask = await ctx.task(project._id, user._id, {
      status: StatusValues.TODO,
      listKey: otherListKey,
    });

    await runBackfillDefaultListTasks(t);
    await runBackfillDefaultListTasks(t);

    const tasks = await t.run(async (runCtx) =>
      Promise.all([
        runCtx.db.get("tasks", eligibleTask._id),
        runCtx.db.get("tasks", archivedTask._id),
        runCtx.db.get("tasks", deletedTask._id),
        runCtx.db.get("tasks", alreadyListedTask._id),
      ])
    );

    expect(tasks[0]?.listKey).toBe(defaultListKey);
    expect(tasks[1]?.listKey).toBeUndefined();
    expect(tasks[2]?.listKey).toBeUndefined();
    expect(tasks[3]?.listKey).toBe(otherListKey);
  });

  test("backfillDefaultListTasks fails clearly if project defaults were not backfilled first", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject({
      project: { defaultListId: undefined },
    });
    await ctx.task(project._id, user._id, { status: StatusValues.TODO });

    const result = await runBackfillDefaultListTasks(t);

    expect(result.Status).toMatch(/run ensureProjectInbox first/);
  });

  test("verifyDefaultListBackfill reports incomplete and complete states", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject({
      project: { defaultListId: undefined },
    });
    const task = await ctx.task(project._id, user._id, {
      status: StatusValues.TODO,
    });

    const before = await t.query(internal.migrations.verifyDefaultListBackfill);

    expect(before.ok).toBe(false);
    expect(before.missingDefaultProjectIds).toContain(project._id);
    expect(before.eligibleTaskIdsWithoutList).toContain(task._id);

    await runEnsureProjectInbox(t);
    await runBackfillDefaultListTasks(t);

    const after = await t.query(internal.migrations.verifyDefaultListBackfill);

    expect(after).toEqual({
      ok: true,
      missingDefaultProjectIds: [],
      inactiveDefaultProjectIds: [],
      eligibleTaskIdsWithoutList: [],
    });
  });
});

describe("OS-1189 task List rank migration", () => {
  test("backfills ranks from default-first alphabetical visible order", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject({
      project: { defaultListId: undefined },
    });
    const betaId = await insertTaskList(t, {
      projectId: project._id,
      userId: user._id,
      name: "Beta",
      ref: "BETA",
    });
    const inboxId = await insertInboxList(t, {
      projectId: project._id,
      userId: user._id,
    });
    const alphaId = await insertTaskList(t, {
      projectId: project._id,
      userId: user._id,
      name: "Alpha",
      ref: "ALPHA",
    });
    await t.run((runCtx) => runCtx.db.patch("projects", project._id, { defaultListId: inboxId }));

    expect(await t.query(internal.migrations.verifyTaskListRankBackfill)).toMatchObject({
      ok: false,
    });

    await runBackfillTaskListRanks(t);
    await runBackfillTaskListRanks(t);

    const ordered = await t.run((runCtx) =>
      runCtx.db
        .query("taskLists")
        .withIndex("by_project_and_isArchived_and_rank", (q) => q.eq("projectId", project._id).eq("isArchived", false))
        .collect()
    );
    expect(ordered.map((list) => list._id)).toEqual([inboxId, alphaId, betaId]);
    expect(ordered.every((list) => list.rank !== undefined)).toBe(true);
    expect(await t.query(internal.migrations.verifyTaskListRankBackfill)).toEqual({
      ok: true,
      taskListIdsWithoutRank: [],
    });
  });
});

describe("OS-1189 task List rank migration collision safety", () => {
  test("seeds unranked Lists after existing ranks without collisions", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject({
      project: { defaultListId: undefined },
    });
    const inboxId = await insertInboxList(t, {
      projectId: project._id,
      userId: user._id,
    });
    await insertTaskList(t, {
      projectId: project._id,
      userId: user._id,
      name: "Alpha",
      ref: "ALPHA",
    });
    // Simulates a List created between deploy and backfill: `create` assigns
    // LexoRank.middle() when no ranked List exists yet.
    const rankedId = await insertTaskList(t, {
      projectId: project._id,
      userId: user._id,
      name: "Zed",
      ref: "ZED",
    });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("taskLists", rankedId, {
        rank: LexoRank.middle().toString(),
      });
      await runCtx.db.patch("projects", project._id, { defaultListId: inboxId });
    });

    await runBackfillTaskListRanks(t);

    const lists = await t.run((runCtx) =>
      runCtx.db
        .query("taskLists")
        .withIndex("by_project_and_isArchived_and_rank", (q) => q.eq("projectId", project._id).eq("isArchived", false))
        .collect()
    );
    const ranks = lists.map((list) => list.rank);
    expect(ranks.every((rank) => rank !== undefined)).toBe(true);
    expect(new Set(ranks).size).toBe(lists.length);
    // The pre-ranked List keeps its rank untouched.
    expect(lists.find((list) => list._id === rankedId)?.rank).toBe(LexoRank.middle().toString());
  });
});

describe("Backlog system List verification", () => {
  test("verifyBacklogSystemListParentConsistency reports Backlog children whose parent is outside Backlog", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();
    if (!project.defaultListId) {
      throw new Error("expected defaultListId");
    }
    const defaultListKey = createPersistedTaskListKey(project.defaultListId);
    const parent = await ctx.task(project._id, user._id, {
      status: StatusValues.TODO,
      listKey: defaultListKey,
    });
    const child = await ctx.task(project._id, user._id, {
      parentId: parent._id,
      status: StatusValues.TODO,
      listKey: BACKLOG_SYSTEM_LIST_KEY,
    });

    const split = await t.query(internal.migrations.verifyBacklogSystemListParentConsistency, {});

    expect(split.ok).toBe(false);
    expect(split.splitBacklogSubtaskIds).toEqual([child._id]);
    expect(split.truncated).toBe(false);

    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", parent._id, {
        listKey: BACKLOG_SYSTEM_LIST_KEY,
      });
    });

    const consistent = await t.query(internal.migrations.verifyBacklogSystemListParentConsistency, {});

    expect(consistent).toEqual({
      ok: true,
      checkedBacklogTaskCount: 2,
      splitBacklogSubtaskIds: [],
      truncated: false,
    });
  });
});

describe("telemetry chunk cleanup migration", () => {
  test("deleteTelemetryCliMessageChunks removes stored telemetry rows and keeps meaningful ones", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const assistant = await ctx.cliMessage(thread._id, profile._id, {
      role: "assistant",
      content: [],
    });
    const userMessage = await ctx.cliMessage(thread._id, profile._id, {
      role: "user",
      content: [],
    });

    const assistantChunks = await ctx.cliMessageChunks(assistant._id, thread._id, profile._id, [
      {
        type: "system",
        data: JSON.stringify({ type: "system", subtype: "thinking_tokens" }),
      },
      {
        type: "system",
        data: JSON.stringify({ type: "system", subtype: "status" }),
      },
      {
        type: "assistant",
        data: JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
        }),
      },
      {
        type: "result",
        data: JSON.stringify({ type: "result", subtype: "success" }),
      },
    ]);
    // User chunks are never telemetry, even with a matching raw shape.
    const userChunks = await ctx.cliMessageChunks(userMessage._id, thread._id, profile._id, [{ type: "text", data: "hello" }]);

    await t.mutation(internal.migrations.deleteTelemetryCliMessageChunks, {
      reset: true,
    });

    await t.run(async (runCtx) => {
      const [thinking, status, assistantBody, result] = assistantChunks;
      expect(await runCtx.db.get("cliMessageChunks", thinking._id)).toBeNull();
      expect(await runCtx.db.get("cliMessageChunks", status._id)).toBeNull();
      expect(await runCtx.db.get("cliMessageChunks", assistantBody._id)).not.toBeNull();
      expect(await runCtx.db.get("cliMessageChunks", result._id)).not.toBeNull();
      expect(await runCtx.db.get("cliMessageChunks", userChunks[0]._id)).not.toBeNull();
    });
  });
});

describe("cli message attachment ref role backfill (OS-2289)", () => {
  test("stamps each ref with its message's role and leaves stamped rows alone", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const reply = await ctx.cliMessage(thread._id, profile._id, { role: "assistant" });
    const prompt = await ctx.cliMessage(thread._id, profile._id, { role: "user" });
    const refIds = await t.run(async (runCtx) => {
      const insert = async (messageId: Id<"cliMessages">, role?: "user" | "assistant") =>
        runCtx.db.insert("cliMessageAttachmentRefs", {
          threadId: thread._id,
          messageId,
          storageId: await runCtx.storage.store(new Blob(["file"])),
          ...(role ? { role } : {}),
          createdAt: 1,
        });
      return [await insert(reply._id), await insert(prompt._id), await insert(prompt._id, "assistant")];
    });

    await t.mutation(internal.migrations.backfillCliMessageAttachmentRefRole, { reset: true });

    const roles = await t.run(async (runCtx) => Promise.all(refIds.map(async (id) => (await runCtx.db.get("cliMessageAttachmentRefs", id))?.role)));
    expect(roles).toEqual(["assistant", "user", "assistant"]);
  });
});

describe("cli thread last-used selection backfill", () => {
  async function setupThread() {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);

    const userMessage = (overrides: {
      createdAt: number;
      cliModel?: string;
      cliEffort?: string;
      cliMode?: string;
    }) => ctx.cliMessage(thread._id, profile._id, { role: "user", content: [], ...overrides });

    const run = () =>
      t.mutation(internal.migrations.backfillCliThreadLastUsedCli, { reset: true });

    const readSelection = async () => {
      const cli = await t.run(async (runCtx) => {
        const stored = await runCtx.db.get("cliThreads", thread._id);
        return stored?.metadata?.cli ?? null;
      });
      if (!cli) {
        return null;
      }
      return {
        lastUsedModel: cli.lastUsedModel ?? null,
        lastUsedEffort: cli.lastUsedEffort ?? null,
        lastUsedMode: cli.lastUsedMode ?? null,
      };
    };

    return { ctx, t, user, project, profile, thread, userMessage, run, readSelection };
  }

  test("backfills from the newest user message that names a selection", async () => {
    const { userMessage, run, readSelection } = await setupThread();
    await userMessage({ createdAt: 1000, cliModel: "opus", cliEffort: "high", cliMode: "plan" });
    await userMessage({ createdAt: 2000, cliModel: "sonnet", cliEffort: "low", cliMode: "default" });

    await run();

    expect(await readSelection()).toEqual({
      lastUsedModel: "sonnet",
      lastUsedEffort: "low",
      lastUsedMode: "default",
    });
  });

  test("skips back past newer messages that name nothing", async () => {
    const { userMessage, run, readSelection } = await setupThread();
    await userMessage({ createdAt: 1000, cliModel: "opus", cliEffort: "high", cliMode: "plan" });
    await userMessage({ createdAt: 2000 });

    await run();

    expect(await readSelection()).toEqual({
      lastUsedModel: "opus",
      lastUsedEffort: "high",
      lastUsedMode: "plan",
    });
  });

  test("takes the model's paired effort, not a newer message's stale effort", async () => {
    const { userMessage, run, readSelection } = await setupThread();
    await userMessage({ createdAt: 1000, cliModel: "opus", cliEffort: "high" });
    // Newest names a model without an effort, so the pair moves together and
    // "high" must not survive onto "sonnet".
    await userMessage({ createdAt: 2000, cliModel: "sonnet", cliMode: "plan" });

    await run();

    expect(await readSelection()).toEqual({
      lastUsedModel: "sonnet",
      lastUsedEffort: null,
      lastUsedMode: "plan",
    });
  });

  test("leaves a thread that already stores a selection alone", async () => {
    const { t, thread, userMessage, run, readSelection } = await setupThread();
    await userMessage({ createdAt: 1000, cliModel: "sonnet", cliEffort: "low" });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", thread._id, {
        metadata: { cli: { lastUsedModel: "opus" } },
      });
    });

    await run();

    expect(await readSelection()).toEqual({
      lastUsedModel: "opus",
      lastUsedEffort: null,
      lastUsedMode: null,
    });
  });

  test("writes nothing for a thread with no qualifying user message", async () => {
    const { userMessage, run, readSelection } = await setupThread();
    await userMessage({ createdAt: 1000 });

    await run();

    expect(await readSelection()).toBeNull();
  });

  test("preserves a stored plan and is idempotent on a rerun", async () => {
    const { t, thread, userMessage, run, readSelection } = await setupThread();
    await userMessage({ createdAt: 1000, cliModel: "opus", cliEffort: "high" });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", thread._id, {
        metadata: { plan: { steps: [{ id: "1", text: "Alpha", status: "in-progress" }] } },
      });
    });

    await run();
    await run();

    expect(await readSelection()).toEqual({
      lastUsedModel: "opus",
      lastUsedEffort: "high",
      lastUsedMode: null,
    });
    const steps = await t.run(async (runCtx) => {
      const stored = await runCtx.db.get("cliThreads", thread._id);
      return stored?.metadata?.plan?.steps ?? null;
    });
    expect(steps).toEqual([{ id: "1", text: "Alpha", status: "in-progress" }]);
  });

  test("replays the fold, so mode survives a later model-only message", async () => {
    const { userMessage, run, readSelection } = await setupThread();
    await userMessage({ createdAt: 1000, cliMode: "plan" });
    await userMessage({ createdAt: 2000, cliModel: "opus", cliEffort: "high" });

    await run();

    // Same result the write path would have produced message by message: mode
    // is sticky across a message that only names a model.
    expect(await readSelection()).toEqual({
      lastUsedModel: "opus",
      lastUsedEffort: "high",
      lastUsedMode: "plan",
    });
  });

  test("drops a blank stored mode instead of pinning it", async () => {
    const { userMessage, run, readSelection } = await setupThread();
    await userMessage({ createdAt: 1000, cliModel: "opus", cliMode: "plan" });
    await userMessage({ createdAt: 2000, cliMode: "   " });

    await run();

    expect(await readSelection()).toEqual({
      lastUsedModel: "opus",
      lastUsedEffort: null,
      lastUsedMode: "plan",
    });
  });

  test("verify reports threads the backfill has not reached yet", async () => {
    const { t, userMessage, run } = await setupThread();
    await userMessage({ createdAt: 1000, cliModel: "opus" });

    const before = await t.query(internal.migrations.verifyCliThreadLastUsedCliBackfill, {});
    expect(before.ok).toBe(false);
    expect(before.threadIdsWithoutLastUsedCli).toHaveLength(1);

    await run();

    expect(await t.query(internal.migrations.verifyCliThreadLastUsedCliBackfill, {})).toEqual({
      ok: true,
      checkedThreadCount: 1,
      threadIdsWithoutLastUsedCli: [],
      truncated: false,
    });
  });

  test("verify ignores threads with nothing to backfill", async () => {
    const { t, userMessage } = await setupThread();
    await userMessage({ createdAt: 1000 });

    expect(await t.query(internal.migrations.verifyCliThreadLastUsedCliBackfill, {})).toEqual({
      ok: true,
      checkedThreadCount: 1,
      threadIdsWithoutLastUsedCli: [],
      truncated: false,
    });
  });

  test("verify reports truncation rather than silently checking a prefix", async () => {
    const { ctx, t, user, project, profile } = await setupThread();
    await ctx.cliThread(user._id, project._id, profile._id);

    const result = await t.query(internal.migrations.verifyCliThreadLastUsedCliBackfill, {
      scanLimit: 1,
    });

    expect(result.checkedThreadCount).toBe(1);
    expect(result.truncated).toBe(true);
    // Truncation alone fails the check: an unscanned thread could be a miss.
    expect(result.ok).toBe(false);
  });
});

describe("cost rollup threadId cleanup migration", () => {
  test("clears legacy threadId from coarse cost rollups", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);

    const rollupId = await t.run(async (runCtx) => {
      const now = Date.now();
      return runCtx.db.insert("costRollups", {
        projectId: project._id,
        userId: user._id,
        threadId: thread._id,
        cliType: "claude-code",
        dayStartMs: now - (now % DAY_MS),
        costUsd: 0.01,
        byModel: [
          {
            model: "claude-haiku-4-5",
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 5,
            costUsd: 0.01,
          },
        ],
        runCount: 1,
        updatedAt: now,
      });
    });

    const before = await t.query(internal.migrations.verifyLegacyCostRollupThreadIdsCleared);
    expect(before).toEqual({
      ok: false,
      costRollupIdsWithLegacyThreadId: [rollupId],
    });

    await runClearLegacyCostRollupThreadIds(t);
    await runClearLegacyCostRollupThreadIds(t);

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("costRollups", rollupId);
      expect(updated?.threadId).toBeUndefined();
      expect(updated?.costUsd).toBeCloseTo(0.01);
    });

    const after = await t.query(internal.migrations.verifyLegacyCostRollupThreadIdsCleared);
    expect(after).toEqual({
      ok: true,
      costRollupIdsWithLegacyThreadId: [],
    });
  });
});

describe("slash command title cleanup migration", () => {
  test("clears legacy titles from slash commands", async () => {
    const ctx = createTestContext();
    const { org, user, t } = await ctx.setupOrg();

    const slashCommandId = await t.run(async (runCtx) => {
      const now = Date.now();
      return runCtx.db.insert("slashCommands", {
        scope: "organization",
        organizationId: org._id,
        title: "Legacy title",
        key: "legacy-title",
        content: "Legacy content",
        autoExpand: false,
        createdBy: user._id,
        updatedBy: user._id,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      });
    });

    const before = await t.query(internal.migrations.verifyLegacySlashCommandTitlesCleared);
    expect(before).toEqual({
      ok: false,
      slashCommandIdsWithLegacyTitle: [slashCommandId],
    });

    await runClearLegacySlashCommandTitles(t);
    await runClearLegacySlashCommandTitles(t);

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("slashCommands", slashCommandId);
      expect(updated?.title).toBeUndefined();
      expect(updated?.key).toBe("legacy-title");
    });

    const after = await t.query(internal.migrations.verifyLegacySlashCommandTitlesCleared);
    expect(after).toEqual({
      ok: true,
      slashCommandIdsWithLegacyTitle: [],
    });
  });
});

describe("OS-1215 slash command autosubmit backfill", () => {
  test("backfills missing values, preserves true, and is idempotent", async () => {
    const ctx = createTestContext();
    const { org, user, t } = await ctx.setupOrg();

    const [missingId, enabledId] = await t.run(async (runCtx) => {
      const now = Date.now();
      const base = {
        scope: "organization" as const,
        organizationId: org._id,
        content: "Prompt content",
        autoExpand: false,
        createdBy: user._id,
        updatedBy: user._id,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      };
      return Promise.all([
        runCtx.db.insert("slashCommands", {
          ...base,
          key: "missing-autosubmit",
        }),
        runCtx.db.insert("slashCommands", {
          ...base,
          key: "enabled-autosubmit",
          autoSubmit: true,
        }),
      ]);
    });

    expect(await t.query(internal.migrations.verifySlashCommandAutoSubmitBackfill)).toEqual({
      ok: false,
      slashCommandIdsWithoutAutoSubmit: [missingId],
    });

    await runBackfillSlashCommandAutoSubmit(t);
    await runBackfillSlashCommandAutoSubmit(t);

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("slashCommands", missingId))?.autoSubmit).toBe(false);
      expect((await runCtx.db.get("slashCommands", enabledId))?.autoSubmit).toBe(true);
    });

    expect(await t.query(internal.migrations.verifySlashCommandAutoSubmitBackfill)).toEqual({
      ok: true,
      slashCommandIdsWithoutAutoSubmit: [],
    });
  });
});

describe("OS-882 resource count backfill", () => {
  test("backfillTaskResourceCounts recomputes missing and drifted counts", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();

    const withResources = await ctx.task(project._id, user._id);
    const drifted = await ctx.task(project._id, user._id);
    const empty = await ctx.task(project._id, user._id);

    await t.run(async (runCtx) => {
      for (const taskId of [withResources._id, withResources._id, drifted._id]) {
        await runCtx.db.insert("taskAttachments", {
          taskId,
          storageId: await runCtx.storage.store(new Blob(["attached"])),
          fileName: "file.txt",
          fileSize: 8,
          contentType: "text/plain",
          uploadedBy: user._id,
          uploadedAt: Date.now(),
        });
      }
      await runCtx.db.insert("taskArtifacts", {
        taskId: withResources._id,
        name: "Plan",
        fileName: "plan.md",
        content: "# Plan",
        source: "user",
        createdBy: user._id,
        updatedBy: user._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await runCtx.db.patch("tasks", drifted._id, { attachmentCount: 5, artifactCount: 3 });
    });

    await t.mutation(internal.migrations.backfillTaskResourceCounts, {
      reset: true,
    });

    await t.run(async (runCtx) => {
      const withResourcesDoc = await runCtx.db.get("tasks", withResources._id);
      expect(withResourcesDoc?.attachmentCount).toBe(2);
      expect(withResourcesDoc?.artifactCount).toBe(1);
      const driftedDoc = await runCtx.db.get("tasks", drifted._id);
      expect(driftedDoc?.attachmentCount).toBe(1);
      expect(driftedDoc?.artifactCount).toBe(0);
      const emptyDoc = await runCtx.db.get("tasks", empty._id);
      expect(emptyDoc?.attachmentCount).toBe(0);
      expect(emptyDoc?.artifactCount).toBe(0);
    });
  });
});

describe("OS-1535 org leader project membership backfill", () => {
  test("grants project-admin per org owner/admin, preserves existing roles, and is idempotent", async () => {
    const ctx = createTestContext();
    const { user: owner, org, project, t } = await ctx.setupProject();

    const admin = await ctx.user();
    await ctx.orgMember(org._id, admin._id, "admin");
    const plainMember = await ctx.user();
    await ctx.orgMember(org._id, plainMember._id, "member");

    // An admin already added as viewer in phase 1 keeps that role.
    const demotedProject = await ctx.project(org._id, owner._id, { alias: "DEM" });
    await ctx.projectMember(demotedProject._id, admin._id, "viewer");

    const archived = await ctx.project(org._id, owner._id, { alias: "ARC", isArchived: true });
    const deleted = await ctx.project(org._id, owner._id, { alias: "DEL", isDeleted: true });

    // A second org's leader must not gain access to the first org's projects.
    const otherOwner = await ctx.user();
    const otherOrg = await ctx.organization(otherOwner._id);
    const otherProject = await ctx.project(otherOrg._id, otherOwner._id, { alias: "OTH" });

    expect(await t.query(internal.migrations.verifyOrgLeaderProjectMembershipBackfill)).toMatchObject({
      ok: false,
    });

    await t.mutation(internal.migrations.backfillOrgLeaderProjectMemberships, { reset: true });
    await t.mutation(internal.migrations.backfillOrgLeaderProjectMemberships, { reset: true });

    const roleFor = async (projectId: Id<"projects">, userId: Id<"users">) =>
      t.run(async (runCtx) =>
        (
          await runCtx.db
            .query("projectMembers")
            .withIndex("by_project_and_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
            .collect()
        ).map((membership) => membership.role)
      );

    expect(await roleFor(project._id, owner._id)).toEqual(["project-admin"]);
    expect(await roleFor(project._id, admin._id)).toEqual(["project-admin"]);
    expect(await roleFor(project._id, plainMember._id)).toEqual([]);
    expect(await roleFor(demotedProject._id, admin._id)).toEqual(["viewer"]);
    // Archived projects can be unarchived, so their leaders are granted too.
    expect(await roleFor(archived._id, admin._id)).toEqual(["project-admin"]);
    expect(await roleFor(deleted._id, admin._id)).toEqual([]);
    expect(await roleFor(project._id, otherOwner._id)).toEqual([]);
    expect(await roleFor(otherProject._id, owner._id)).toEqual([]);

    expect(await t.query(internal.migrations.verifyOrgLeaderProjectMembershipBackfill)).toEqual({
      ok: true,
      missingGrants: [],
    });
  });
});

describe("OS-1398 notification organization backfill", () => {
  test("stamps each row with its project's org and leaves orphans unstamped", async () => {
    const ctx = createTestContext();
    const { user, org, project, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    const otherOrg = await ctx.organization(user._id);
    const otherProject = await ctx.project(otherOrg._id, user._id, { alias: "OTH" });
    const deadProject = await ctx.project(otherOrg._id, user._id, { alias: "DED" });

    const legacyRow = (projectId: Id<"projects">) => ({
      userId: user._id,
      type: "task.status_changed" as const,
      projectId,
      subject: { kind: "task" as const, id: task._id },
      read: false,
      snapshot: { taskRef: "T-1", taskTitle: "task" },
    });

    const { stale, elsewhere, orphaned } = await t.run(async (runCtx) => ({
      stale: await runCtx.db.insert("notifications", legacyRow(project._id)),
      elsewhere: await runCtx.db.insert("notifications", legacyRow(otherProject._id)),
      // Hard-deleted project: nothing to stamp, so the row stays invisible
      // until retention reaps it.
      orphaned: await runCtx.db.insert("notifications", legacyRow(deadProject._id)),
    }));
    await t.run(async (runCtx) => {
      await runCtx.db.delete("projects", deadProject._id);
    });

    await t.mutation(internal.migrations.backfillNotificationOrganizationId, { reset: true });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("notifications", stale))?.organizationId).toBe(org._id);
      expect((await runCtx.db.get("notifications", elsewhere))?.organizationId).toBe(otherOrg._id);
      expect((await runCtx.db.get("notifications", orphaned))?.organizationId).toBeUndefined();
    });
  });
});
