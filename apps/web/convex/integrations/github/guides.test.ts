/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import { connectedProject, fakePullRequest, stubGithubAppEnv } from "../../../convex-testing/github";
import type { Id } from "../../_generated/dataModel";
import { RETENTION_MS } from "./lib/integrationRepositoryLinksRepo";

beforeEach(async () => {
  vi.useFakeTimers();
  await stubGithubAppEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const FILES = [
  { filename: "convex/schema.ts", status: "modified", additions: 3, deletions: 0, sha: "blob-schema" },
  { filename: "src/reader.tsx", status: "added", additions: 40, deletions: 0, sha: "blob-reader" },
];

const step = (title: string, paths: string[]) => ({ title, explanation: `${title}, explained.`, files: paths.map((path) => ({ path })) });

/** PR #1 at `head-1` with two files, and a Guide run on it by the project's owner. */
async function setupGuideRun() {
  const setup = await connectedProject([fakePullRequest(1, { files: FILES }), fakePullRequest(2)]);
  const { ctx, user, project, asUser, t, repositoryId } = setup;
  const { key: apiKey, id: apiKeyId } = await asUser.mutation(api.apiKeys.core.create, { name: "CLI Key", expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
  const profile = await ctx.cliProfile(user._id, project._id, { paths: [{ id: "repo", path: "/repo", label: "repo" }] });
  const session = await ctx.cliSession(profile._id, apiKeyId);
  const request = (headSha = "head-1", number = 1, retryGuideId?: Id<"integrationPullRequestGuides">, guidePrompt?: string) =>
    asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "repo",
      cliType: "codex",
      cliModel: "gpt-5",
      content: "Write a guide",
      pullRequestUrl: `https://github.com/acme/repo-1/pull/${number}`,
      pullRequestGuide: { headSha, retryGuideId, guidePrompt },
    });
  const threadId = await request();
  /** Update guide: a run at `headSha` that follows up `baseGuideId`; with `retryGuideId`, a Retry of a failed one. */
  const requestFollowUp = (baseGuideId: Id<"integrationPullRequestGuides">, headSha = "head-2", retryGuideId?: Id<"integrationPullRequestGuides">) =>
    asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "repo",
      cliType: "codex",
      content: "Update the guide",
      pullRequestUrl: "https://github.com/acme/repo-1/pull/1",
      pullRequestGuide: { headSha, baseGuideId, retryGuideId },
    });
  const submit = (steps: unknown[], headSha = "head-1", thread = threadId) =>
    t.action(api.integrations.github.guides.submit, { threadId: thread, headSha, steps, apiKey });
  const reportFailure = (failure: string, thread = threadId) => t.action(api.integrations.github.guides.submit, { threadId: thread, failure, apiKey });
  /** One CLI run of the thread's queued messages, ended by `complete` (optionally parked) or `fail`. */
  const runOnce = async (end: { parked?: boolean; error?: string } = {}, thread = threadId) => {
    await t.mutation(api.cli.threads.runControl.claimThread, { threadId: thread, sessionId: session._id, leaseMs: 60_000, apiKey });
    const userMessageIds = await t.run(async (run) =>
      (await run.db.query("cliMessages").withIndex("by_thread", (q) => q.eq("threadId", thread)).collect())
        .filter((message) => message.role === "user" && !message.processedAt)
        .map((message) => message._id)
    );
    const { assistantMessageId: messageId } = await t.mutation(api.cli.messages.startRunResponse, { threadId: thread, sessionId: session._id, userMessageIds, apiKey });
    if (end.error) {
      await t.mutation(api.cli.messages.fail, { messageId, sessionId: session._id, errorMessage: end.error, apiKey });
    } else {
      await t.mutation(api.cli.messages.complete, { messageId, sessionId: session._id, apiKey, ...(end.parked ? { chatStatus: "waiting_input" as const } : {}) });
    }
  };
  const list = (as = asUser) => as.query(api.integrations.github.guides.listForPullRequest, { projectId: project._id, repositoryId, number: 1 });
  const push = (headSha: string) =>
    t.run(async (run) => {
      const row = await run.db.query("integrationPullRequests").withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", repositoryId).eq("number", 1)).unique();
      await run.db.patch("integrationPullRequests", row!._id, { headSha });
    });
  const member = async () => {
    const other = await ctx.user();
    await ctx.orgMember(setup.org._id, other._id, "member");
    await ctx.projectMember(project._id, other._id, "member");
    return Object.assign(ctx.asUser(other), { user: other });
  };
  return { ...setup, apiKey, profile, threadId, request, requestFollowUp, submit, reportFailure, runOnce, list, push, member };
}

describe("guides", () => {
  test("a run writes the guide: Convoy names a missing file, then stores each file's blob", async () => {
    const { threadId, submit, list, asUser, member } = await setupGuideRun();
    const [writing] = (await list())!;
    expect(writing).toMatchObject({ status: "writing", headSha: "head-1", baseSha: "base", cliType: "codex", cliModel: "gpt-5", threadId, canDelete: true });
    expect(writing.requester.isViewer).toBe(true);

    expect(await submit([step("Schema", ["convex/schema.ts"])])).toEqual({
      status: "rejected",
      errors: ["src/reader.tsx is not in any step. Every changed file belongs to exactly one step."],
    });
    expect(await submit([step("Schema", ["convex/schema.ts"]), step("Reader", ["src/reader.tsx"])])).toEqual({ status: "accepted", guideId: writing._id });

    const guide = await asUser.query(api.integrations.github.guides.get, { guideId: writing._id });
    expect(guide?.status).toBe("ready");
    expect(guide?.steps.map((item) => item.files)).toEqual([[{ path: "convex/schema.ts", sha: "blob-schema" }], [{ path: "src/reader.tsx", sha: "blob-reader" }]]);

    // Another member reads it, without the requester's private thread.
    const other = await member();
    const [seen] = (await list(other))!;
    expect(seen).toMatchObject({ status: "ready", canDelete: false, requester: { isViewer: false } });
    expect(seen.threadId).toBeUndefined();
    expect((await other.query(api.integrations.github.guides.get, { guideId: writing._id }))?.steps).toHaveLength(2);

    await expect(submit([step("Again", ["convex/schema.ts", "src/reader.tsx"])])).rejects.toThrow("This guide was already submitted.");
  });

  test("a ready guide keeps its steps apart, so the menu reads none; a delete removes them too", async () => {
    const { submit, list, asUser, t } = await setupGuideRun();
    const [writing] = (await list())!;
    await submit([step("All", ["convex/schema.ts", "src/reader.tsx"])]);
    expect(await t.run((run) => run.db.get("integrationPullRequestGuides", writing._id))).not.toHaveProperty("steps");
    expect(await t.run((run) => run.db.query("integrationPullRequestGuideSteps").collect())).toHaveLength(1);
    await asUser.mutation(api.integrations.github.guides.remove, { guideId: writing._id });
    expect(await t.run((run) => run.db.query("integrationPullRequestGuideSteps").collect())).toEqual([]);
  });

  test("a step of the wrong shape comes back in the error list", async () => {
    const { t, threadId, apiKey } = await setupGuideRun();
    const steps = [{ title: "All", explanation: "x", attention: { kind: "danger", note: "x" }, files: [{ path: "convex/schema.ts" }, { path: "src/reader.tsx" }] }];
    expect(await t.action(api.integrations.github.guides.submit, { threadId, headSha: "head-1", steps, apiKey })).toEqual({
      status: "rejected",
      errors: ["Step 1's attention kind must be tradeoff, contract, product, risk, or accessibility."],
    });
  });

  test("a request names the stored PR's head in a connected repository", async () => {
    const { request, push } = await setupGuideRun();
    await expect(request("head-1", 99)).rejects.toThrow("Guides need a pull request in a connected repository");
    await push("head-2");
    await expect(request("head-1")).rejects.toThrow("The pull request has new commits. Generate the guide again.");
  });

  test("after a push during the run, the guide is checked against its own revision", async () => {
    const { github, submit, push } = await setupGuideRun();
    Object.assign(github.state.pulls.get(1)![0], { headSha: "head-2", files: [...FILES, { filename: "late.ts", status: "added", additions: 1, deletions: 0 }] });
    await push("head-2");
    github.state.compares.set("base...head-1", FILES);
    expect(await submit([step("All", ["convex/schema.ts", "src/reader.tsx"])])).toMatchObject({ status: "accepted" });
  });

  test("only the requester or an admin deletes a guide; a deleted guide refuses its submit", async () => {
    const { list, asUser, member, submit } = await setupGuideRun();
    const [guide] = (await list())!;
    const other = await member();
    await expect(other.mutation(api.integrations.github.guides.remove, { guideId: guide._id })).rejects.toThrow(
      "Only the requester and project admins can delete a guide"
    );
    await asUser.mutation(api.integrations.github.guides.remove, { guideId: guide._id });
    expect(await list()).toEqual([]);
    await expect(submit([step("All", ["convex/schema.ts", "src/reader.tsx"])])).rejects.toThrow("The guide was deleted.");
  });

  test("a thread that is not a guide run cannot submit one", async () => {
    const { asUser, profile, apiKey, t } = await setupGuideRun();
    const plain = await asUser.mutation(api.cli.threads.core.create, { profileId: profile._id, pathId: "repo", cliType: "codex", content: "Hi" });
    await expect(t.action(api.integrations.github.guides.submit, { threadId: plain, headSha: "head-1", steps: [], apiKey })).rejects.toThrow(
      "This thread is not writing a guide."
    );
  });

  test("someone outside the project neither reads nor deletes a guide", async () => {
    const { ctx, list } = await setupGuideRun();
    const [guide] = (await list())!;
    const outsider = ctx.asUser(await ctx.user());
    expect(await list(outsider)).toBeNull();
    expect(await outsider.query(api.integrations.github.guides.get, { guideId: guide._id })).toBeNull();
    await expect(outsider.mutation(api.integrations.github.guides.remove, { guideId: guide._id })).rejects.toThrow("The guide was deleted.");
  });

  test("a project admin deletes a member's guide", async () => {
    const { ctx, project, asUser, list, member } = await setupGuideRun();
    const other = await member();
    const profile = await ctx.cliProfile(other.user._id, project._id, { paths: [{ id: "repo", path: "/repo", label: "repo" }] });
    await other.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "repo",
      cliType: "codex",
      content: "Write a guide",
      pullRequestUrl: "https://github.com/acme/repo-1/pull/1",
      pullRequestGuide: { headSha: "head-1" },
    });
    const [theirs] = (await list())!;
    expect(theirs).toMatchObject({ requester: { isViewer: false }, canDelete: true });
    expect(theirs.threadId).toBeUndefined();
    await asUser.mutation(api.integrations.github.guides.remove, { guideId: theirs._id });
    expect((await list())!).toHaveLength(1);
  });

  test("another user's API key cannot submit the requester's guide", async () => {
    const { t, threadId, member } = await setupGuideRun();
    const other = await member();
    const { key } = await other.mutation(api.apiKeys.core.create, { name: "Theirs", expiresAt: Date.now() + 60_000 });
    await expect(
      t.action(api.integrations.github.guides.submit, { threadId, headSha: "head-1", steps: [step("All", ["convex/schema.ts", "src/reader.tsx"])], apiKey: key })
    ).rejects.toThrow("This thread is not writing a guide.");
  });

  test("the requester's key scoped to another project cannot submit", async () => {
    const { ctx, t, org, user, asUser, threadId } = await setupGuideRun();
    const other = await ctx.project(org._id, user._id);
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Other project",
      expiresAt: Date.now() + 60_000,
      scope: { organizationId: org._id, projectIds: [other._id] },
    });
    await expect(
      t.action(api.integrations.github.guides.submit, { threadId, headSha: "head-1", steps: [step("All", ["convex/schema.ts", "src/reader.tsx"])], apiKey: key })
    ).rejects.toThrow("Permission denied: cli:thread");
  });

  test("a submit after the repository was disconnected is refused", async () => {
    const { asUser, project, repositoryLinkId, submit } = await setupGuideRun();
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    await expect(submit([step("All", ["convex/schema.ts", "src/reader.tsx"])])).rejects.toThrow("This project has no connected repository");
  });

  test("a PR with more than 100 files is read page by page", async () => {
    const { github, submit } = await setupGuideRun();
    const files = Array.from({ length: 150 }, (_, index) => ({ filename: `f${index}.ts`, status: "added", additions: 1, deletions: 0, sha: `blob-${index}` }));
    github.state.pulls.get(1)![0].files = files;
    const paths = files.map((file) => file.filename);
    expect(await submit([step("Most", paths.slice(0, 149))])).toEqual({
      status: "rejected",
      errors: ["f149.ts is not in any step. Every changed file belongs to exactly one step."],
    });
    expect(await submit([step("All", paths)])).toMatchObject({ status: "accepted" });
  });

  test("a run that ends without a submit fails the guide; waiting for input does not; a later submit still lands", async () => {
    const { asUser, threadId, list, runOnce, submit } = await setupGuideRun();
    await runOnce({ parked: true });
    expect((await list())![0].status).toBe("writing");
    await asUser.mutation(api.cli.messages.send, { threadId, content: "Go on" });
    await runOnce();
    const [failed] = (await list())!;
    expect(failed).toMatchObject({ status: "failed", failureReason: "The run ended before a guide was submitted." });
    expect(await submit([step("All", ["convex/schema.ts", "src/reader.tsx"])])).toEqual({ status: "accepted", guideId: failed._id });
    const [ready] = (await list())!;
    expect(ready.status).toBe("ready");
    expect(ready.failureReason).toBeUndefined();
  });

  test("a run that fails takes its error to the guide", async () => {
    const { list, runOnce } = await setupGuideRun();
    await runOnce({ error: "Codex exited with code 1" });
    expect((await list())![0]).toMatchObject({ status: "failed", failureReason: "Codex exited with code 1" });
  });

  test("Stop fails the guide", async () => {
    const { asUser, threadId, list } = await setupGuideRun();
    await asUser.mutation(api.cli.threads.runControl.cancelProcessing, { threadId });
    expect((await list())![0]).toMatchObject({ status: "failed", failureReason: "Response stopped by user" });
  });

  test("the agent reports why it cannot write the guide, and the run's end keeps that reason", async () => {
    const { list, reportFailure, runOnce, submit } = await setupGuideRun();
    const [guide] = (await list())!;
    expect(await reportFailure("  /repo is not a clone of acme/repo-1  ")).toEqual({ status: "accepted", guideId: guide._id });
    await runOnce();
    expect((await list())![0]).toMatchObject({ status: "failed", failureReason: "/repo is not a clone of acme/repo-1" });
    await expect(reportFailure(" ")).rejects.toThrow("Say why the guide could not be written.");
    await submit([step("All", ["convex/schema.ts", "src/reader.tsx"])]);
    await expect(reportFailure("Too late")).rejects.toThrow("This guide was already submitted.");
  });

  test("Retry re-points the same failed guide to a new thread", async () => {
    const { threadId, list, reportFailure, request, submit, push } = await setupGuideRun();
    const [guide] = (await list())!;
    await expect(request("head-1", 1, guide._id)).rejects.toThrow("Only a failed guide can be retried");
    await reportFailure("Not a clone");
    await push("head-2");
    const retryThreadId = await request("head-2", 1, guide._id);
    const guides = (await list())!;
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ _id: guide._id, status: "writing", headSha: "head-2", threadId: retryThreadId });
    expect(guides[0].failureReason).toBeUndefined();
    // The first thread no longer writes it.
    await expect(submit([step("All", ["convex/schema.ts", "src/reader.tsx"])], "head-1", threadId)).rejects.toThrow("This thread is not writing a guide.");
  });

  test("a submit already past its checks when Retry re-points the guide does not land on the retry", async () => {
    const { t, threadId, apiKey, list, reportFailure, request } = await setupGuideRun();
    const old = await t.query(internal.integrations.github.guides.getSubmitContext, { threadId, apiKey });
    await reportFailure("Not a clone");
    await request("head-1", 1, old.guideId);
    const steps = [step("All", ["convex/schema.ts", "src/reader.tsx"])].map((item) => ({ ...item, questions: [] }));
    await expect(
      t.mutation(internal.integrations.github.guides.complete, { guideId: old.guideId, threadId: old.threadId, repositoryLinkId: old.repositoryLinkId, generation: old.generation, steps })
    ).rejects.toThrow("This thread is not writing a guide.");
    await expect(t.mutation(internal.integrations.github.guides.fail, { guideId: old.guideId, threadId: old.threadId, reason: "late" })).rejects.toThrow(
      "This thread is not writing a guide."
    );
    expect((await list())![0].status).toBe("writing");
  });

  test("a retried guide lists as the newest", async () => {
    const { list, reportFailure, request } = await setupGuideRun();
    const [first] = (await list())!;
    await reportFailure("Not a clone");
    vi.advanceTimersByTime(1000);
    await request();
    vi.advanceTimersByTime(1000);
    await request("head-1", 1, first._id);
    expect((await list())![0]._id).toBe(first._id);
  });

  test("only the requester retries, and only on the guide's own pull request", async () => {
    const { ctx, project, list, reportFailure, request, member } = await setupGuideRun();
    const [guide] = (await list())!;
    await reportFailure("Not a clone");
    await expect(request("head-2", 2, guide._id)).rejects.toThrow("This guide is for another pull request");
    const other = await member();
    const profile = await ctx.cliProfile(other.user._id, project._id, { paths: [{ id: "repo", path: "/repo", label: "repo" }] });
    await expect(
      other.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "repo",
        cliType: "codex",
        content: "Write a guide",
        pullRequestUrl: "https://github.com/acme/repo-1/pull/1",
        pullRequestGuide: { headSha: "head-1", retryGuideId: guide._id },
      })
    ).rejects.toThrow("Only the requester can retry a guide");
  });

  test("an admin sets the Guide prompt and Reset to default clears it; a member only reads it", async () => {
    const { asUser, project, member } = await setupGuideRun();
    const args = { projectId: project._id };
    expect(await asUser.query(api.integrations.github.guides.getPrompt, args)).toBeNull();
    await asUser.mutation(api.integrations.github.guides.setPrompt, { ...args, prompt: "  Be brief.  " });
    const other = await member();
    expect(await other.query(api.integrations.github.guides.getPrompt, args)).toBe("Be brief.");
    await expect(other.mutation(api.integrations.github.guides.setPrompt, { ...args, prompt: "Mine" })).rejects.toThrow();
    await expect(asUser.mutation(api.integrations.github.guides.setPrompt, { ...args, prompt: "x".repeat(8001) })).rejects.toThrow(
      "The Guide prompt is too long: at most 8,000 characters."
    );
    await asUser.mutation(api.integrations.github.guides.setPrompt, { ...args, prompt: " " });
    expect(await asUser.query(api.integrations.github.guides.getPrompt, args)).toBeNull();
    await asUser.mutation(api.integrations.github.guides.setPrompt, { ...args, prompt: "Again" });
    await asUser.mutation(api.integrations.github.guides.setPrompt, { ...args, prompt: null });
    expect(await asUser.query(api.integrations.github.guides.getPrompt, args)).toBeNull();
  });

  test("someone outside the project neither reads nor sets the Guide prompt", async () => {
    const { ctx, asUser, project } = await setupGuideRun();
    await asUser.mutation(api.integrations.github.guides.setPrompt, { projectId: project._id, prompt: "Secret" });
    const outsider = ctx.asUser(await ctx.user());
    expect(await outsider.query(api.integrations.github.guides.getPrompt, { projectId: project._id })).toBeNull();
    await expect(outsider.mutation(api.integrations.github.guides.setPrompt, { projectId: project._id, prompt: "Mine" })).rejects.toThrow();
  });

  test("each guide stores the Guide prompt its composer was seeded with, a retry its own", async () => {
    const { asUser, project, list, request, reportFailure, t } = await setupGuideRun();
    const snapshots = async () =>
      (await t.run((run) => run.db.query("integrationPullRequestGuidePrompts").collect())).map(({ guideId, prompt }) => ({ guideId, prompt }));
    // Written with the built-in default: nothing stored.
    const [first] = (await list())!;
    expect(await snapshots()).toEqual([]);

    // An admin changes the setting while the composer is open: the Guide keeps what the agent got.
    await asUser.mutation(api.integrations.github.guides.setPrompt, { projectId: project._id, prompt: "Changed meanwhile." });
    await reportFailure("Not a clone");
    await request("head-1", 1, first._id, "Be brief.");
    expect(await snapshots()).toEqual([{ guideId: first._id, prompt: "Be brief." }]);

    const second = await request("head-2", 2, undefined, "Be briefer.");
    const secondGuide = await t.run((run) => run.db.query("integrationPullRequestGuides").withIndex("by_threadId", (q) => q.eq("threadId", second)).unique());
    expect(await snapshots()).toEqual([
      { guideId: first._id, prompt: "Be brief." },
      { guideId: secondGuide!._id, prompt: "Be briefer." },
    ]);
    await expect(request("head-2", 2, undefined, "x".repeat(8001))).rejects.toThrow("The Guide prompt is too long: at most 8,000 characters.");

    // A retry under the default drops the old snapshot; a delete drops the guide's own.
    const [retried] = (await list())!;
    await reportFailure("Again", retried.threadId!);
    await request("head-1", 1, first._id);
    await asUser.mutation(api.integrations.github.guides.remove, { guideId: secondGuide!._id });
    expect(await snapshots()).toEqual([]);
  });

  test("a follow-up copies Unchanged steps from its base, and lists the base steps it left out as Removed", async () => {
    const { github, submit, push, list, asUser, requestFollowUp } = await setupGuideRun();
    const [base] = (await list())!;
    await submit([step("Schema", ["convex/schema.ts"]), step("Reader", ["src/reader.tsx"])]);
    // A push changes the reader and adds a file.
    Object.assign(github.state.pulls.get(1)![0], {
      headSha: "head-2",
      files: [FILES[0], { ...FILES[1], sha: "blob-reader-2" }, { filename: "src/flag.ts", status: "added", additions: 1, deletions: 0, sha: "blob-flag" }],
    });
    await push("head-2");
    const followUpThread = await requestFollowUp(base._id);
    const [followUp] = (await list())!;
    expect(followUp).toMatchObject({ status: "writing", headSha: "head-2", base: { guideId: base._id, headSha: "head-1", requester: { isViewer: true } } });

    expect(await submit([{ unchangedFrom: 2 }, step("Schema", ["convex/schema.ts"]), step("Flag", ["src/flag.ts"])], "head-2", followUpThread)).toEqual({
      status: "rejected",
      errors: ["Step 1 copies base step 2, but src/reader.tsx changed since the base guide. Write the step out with updatedFrom and whatChanged."],
    });
    expect(await submit([{ unchangedFrom: 1 }, step("Flag", ["src/reader.tsx", "src/flag.ts"])], "head-2", followUpThread)).toMatchObject({ status: "accepted" });

    const [ready] = (await list())!;
    expect(ready.changes).toEqual({ unchanged: 1, updated: 0, added: 1, removed: 1 });
    const guide = await asUser.query(api.integrations.github.guides.get, { guideId: followUp._id });
    expect(guide?.removedStepTitles).toEqual(["Reader"]);
    expect(guide?.steps.map(({ title, change }) => [title, change])).toEqual([
      ["Schema", "unchanged"],
      ["Flag", "new"],
    ]);
  });

  test("a follow-up's base is a ready guide of the same pull request", async () => {
    const { list, requestFollowUp } = await setupGuideRun();
    const [writing] = (await list())!;
    await expect(requestFollowUp(writing._id, "head-1")).rejects.toThrow("A follow-up builds on a ready guide of this pull request");
  });

  test("a follow-up whose base was deleted during its run is submitted as a plain guide", async () => {
    const { github, submit, push, list, asUser, requestFollowUp } = await setupGuideRun();
    const [base] = (await list())!;
    await submit([step("All", ["convex/schema.ts", "src/reader.tsx"])]);
    Object.assign(github.state.pulls.get(1)![0], { headSha: "head-2" });
    await push("head-2");
    const followUpThread = await requestFollowUp(base._id);
    await asUser.mutation(api.integrations.github.guides.remove, { guideId: base._id });
    expect(await submit([{ unchangedFrom: 1 }], "head-2", followUpThread)).toEqual({
      status: "rejected",
      errors: [
        "Step 1 copies a base guide step, but this guide has no base guide. Write the step out in full.",
        "convex/schema.ts is not in any step. Every changed file belongs to exactly one step.",
        "src/reader.tsx is not in any step. Every changed file belongs to exactly one step.",
      ],
    });
    expect(await submit([step("All", ["convex/schema.ts", "src/reader.tsx"])], "head-2", followUpThread)).toMatchObject({ status: "accepted" });
    const [ready] = (await list())!;
    expect(ready.base).toBeUndefined();
    expect(ready.changes).toBeUndefined();
  });

  test("Retry of a follow-up takes the base it is given, or none", async () => {
    const { submit, push, list, requestFollowUp, request, reportFailure } = await setupGuideRun();
    const [base] = (await list())!;
    await submit([step("All", ["convex/schema.ts", "src/reader.tsx"])]);
    await push("head-2");
    const followUpThread = await requestFollowUp(base._id);
    const [followUp] = (await list())!;
    await reportFailure("Not a clone", followUpThread);
    await requestFollowUp(base._id, "head-2", followUp._id);
    expect((await list())![0]).toMatchObject({ _id: followUp._id, status: "writing", base: { guideId: base._id } });
    await reportFailure("Not a clone", (await list())![0].threadId);
    await request("head-2", 1, followUp._id);
    expect((await list())![0].base).toBeUndefined();
  });

  test("the retention purge deletes the project's guides", async () => {
    const { asUser, project, repositoryLinkId, t, submit } = await setupGuideRun();
    await submit([step("All", ["convex/schema.ts", "src/reader.tsx"])]);
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    vi.setSystemTime(Date.now() + RETENTION_MS + 1);
    await t.mutation(internal.integrations.github.core.purge, { repositoryLinkId, generation: 2 });
    expect(await t.run((run) => run.db.query("integrationPullRequestGuides").take(1))).toEqual([]);
    expect(await t.run((run) => run.db.query("integrationPullRequestGuideSteps").take(1))).toEqual([]);
  });
});
