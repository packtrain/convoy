/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import { connectedProject, fakePullRequest, stubGithubAppEnv } from "../../../convex-testing/github";
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
  const { key: apiKey } = await asUser.mutation(api.apiKeys.core.create, { name: "CLI Key", expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
  const profile = await ctx.cliProfile(user._id, project._id, { paths: [{ id: "repo", path: "/repo", label: "repo" }] });
  const request = (headSha = "head-1", number = 1) =>
    asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "repo",
      cliType: "codex",
      cliModel: "gpt-5",
      content: "Write a guide",
      pullRequestUrl: `https://github.com/acme/repo-1/pull/${number}`,
      pullRequestGuide: { headSha },
    });
  const threadId = await request();
  const submit = (steps: ReturnType<typeof step>[], headSha = "head-1", thread = threadId) =>
    t.action(api.integrations.github.guides.submit, { threadId: thread, headSha, steps, apiKey });
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
  return { ...setup, apiKey, profile, threadId, request, submit, list, push, member };
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
