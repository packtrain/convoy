/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestContext } from "../../convex-testing";
import { connectedProject, drain, stubGithubAppEnv } from "../../convex-testing/github";
import { errors as githubErrors } from "../integrations/github/errors";
import { getAppUrlBase } from "../lib/shared/appUrl";
import { deleteStorageIfUnreferenced } from "../lib/storageRepo";

/** A feature task with the Feature checklist, a thread attached to it, and a live run. */
async function setupLiveRun({ withTask = true } = {}) {
  const ctx = createTestContext();
  const { org, user, project, asUser, t } = await ctx.setupProject();
  for (const [key, label] of [
    ["tests", "All tests pass"],
    ["ui", "UI verified"],
    ["spec", "Spec updated"],
  ]) {
    await asUser.mutation(api.checks.definitions.create, { projectId: project._id, key, label, instruction: `Do ${key}` });
  }
  await asUser.mutation(api.checks.checklists.create, {
    projectId: project._id,
    name: "Feature",
    checkKeys: ["tests", "ui", "spec"],
    taskTypeKeys: ["feature"],
  });
  const task = await ctx.task(project._id, user._id, { taskTypeKey: "feature" });

  const { key: apiKey, id: apiKeyId } = await asUser.mutation(api.apiKeys.core.create, {
    name: "CLI Key",
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  const profile = await ctx.cliProfile(user._id, project._id);
  const session = await ctx.cliSession(profile._id, apiKeyId);
  const chat = await ctx.cliThread(user._id, project._id, profile._id, {
    status: "pending",
    hasPendingUserMessages: true,
    title: "Build the login page",
    ...(withTask ? { associatedTaskId: task._id } : {}),
  });
  const userMessageId = await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "run the checks" });
  await t.mutation(api.cli.threads.runControl.claimThread, { threadId: chat._id, sessionId: session._id, leaseMs: 60_000, apiKey });
  const started = await t.mutation(api.cli.messages.startRunResponse, {
    threadId: chat._id,
    sessionId: session._id,
    userMessageIds: [userMessageId],
    apiKey,
  });

  const upload = async (body: string, fileName = `${body}.png`, contentType = "image/png") => {
    const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob([body])));
    await t.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId, apiKey });
    return { storageId, fileName, fileSize: body.length, contentType };
  };
  const attach = (
    check: {
      key: string;
      status: "passed" | "warning" | "failed" | "not_performed";
      note?: string;
      label?: string;
      value?: string;
      artifactId?: string;
    },
    attachments: Awaited<ReturnType<typeof upload>>[] = []
  ) =>
    t.mutation(api.cli.messages.attachToResponse, {
      threadId: chat._id,
      messageId: started.assistantMessageId,
      sessionId: session._id,
      attachments,
      check,
      apiKey,
    });

  const teammate = await ctx.user({ name: "Teammate" });
  await ctx.orgMember(org._id, teammate._id, "member");
  await ctx.projectMember(project._id, teammate._id, "viewer");

  return { ctx, org, user, project, asUser, t, task, chat, started, upload, attach, asTeammate: ctx.asUser(teammate) };
}

describe("checks.results (OS-2291)", () => {
  test("an agent reports three statuses and a teammate sees them on the task", async () => {
    const { user, task, chat, started, upload, attach, asUser, asTeammate } = await setupLiveRun();
    const shot = await upload("shot");

    await attach({ key: "tests", status: "passed", note: "412 passed" });
    await attach({ key: "ui", status: "failed", note: "Button overlaps" }, [shot]);
    await attach({ key: "spec", status: "not_performed", note: "User asked to skip" });
    await attach({ key: "tests", status: "warning", note: "One flaky test" });

    const checks = await asTeammate.query(api.checks.checklists.getForTask, { taskId: task._id });
    expect(checks?.checks.map((check) => [check.key, check.results.map((result) => result.status)])).toEqual([
      ["tests", ["warning", "passed"]],
      ["ui", ["failed"]],
      ["spec", ["not_performed"]],
    ]);
    const ui = checks?.checks.find((check) => check.key === "ui")?.results[0];
    expect(ui).toMatchObject({
      messageId: started.assistantMessageId,
      threadId: chat._id,
      threadTitle: "Build the login page",
      reporterName: user.name,
      reportedByViewer: false,
      note: "Button overlaps",
      files: [{ storageId: shot.storageId, fileName: "shot.png" }],
    });
    expect(checks?.checks[0]?.instruction).toBe("Do tests");

    const own = await asUser.query(api.checks.checklists.getForTask, { taskId: task._id });
    expect(own?.checks[0]?.results[0]?.reportedByViewer).toBe(true);

    // The files still land on the reply, so the transcript keeps them.
    const groups = await asUser.query(api.cli.messages.listAgentAttachmentsByThread, { threadId: chat._id });
    expect(groups[0]?.attachments.map((attachment) => attachment.fileName)).toEqual(["shot.png"]);
  });

  test("a check outside the catalog needs a label and shows as Added", async () => {
    const { task, attach, asUser } = await setupLiveRun();

    await expect(attach({ key: "mobile", status: "passed" })).rejects.toThrow("Check 'mobile' is not in the catalog, so it needs a label");
    await attach({ key: "mobile", status: "passed", label: "Mobile layout" });

    const checks = await asUser.query(api.checks.checklists.getForTask, { taskId: task._id });
    expect(checks?.checks.map(({ key, label, added }) => ({ key, label, added }))).toEqual([
      { key: "tests", label: "All tests pass", added: false },
      { key: "ui", label: "UI verified", added: false },
      { key: "spec", label: "Spec updated", added: false },
      { key: "mobile", label: "Mobile layout", added: true },
    ]);
  });

  test("warning, failed and not performed need a note; a rejected report attaches nothing", async () => {
    const { t, started, upload, attach } = await setupLiveRun();
    const shot = await upload("shot");

    await expect(attach({ key: "ui", status: "failed" }, [shot])).rejects.toThrow("A failed check needs a note");
    await expect(attach({ key: "ui", status: "warning", note: "  " })).rejects.toThrow("A warning check needs a note");
    await expect(attach({ key: "ui", status: "not_performed" })).rejects.toThrow("A not performed check needs a note");
    await expect(attach({ key: "Bad Key", status: "passed" })).rejects.toThrow(/Check key must start/);

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliMessages", started.assistantMessageId))?.attachments ?? []).toEqual([]);
      expect(await runCtx.db.query("checkResults").collect()).toEqual([]);
    });
  });

  test("a Check with a result survives a switch to No checks, as Added", async () => {
    const { task, attach, asUser } = await setupLiveRun();
    await attach({ key: "ui", status: "passed" });

    await asUser.mutation(api.tasks.core.setChecklist, { taskId: task._id, checklistId: null });

    const checks = await asUser.query(api.checks.checklists.getForTask, { taskId: task._id });
    expect(checks?.checks.map(({ key, added }) => ({ key, added }))).toEqual([{ key: "ui", added: true }]);
  });

  test("file URLs are gated by task access, and the blob outlives the thread's refs", async () => {
    const { ctx, t, task, upload, attach, asTeammate } = await setupLiveRun();
    const shot = await upload("shot");
    const { checkResultId } = await attach({ key: "ui", status: "passed" }, [shot]);
    const resultId = checkResultId as Id<"checkResults">;

    const urls = await asTeammate.query(api.checks.results.getFileUrls, { resultId });
    expect(urls).toEqual([{ storageId: shot.storageId, url: expect.any(String) }]);
    const outsider = ctx.asUser(await ctx.user());
    expect(await outsider.query(api.checks.results.getFileUrls, { resultId })).toEqual([]);
    expect(await outsider.query(api.checks.checklists.getForTask, { taskId: task._id })).toBeNull();

    // Deleting the thread drops its message refs; the result's row keeps the blob.
    await t.run(async (runCtx) => {
      for (const ref of await runCtx.db.query("cliMessageAttachmentRefs").collect()) {
        await runCtx.db.delete("cliMessageAttachmentRefs", ref._id);
      }
      await deleteStorageIfUnreferenced(runCtx, shot.storageId);
      expect(await runCtx.db.system.get("_storage", shot.storageId)).not.toBeNull();
    });
  });

  test("permanently deleting the task deletes its results and their unreferenced blobs", async () => {
    const { t, task, upload, attach } = await setupLiveRun();
    const shot = await upload("shot");
    await attach({ key: "ui", status: "passed" }, [shot]);
    await t.run(async (runCtx) => {
      for (const ref of await runCtx.db.query("cliMessageAttachmentRefs").collect()) {
        await runCtx.db.delete("cliMessageAttachmentRefs", ref._id);
      }
    });

    await t.mutation(internal.tasks.core.permanentlyDelete, { taskId: task._id });

    await t.run(async (runCtx) => {
      expect(await runCtx.db.query("checkResults").collect()).toEqual([]);
      expect(await runCtx.db.query("checkResultFiles").collect()).toEqual([]);
      expect(await runCtx.db.system.get("_storage", shot.storageId)).toBeNull();
    });
  });
});

describe("checks on a thread with no task (OS-2293)", () => {
  test("results belong to the thread, which picks its own checklist; only thread viewers see them", async () => {
    const { ctx, project, chat, upload, attach, asUser, asTeammate } = await setupLiveRun({ withTask: false });
    const shot = await upload("shot");
    const { checkResultId } = await attach({ key: "ui", status: "passed" }, [shot]);

    const read = () => asUser.query(api.checks.checklists.getForThread, { threadId: chat._id });
    expect((await read())?.checks.map(({ key, added }) => ({ key, added }))).toEqual([{ key: "ui", added: true }]);

    const [feature] = await asUser.query(api.checks.checklists.list, { projectId: project._id });
    await asUser.mutation(api.cli.threads.core.setChecklist, { threadId: chat._id, checklistId: feature._id });
    const picked = await read();
    expect(picked?.checklistId).toBe(feature._id);
    expect(picked?.checklists.map((checklist) => checklist.isDefault)).toEqual([false]);
    expect(picked?.checks.map(({ key, results }) => [key, results.length])).toEqual([
      ["tests", 0],
      ["ui", 1],
      ["spec", 0],
    ]);
    await asUser.mutation(api.cli.threads.core.setChecklist, { threadId: chat._id, checklistId: null });
    expect((await read())?.checklistId).toBeNull();

    const resultId = checkResultId as Id<"checkResults">;
    expect(await asUser.query(api.checks.results.getFileUrls, { resultId })).toEqual([{ storageId: shot.storageId, url: expect.any(String) }]);
    expect(await asTeammate.query(api.checks.results.getFileUrls, { resultId })).toEqual([]);
    expect(await asTeammate.query(api.checks.checklists.getForThread, { threadId: chat._id })).toBeNull();
    await expect(asTeammate.mutation(api.cli.threads.core.setChecklist, { threadId: chat._id, checklistId: null })).rejects.toThrow();

    const other = await ctx.setupProject();
    const foreign = await other.asUser.mutation(api.checks.checklists.create, {
      projectId: other.project._id,
      name: "Elsewhere",
      checkKeys: [],
      taskTypeKeys: [],
    });
    await expect(asUser.mutation(api.cli.threads.core.setChecklist, { threadId: chat._id, checklistId: foreign })).rejects.toThrow(
      "Checklist must belong to the task's project"
    );
  });

  test("attaching a task moves the thread's results onto it; the newer result per check is current", async () => {
    const { t, task, chat, attach, asUser } = await setupLiveRun({ withTask: false });
    // The task's own results: one older and one newer than the thread's.
    const taskResult = (checkKey: string, reportedAt: number) =>
      t.run(async (runCtx) => {
        const thread = await runCtx.db.get("cliThreads", chat._id);
        await runCtx.db.insert("checkResults", {
          projectId: task.projectId,
          taskId: task._id,
          threadId: chat._id,
          messageId: (await runCtx.db.query("cliMessages").first())!._id,
          checkKey,
          label: checkKey,
          status: "failed",
          note: "from the task",
          files: [],
          threadTitle: thread!.title,
          threadOwnerId: thread!.userId,
          reportedAt,
        });
      });
    await taskResult("tests", 1);
    await attach({ key: "tests", status: "passed" });
    await attach({ key: "ui", status: "passed" });
    await taskResult("ui", Date.now() + 60_000);

    await asUser.mutation(api.cli.threads.core.attachTask, { threadId: chat._id, taskId: task._id });

    const checks = await asUser.query(api.checks.checklists.getForTask, { taskId: task._id });
    expect(checks?.checks.map(({ key, results }) => [key, results.map((result) => result.status)])).toEqual([
      ["tests", ["passed", "failed"]],
      ["ui", ["failed", "passed"]],
      ["spec", []],
    ]);
    // The thread now reads its task's Checks.
    expect(await asUser.query(api.checks.checklists.getForThread, { threadId: chat._id })).toEqual(checks);
  });

  test("a send that attaches a task moves the results too", async () => {
    const { task, chat, attach, asUser } = await setupLiveRun({ withTask: false });
    await attach({ key: "tests", status: "passed" });

    await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "next", taskId: task._id });

    const checks = await asUser.query(api.checks.checklists.getForTask, { taskId: task._id });
    expect(checks?.checks[0]?.results.map((result) => result.status)).toEqual(["passed"]);
  });

  test("deleting the thread deletes the results it owns, not its task's", async () => {
    const { t, task, chat, attach, asUser } = await setupLiveRun({ withTask: false });
    await attach({ key: "tests", status: "passed" });
    await asUser.mutation(api.cli.threads.core.attachTask, { threadId: chat._id, taskId: task._id });
    await attach({ key: "ui", status: "passed" });
    // One more the thread still owns, as if reported before the attach.
    await t.run(async (runCtx) => {
      const result = (await runCtx.db.query("checkResults").first())!;
      await runCtx.db.insert("checkResults", {
        projectId: result.projectId,
        threadId: result.threadId,
        messageId: result.messageId,
        checkKey: "spec",
        label: "Spec updated",
        status: "passed",
        files: [],
        threadTitle: result.threadTitle,
        threadOwnerId: result.threadOwnerId,
        reportedAt: result.reportedAt,
      });
    });

    await asUser.mutation(api.cli.threads.core.remove, { threadId: chat._id });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.query("checkResults").collect()).map((result) => [result.checkKey, result.taskId])).toEqual([
        ["tests", task._id],
        ["ui", task._id],
      ]);
    });
  });
});

describe("a result's value (OS-2385)", () => {
  test("a report carries a trimmed value; task and thread reads return it", async () => {
    const { task, chat, attach, asUser } = await setupLiveRun();
    await attach({ key: "tests", status: "warning", value: "  +3  ", note: "tasks.list reads labels per row" });
    await attach({ key: "ui", status: "passed", value: "   " });

    const checks = await asUser.query(api.checks.checklists.getForTask, { taskId: task._id });
    expect(checks?.checks.map((check) => check.results[0]?.value)).toEqual(["+3", undefined, undefined]);
    const byThread = await asUser.query(api.checks.checklists.getForThread, { threadId: chat._id });
    expect(byThread?.checks[0]?.results[0]?.value).toBe("+3");
  });

  test("a value does not replace a required note, and is capped at 500 characters", async () => {
    const { t, attach } = await setupLiveRun();

    await expect(attach({ key: "tests", status: "failed", value: "High" })).rejects.toThrow("A failed check needs a note");
    await expect(attach({ key: "tests", status: "passed", value: "x".repeat(501) })).rejects.toThrow(
      "Check value can be at most 500 characters"
    );
    await attach({ key: "tests", status: "passed", value: "x".repeat(500) });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.query("checkResults").collect()).map((result) => result.value?.length)).toEqual([500]);
    });
  });
});

describe("a result's artifact (OS-2385)", () => {
  const createArtifact = (as: Pick<ReturnType<ReturnType<typeof createTestContext>["asUser"]>, "mutation">, taskId: Id<"tasks">, name: string) =>
    as.mutation(api.tasks.artifacts.createTaskArtifact, { taskId, name, content: "# Cases" });

  test("an artifact on the result's task, or another task in the project, is recorded with its name", async () => {
    const { ctx, user, project, task, attach, asUser } = await setupLiveRun();
    const own = await createArtifact(asUser, task._id, "Test plan");
    const parent = await ctx.task(project._id, user._id);
    const shared = await createArtifact(asUser, parent._id, "Architecture");

    await attach({ key: "tests", status: "passed", value: "12 cases", artifactId: own });
    await attach({ key: "ui", status: "passed", artifactId: shared });

    const checks = await asUser.query(api.checks.checklists.getForTask, { taskId: task._id });
    expect(checks?.checks.slice(0, 2).map((check) => check.results[0])).toMatchObject([
      { artifactId: own, artifactName: "Test plan", value: "12 cases" },
      { artifactId: shared, artifactName: "Architecture" },
    ]);
  });

  test("an artifact the thread owner cannot read, or from another project, is rejected", async () => {
    const { ctx, org, user, project, t, attach, asUser } = await setupLiveRun();
    const sibling = await ctx.project(org._id, user._id);
    const siblingTask = await ctx.task(sibling._id, user._id);
    const elsewhere = await createArtifact(asUser, siblingTask._id, "Elsewhere");
    const stranger = await ctx.setupProject();
    const strangerTask = await ctx.task(stranger.project._id, stranger.user._id);
    const hidden = await createArtifact(stranger.asUser, strangerTask._id, "Hidden");
    const doomedTask = await ctx.task(project._id, user._id);
    const onDeletedTask = await createArtifact(asUser, doomedTask._id, "Gone");
    await t.run((runCtx) => runCtx.db.patch("tasks", doomedTask._id, { isDeleted: true }));

    await expect(attach({ key: "tests", status: "passed", artifactId: elsewhere })).rejects.toThrow("Artifact must belong to this project");
    await expect(attach({ key: "tests", status: "passed", artifactId: hidden })).rejects.toThrow(`Artifact '${hidden}' was not found`);
    await expect(attach({ key: "tests", status: "passed", artifactId: onDeletedTask })).rejects.toThrow(
      `Artifact '${onDeletedTask}' was not found`
    );
    await expect(attach({ key: "tests", status: "passed", artifactId: "not-an-id" })).rejects.toThrow("Artifact 'not-an-id' was not found");

    await t.run(async (runCtx) => {
      expect(await runCtx.db.query("checkResults").collect()).toEqual([]);
    });
  });
});

describe("pull request checks (OS-2400)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await stubGithubAppEnv();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const PR_1 = { owner: "acme", name: "repo-1", number: 1 };

  /** A connected repository with PR #1 at `head-1`, a Pull request checklist, and a live checks run on #1. */
  async function setupChecksRun() {
    const setup = await connectedProject();
    const { ctx, user, project, asUser, t } = setup;
    for (const key of ["risk", "backend"]) {
      await asUser.mutation(api.checks.definitions.create, { projectId: project._id, key, label: `Label ${key}`, instruction: "" });
    }
    await asUser.mutation(api.checks.checklists.create, {
      projectId: project._id,
      name: "PR",
      checkKeys: ["risk", "backend"],
      taskTypeKeys: [],
      pullRequests: true,
    });
    const { key: apiKey, id: apiKeyId } = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const profile = await ctx.cliProfile(user._id, project._id, { paths: [{ id: "repo", path: "/repo", label: "repo" }] });
    const session = await ctx.cliSession(profile._id, apiKeyId);
    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "repo",
      cliType: "codex",
      content: "Run the pull request checks",
      pullRequestUrl: "https://github.com/acme/repo-1/pull/1",
      pullRequestChecks: { headSha: "head-1" },
    });
    const [message] = await asUser.query(api.cli.messages.listUnprocessedUserMessages, { threadId });
    await t.mutation(api.cli.threads.runControl.claimThread, { threadId, sessionId: session._id, leaseMs: 60_000, apiKey });
    const started = await t.mutation(api.cli.messages.startRunResponse, {
      threadId,
      sessionId: session._id,
      userMessageIds: [message._id],
      apiKey,
    });
    const attach = (check: { key: string; status: "passed" | "warning" | "failed" | "not_performed"; note?: string; label?: string; value?: string }) =>
      t.mutation(api.cli.messages.attachToResponse, {
        threadId,
        messageId: started.assistantMessageId,
        sessionId: session._id,
        attachments: [],
        check,
        apiKey,
      });
    const push = (headSha: string) =>
      t.run(async (run) => {
        const row = await run.db.query("integrationPullRequests").withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", setup.repositoryId).eq("number", 1)).unique();
        await run.db.patch("integrationPullRequests", row!._id, { headSha });
      });
    return { ...setup, profile, threadId, attach, push };
  }

  test("a checks run reports on the PR's head; the card reads the results and marks them outdated after a push", async () => {
    const { ctx, org, project, asUser, threadId, attach, push } = await setupChecksRun();
    await attach({ key: "risk", status: "failed", note: "Touches auth" });

    const teammate = await ctx.user({ name: "Teammate" });
    await ctx.orgMember(org._id, teammate._id, "member");
    await ctx.projectMember(project._id, teammate._id, "viewer");
    const card = await ctx.asUser(teammate).query(api.checks.checklists.getForPullRequest, { projectId: project._id, ...PR_1 });
    expect(card?.pullRequest).toEqual({ headSha: "head-1" });
    expect(card?.checks.map((check) => [check.key, check.results.map((result) => [result.status, result.headSha])])).toEqual([
      ["risk", [["failed", "head-1"]]],
      ["backend", []],
    ]);
    expect(card?.checks[0]?.results[0]).toMatchObject({ reportedByViewer: false, threadId });

    // The thread's own reads (Checks tab, `convoy threads checks`) are the PR's.
    const forThread = await asUser.query(api.checks.checklists.getForThread, { threadId });
    expect(forThread?.checks[0]?.results.map((result) => result.status)).toEqual(["failed"]);

    await push("head-2");
    const pushed = await asUser.query(api.checks.checklists.getForPullRequest, { projectId: project._id, ...PR_1 });
    expect(pushed?.pullRequest).toEqual({ headSha: "head-2" });
    expect(pushed?.checks[0]?.results[0]?.headSha).toBe("head-1");
  });

  test("a task attached later neither owns the results nor moves them; deleting the thread keeps them", async () => {
    const { ctx, user, project, asUser, threadId, attach } = await setupChecksRun();
    const task = await ctx.task(project._id, user._id);
    await attach({ key: "risk", status: "failed", note: "Touches auth" });
    await asUser.mutation(api.cli.threads.core.attachTask, { threadId, taskId: task._id });
    await attach({ key: "risk", status: "passed" });

    expect((await asUser.query(api.checks.checklists.getForTask, { taskId: task._id }))?.checks).toEqual([]);
    expect((await asUser.query(api.checks.checklists.getForThread, { threadId }))?.checks[0]?.results).toHaveLength(2);

    await asUser.mutation(api.cli.threads.core.remove, { threadId });
    const card = await asUser.query(api.checks.checklists.getForPullRequest, { projectId: project._id, ...PR_1 });
    expect(card?.checks[0]?.results.map((result) => result.status)).toEqual(["passed", "failed"]);
  });

  test("the list reads each row's current result for its shown Checks, and file URLs follow project access", async () => {
    const { ctx, project, asUser, attach } = await setupChecksRun();
    const risk = (await asUser.query(api.checks.definitions.list, { projectId: project._id })).find((check) => check.key === "risk")!;
    await asUser.mutation(api.checks.definitions.update, { checkId: risk._id, showInPullRequestList: true });
    await attach({ key: "risk", status: "failed", note: "Touches auth" });
    await attach({ key: "backend", status: "passed" });
    const { checkResultId } = await attach({ key: "risk", status: "passed" });

    const rows = await asUser.query(api.checks.results.listForPullRequestList, { projectId: project._id, refs: ["acme/repo-1#1", "acme/repo-1#2"] });
    expect(rows).toEqual([
      { ref: "acme/repo-1#1", checks: [{ key: "risk", label: "Label risk", status: "passed", outdated: false }] },
      { ref: "acme/repo-1#2", checks: [] },
    ]);

    const outsider = await ctx.user();
    expect(await ctx.asUser(outsider).query(api.checks.results.listForPullRequestList, { projectId: project._id, refs: ["acme/repo-1#1"] })).toEqual([]);
    expect(await ctx.asUser(outsider).query(api.checks.checklists.getForPullRequest, { projectId: project._id, ...PR_1 })).toBeNull();
    expect(await ctx.asUser(outsider).query(api.checks.results.getFileUrls, { resultId: checkResultId! })).toEqual([]);
  });

  test("a checked row keeps a slot per shown Check, pending when unreported, and marks results from an older head", async () => {
    const { project, asUser, attach, push } = await setupChecksRun();
    for (const check of await asUser.query(api.checks.definitions.list, { projectId: project._id })) {
      await asUser.mutation(api.checks.definitions.update, { checkId: check._id, showInPullRequestList: true });
    }
    const list = () => asUser.query(api.checks.results.listForPullRequestList, { projectId: project._id, refs: ["acme/repo-1#1", "acme/repo-1#2"] });
    await attach({ key: "backend", status: "passed" });

    // Checklist order (risk, backend), so a column is the same Check on every row; #2 was never checked.
    expect(await list()).toEqual([
      {
        ref: "acme/repo-1#1",
        checks: [
          { key: "risk", label: "Label risk", status: "pending", outdated: false },
          { key: "backend", label: "Label backend", status: "passed", outdated: false },
        ],
      },
      { ref: "acme/repo-1#2", checks: [] },
    ]);

    await push("head-2");
    expect((await list())[0].checks.map((check) => [check.key, check.status, check.outdated])).toEqual([
      ["risk", "pending", false],
      ["backend", "passed", true],
    ]);
  });

  test("a checks run needs a PR stored in a connected repository", async () => {
    const { asUser, profile } = await setupChecksRun();
    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "repo",
        cliType: "codex",
        content: "Run",
        pullRequestUrl: "https://github.com/acme/repo-1/pull/99",
        pullRequestChecks: { headSha: "head-99" },
      })
    ).rejects.toThrow("Pull request checks need a pull request in a connected repository");
  });

  test("a launch names the head it checks; a PR that moved since is rejected", async () => {
    const { asUser, profile, push } = await setupChecksRun();
    await push("head-2");
    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "repo",
        cliType: "codex",
        content: "Run",
        pullRequestUrl: "https://github.com/acme/repo-1/pull/1",
        pullRequestChecks: { headSha: "head-1" },
      })
    ).rejects.toThrow("The pull request has new commits. Run the checks again.");
  });

  test("the card reads the PR's newest results, whatever their keys sort as", async () => {
    const { t, project, asUser, threadId, attach } = await setupChecksRun();
    await attach({ key: "risk", status: "passed" });
    // 500 older results for a key that sorts after "risk".
    await t.run(async (run) => {
      const result = (await run.db.query("checkResults").first())!;
      for (let index = 0; index < 500; index++) {
        await run.db.insert("checkResults", { ...omitSystem(result), checkKey: "zeta", label: "Zeta", reportedAt: index });
      }
    });
    const card = await asUser.query(api.checks.checklists.getForPullRequest, { projectId: project._id, ...PR_1 });
    expect(card?.checks.find((check) => check.key === "risk")?.results).toHaveLength(1);
    expect(threadId).toBeDefined();
  });

  test("each result publishes a check run named by its Check on its head; the Overview's GitHub checks leave them out (OS-2401)", async () => {
    const { t, project, asUser, repositoryId, github, attach } = await setupChecksRun();
    github.state.pulls.get(1)![0].checkRuns = [{ id: 1, name: "ci", status: "completed", conclusion: "success", app: { id: 999 } }];
    for (const [key, label] of [["tests", "Tests"], ["docs", "Docs"]]) {
      await asUser.mutation(api.checks.definitions.create, { projectId: project._id, key, label, instruction: "" });
    }
    await attach({ key: "risk", status: "passed", value: "Low" });
    await attach({ key: "backend", status: "warning", note: "One new index" });
    await attach({ key: "tests", status: "failed", note: "2 failing" });
    await attach({ key: "docs", status: "not_performed", note: "No docs here" });
    await drain(t, 5_000);

    // The four publishes run in parallel, so GitHub sees them in any order.
    const runs = github.state.createdCheckRuns.map(({ head_sha, name, conclusion, output }) => [head_sha, name, conclusion, output]);
    expect(runs).toHaveLength(4);
    expect(runs).toEqual(
      expect.arrayContaining([
        ["head-1", "Label risk", "success", { title: "Low", summary: "Low" }],
        ["head-1", "Label backend", "neutral", { title: "Warning", summary: "One new index" }],
        ["head-1", "Tests", "failure", { title: "Failed", summary: "2 failing" }],
        ["head-1", "Docs", "skipped", { title: "Not performed", summary: "No docs here" }],
      ])
    );
    const overview = await asUser.action(api.integrations.github.pullRequests.readOverview, {
      projectId: project._id,
      repositoryId,
      number: 1,
      baseSha: "base",
      headSha: "head-1",
    });
    // Flagged, not dropped: the GitHub checks card hides them, Merge status counts them as GitHub does.
    expect(overview.checks.filter((check) => !check.fromConvoy).map((check) => check.name)).toEqual(["ci"]);
    expect(overview.checks.filter((check) => check.fromConvoy)).toHaveLength(4);

    // GitHub orders runs by report time, keys them by Check, and links Details to the PR in Convoy.
    const risk = github.state.createdCheckRuns.find((run) => run.name === "Label risk")!;
    const result = await t.run((run) => run.db.query("checkResults").filter((q) => q.eq(q.field("checkKey"), "risk")).first());
    expect(risk.completed_at).toBe(new Date(result!.reportedAt).toISOString());
    expect(risk.external_id).toBe("risk");
    const org = await t.run((run) => run.db.get("organizations", project.organizationId));
    expect(risk.details_url).toBe(`${getAppUrlBase()}/o/${org!.slug}/${project.alias}/pull-requests?repo=${repositoryId}&pr=1`);
  });

  test("an off-catalog result stays in Convoy: the agent cannot name a check run on GitHub (OS-2401)", async () => {
    const { t, project, asUser, github, attach } = await setupChecksRun();
    await attach({ key: "build", status: "passed", label: "build" });
    await drain(t, 5_000);
    expect(github.state.createdCheckRuns).toEqual([]);
    const card = await asUser.query(api.checks.checklists.getForPullRequest, { projectId: project._id, ...PR_1 });
    expect(card?.checks.find((check) => check.key === "build")?.results[0]?.githubPublishError).toBeUndefined();
  });

  test("each GitHub failure records its own reason (OS-2401)", async () => {
    const { t, github, attach } = await setupChecksRun();
    const cases: [RegExp, number, string][] = [
      [/^POST \/app\/installations\/77\/access_tokens$/, 422, githubErrors.CHECK_RUN_REFUSED],
      [/^POST \/repositories\/1\/check-runs$/, 404, githubErrors.ACCESS_REMOVED],
      [/^POST \/repositories\/1\/check-runs$/, 429, githubErrors.GITHUB_RATE_LIMITED],
      [/^POST \/repositories\/1\/check-runs$/, 502, githubErrors.GITHUB_UNAVAILABLE],
    ];
    for (const [match, status, reason] of cases) {
      github.state.failures.push({ match, status });
      await attach({ key: "risk", status: "passed" });
      await drain(t, 3_000);
      const result = await t.run((run) => run.db.query("checkResults").order("desc").first());
      expect([status, result?.githubPublishError]).toEqual([status, reason]);
    }
    expect(github.state.createdCheckRuns).toEqual([]);
  });

  test("a publish GitHub refuses keeps the result and shows why on the card; the next run publishes again (OS-2401)", async () => {
    const { t, project, asUser, github, attach } = await setupChecksRun();
    github.state.failures.push({ match: /^POST \/repositories\/1\/check-runs$/, status: 403 });
    await attach({ key: "risk", status: "failed", note: "Touches auth" });
    await drain(t, 5_000);
    const refused = await asUser.query(api.checks.checklists.getForPullRequest, { projectId: project._id, ...PR_1 });
    expect(refused?.checks[0]?.results.map((result) => [result.status, result.githubPublishError])).toEqual([
      ["failed", githubErrors.CHECK_RUN_REFUSED],
    ]);
    expect(github.state.createdCheckRuns).toEqual([]);

    await attach({ key: "risk", status: "passed" });
    await drain(t, 5_000);
    const rerun = await asUser.query(api.checks.checklists.getForPullRequest, { projectId: project._id, ...PR_1 });
    expect(rerun?.checks[0]?.results.map((result) => [result.status, result.githubPublishError])).toEqual([
      ["passed", undefined],
      ["failed", githubErrors.CHECK_RUN_REFUSED],
    ]);
    expect(github.state.createdCheckRuns.map((run) => run.conclusion)).toEqual(["success"]);
  });

  test("a body GitHub rejects is logged with its status, since nothing else sees it (OS-2401)", async () => {
    const { t, github, attach } = await setupChecksRun();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    github.state.failures.push({ match: /^POST \/repositories\/1\/check-runs$/, status: 422 });
    await attach({ key: "risk", status: "passed" });
    await drain(t, 3_000);
    expect(logged).toHaveBeenCalledWith("Publishing a check run failed", expect.objectContaining({ status: 422 }));
    logged.mockRestore();
  });

  test("a repository disconnected before the publish runs records why instead of calling GitHub (OS-2401)", async () => {
    const { t, github, repositoryLinkId, attach } = await setupChecksRun();
    await attach({ key: "risk", status: "passed" });
    await t.run((run) => run.db.patch("integrationRepositoryLinks", repositoryLinkId, { status: "disconnected" }));
    await drain(t, 5_000);
    const result = await t.run((run) => run.db.query("checkResults").first());
    expect(result?.githubPublishError).toBe(githubErrors.NOT_CONNECTED);
    expect(github.state.createdCheckRuns).toEqual([]);
  });

  test("the list takes at most 100 refs a call", async () => {
    const { project, asUser } = await setupChecksRun();
    const refs = Array.from({ length: 101 }, (_, index) => `acme/repo-1#${index + 1}`);
    await expect(asUser.query(api.checks.results.listForPullRequestList, { projectId: project._id, refs })).rejects.toThrow(
      "Ask for at most 100 pull requests at a time"
    );
  });
});

function omitSystem<T extends { _id: unknown; _creationTime: unknown }>({ _id, _creationTime, ...rest }: T) {
  void _id;
  void _creationTime;
  return rest;
}
