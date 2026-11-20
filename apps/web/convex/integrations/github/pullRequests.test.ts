/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../_generated/api";
import { connectedProject, drain, fakePullRequest, signedWebhook, stubGithubAppEnv, type FakeGithub } from "../../../convex-testing/github";
import { errors } from "./errors";

beforeEach(async () => {
  vi.useFakeTimers();
  await stubGithubAppEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function pull(github: FakeGithub, number: number) {
  return github.state.pulls.get(1)!.find((candidate) => candidate.number === number)!;
}

function edit(github: FakeGithub, number: number, patch: Partial<ReturnType<typeof fakePullRequest>>) {
  const pr = pull(github, number);
  Object.assign(pr, { updatedAt: pr.updatedAt + 60_000 }, patch);
}

const refresh = (t: Parameters<typeof signedWebhook>[0], number: number) =>
  signedWebhook(t, "pull_request", { action: "edited", installation: { id: 77 }, repository: { id: 1 }, pull_request: { number } });

describe("stored PR metadata", () => {
  test("stacks and archives come from every read; conflicts only from single-PR reads", async () => {
    const stack = (position: number) => ({ id: 9, number: 12, size: 2, position });
    const { project, asUser, repositoryId, github, t } = await connectedProject([
      fakePullRequest(1, { stack: stack(1) }),
      fakePullRequest(2, { stack: stack(2), archived: true }),
      fakePullRequest(3),
    ]);
    const list = async () =>
      (
        await asUser.query(api.integrations.github.pullRequests.list, {
          projectId: project._id,
          tab: "open",
          sort: "created",
          order: "asc",
          paginationOpts: { numItems: 10, cursor: null },
        })
      ).page.map(({ number, stack, archived, conflicts }) => ({ number, position: stack?.position, archived, conflicts }));
    // The import reads list pages, which carry no mergeability.
    expect(await list()).toEqual([
      { number: 1, position: 1, archived: false, conflicts: false },
      { number: 2, position: 2, archived: true, conflicts: false },
      { number: 3, position: undefined, archived: false, conflicts: false },
    ]);

    edit(github, 3, { mergeable: false });
    await refresh(t, 3);
    await drain(t, 5000);
    expect((await list())[2].conflicts).toBe(true);

    // GitHub still computing after a push keeps the last answer; leaving the stack clears it.
    edit(github, 3, { mergeable: null, title: "Pushed" });
    edit(github, 1, { stack: undefined });
    await refresh(t, 3);
    await refresh(t, 1);
    // The second refresh waits for the first one's lease.
    await drain(t, 20_000);
    const rows = await list();
    expect(rows[2].conflicts).toBe(true);
    expect(rows[0].position).toBeUndefined();

    expect(
      (await asUser.query(api.integrations.github.pullRequests.stack, { projectId: project._id, repositoryId, stackId: 9 })).map(
        (layer) => layer.number
      )
    ).toEqual([2]);
  });

  test("the stack map lists Layers bottom first, and another project sees none", async () => {
    const stack = (position: number) => ({ id: 9, number: 12, size: 3, position });
    const { ctx, org, user, project, asUser, repositoryId } = await connectedProject([
      fakePullRequest(5, { stack: stack(3) }),
      fakePullRequest(6, { stack: stack(1) }),
      fakePullRequest(7, { stack: stack(2) }),
      fakePullRequest(8),
    ]);
    const layers = await asUser.query(api.integrations.github.pullRequests.stack, { projectId: project._id, repositoryId, stackId: 9 });
    expect(layers.map((layer) => layer.number)).toEqual([6, 7, 5]);
    const other = await ctx.project(org._id, user._id);
    expect(await asUser.query(api.integrations.github.pullRequests.stack, { projectId: other._id, repositoryId, stackId: 9 })).toEqual([]);
  });
});

describe("referenced tasks", () => {
  test("refs in the title, branch, and labels match across the organization; the description never does", async () => {
    const { ctx, org, user, project, asUser, repositoryId, github, t } = await connectedProject();
    const [first, second, third, described] = await ctx.tasks(project._id, user._id, 4);
    const sibling = await ctx.project(org._id, user._id);
    const siblingTask = await ctx.task(sibling._id, user._id);
    const alias = project.alias.toLowerCase();
    edit(github, 1, {
      title: `Fix ${project.alias}-${first.refNumber}: reader`,
      headRef: `feature/${alias}-${second.refNumber}-tabs`,
      labels: [`${project.alias}-${third.refNumber}`, `${sibling.alias}-${siblingTask.refNumber}`],
      body: `Also ${project.alias}-${described.refNumber}`,
    });
    await refresh(t, 1);
    await drain(t, 5000);
    const tasks = await asUser.query(api.integrations.github.pullRequests.referencedTasks, { projectId: project._id, repositoryId, number: 1 });
    expect(tasks.map((task) => task._id)).toEqual([first._id, second._id, third._id, siblingTask._id]);
  });

  test("a task in a project the member can't open stays hidden, and longer words don't match", async () => {
    const { ctx, org, user, project, asUser, repositoryId, github, t } = await connectedProject();
    const outsider = await ctx.user();
    const hidden = await ctx.project(org._id, outsider._id);
    const hiddenTask = await ctx.task(hidden._id, outsider._id);
    const task = await ctx.task(project._id, user._id);
    edit(github, 1, {
      title: `${hidden.alias}-${hiddenTask.refNumber} and X${project.alias}-${task.refNumber} and ${project.alias}-${task.refNumber}0`,
    });
    await refresh(t, 1);
    await drain(t, 5000);
    expect(await asUser.query(api.integrations.github.pullRequests.referencedTasks, { projectId: project._id, repositoryId, number: 1 })).toEqual([]);
  });
});

const HUNK = "@@ -1,2 +1,3 @@\n line one\n-old two\n+new two\n+new three";

describe("reading the overview", () => {
  test("returns commits, checks under GitHub's rollup states, reviews, comments, and how far behind the base is", async () => {
    const { project, asUser, repositoryId } = await connectedProject([
      fakePullRequest(1, {
        behindBy: 2,
        requestedReviewers: ["maya"],
        commits: [{ sha: "c1", message: "Add reader\n\nLong body", login: null, name: "Robin", date: "2026-11-01T10:00:00Z" }],
        reviews: [
          { id: 1, login: "alex", state: "APPROVED", submitted_at: "2026-11-01T11:00:00Z" },
          { id: 2, login: "sam", state: "PENDING", submitted_at: "2026-11-01T11:00:00Z" },
        ],
        comments: [{ id: 3, login: "maya", body: "Looks good", created_at: "2026-11-01T12:00:00Z" }],
        assignees: ["robin"],
        milestone: { title: "v1", number: 3 },
        reviewComments: [
          { id: 6, login: "sam", body: "Rename this", path: "src/a.ts", line: 3, created_at: "2026-11-01T12:30:00Z", diff_hunk: HUNK },
          {
            id: 7,
            login: "sam",
            body: "Outdated",
            path: "src/b.ts",
            line: null,
            original_line: 9,
            side: "LEFT",
            created_at: "2026-11-01T12:31:00Z",
            diff_hunk: "@@ -8,2 +8,1 @@\n kept\n-gone",
          },
          { id: 8, login: "sam", body: "These two", path: "src/a.ts", start_line: 2, line: 3, created_at: "2026-11-01T12:32:00Z", diff_hunk: HUNK },
        ],
        checkRuns: [
          { id: 1, name: "test", status: "completed", conclusion: "success", title: "All green" },
          { id: 2, name: "lint", status: "completed", conclusion: "failure" },
          { id: 3, name: "skip", status: "completed", conclusion: "skipped" },
          { id: 4, name: "e2e", status: "in_progress", conclusion: null },
        ],
        statuses: [{ id: 5, context: "deploy", state: "error", description: "Build failed" }],
      }),
    ]);
    const overview = await asUser.action(api.integrations.github.pullRequests.readOverview, { projectId: project._id, repositoryId, number: 1, baseSha: "base", headSha: "head-1" });
    expect(overview).toMatchObject({ headSha: "head-1", baseRef: "main", mergeable: "clean", behindBy: 2, commitCount: 1, requestedReviewers: ["maya"] });
    expect(overview.commits).toEqual([expect.objectContaining({ sha: "c1", message: "Add reader", author: "Robin" })]);
    expect(overview.checks.map((check) => [check.name, check.state, check.summary])).toEqual([
      ["test", "success", "All green"],
      ["lint", "failure", "failure"],
      ["skip", "success", "skipped"],
      ["e2e", "pending", "in_progress"],
      ["deploy", "failure", "Build failed"],
    ]);
    expect(overview.reviews.map((review) => [review.author, review.state, review.authorAvatarUrl])).toEqual([
      ["alex", "approved", "https://avatars.githubusercontent.com/alex"],
    ]);
    expect(overview.comments).toEqual([
      expect.objectContaining({ author: "maya", authorAvatarUrl: "https://avatars.githubusercontent.com/maya", body: "Looks good" }),
    ]);
    expect(overview.assignees).toEqual([{ login: "robin", avatarUrl: "https://avatars.githubusercontent.com/robin" }]);
    expect(overview.milestone).toEqual({ title: "v1", url: "https://github.com/milestone/3" });
    // An outdated comment keeps the line it was left on.
    expect(overview.reviewComments.map(({ author, body, path, line, url }) => ({ author, body, path, line, url }))).toEqual([
      { author: "sam", body: "Rename this", path: "src/a.ts", line: 3, url: "https://github.com/rc/6" },
      { author: "sam", body: "Outdated", path: "src/b.ts", line: 9, url: "https://github.com/rc/7" },
      { author: "sam", body: "These two", path: "src/a.ts", line: 3, url: "https://github.com/rc/8" },
    ]);
    // The quote is the commented lines, cut from the end of GitHub's diff hunk and numbered on the commented side.
    expect(overview.reviewComments.map((comment) => comment.quote)).toEqual([
      [{ kind: "add", number: 3, text: "new three" }],
      [{ kind: "del", number: 9, text: "gone" }],
      [
        { kind: "add", number: 2, text: "new two" },
        { kind: "add", number: 3, text: "new three" },
      ],
    ]);
  });

  test("a PR pushed before or during the read asks for a refresh instead of mixing revisions", async () => {
    const { project, asUser, repositoryId, github } = await connectedProject();
    const read = (headSha: string) =>
      asUser.action(api.integrations.github.pullRequests.readOverview, { projectId: project._id, repositoryId, number: 1, baseSha: "base", headSha });
    await expect(read("head-0")).rejects.toThrow(errors.PULL_REQUEST_CHANGED);
    // The push lands while the commits are read.
    const pr = github.state.pulls.get(1)![0];
    let pushed = false;
    pr.commits = [];
    Object.defineProperty(pr, "commits", {
      get: () => {
        if (!pushed) {
          pushed = true;
          pr.headSha = "head-2";
        }
        return [];
      },
    });
    await expect(read("head-1")).rejects.toThrow(errors.PULL_REQUEST_CHANGED);
  });

  test("a base that moved before or during the read asks for a refresh too, and behind-by compares the displayed base", async () => {
    const { project, asUser, repositoryId, github } = await connectedProject([fakePullRequest(1, { behindBy: 3 })]);
    const read = (baseSha: string) =>
      asUser.action(api.integrations.github.pullRequests.readOverview, { projectId: project._id, repositoryId, number: 1, baseSha, headSha: "head-1" });
    await expect(read("base-0")).rejects.toThrow(errors.PULL_REQUEST_CHANGED);
    expect((await read("base")).behindBy).toBe(3);
    expect(github.state.requests).toContain("GET /repositories/1/compare/base...head-1");
    const pr = github.state.pulls.get(1)![0];
    let moved = false;
    Object.defineProperty(pr, "commits", {
      get: () => {
        if (!moved) {
          moved = true;
          pr.baseSha = "base-2";
        }
        return [];
      },
    });
    await expect(read("base")).rejects.toThrow(errors.PULL_REQUEST_CHANGED);
  });

  test("a deleted base branch leaves behind-by unknown", async () => {
    const { project, asUser, repositoryId, github } = await connectedProject();
    github.state.failures.push({ match: /compare/, status: 404 });
    const overview = await asUser.action(api.integrations.github.pullRequests.readOverview, { projectId: project._id, repositoryId, number: 1, baseSha: "base", headSha: "head-1" });
    expect(overview.behindBy).toBeNull();
    expect(overview).toMatchObject({ assignees: [], milestone: null, reviewComments: [] });
  });

  test("live mergeability that differs from the stored mark schedules a refresh", async () => {
    const { project, asUser, repositoryId, github, t } = await connectedProject();
    github.state.pulls.get(1)![0].mergeable = false;
    const overview = await asUser.action(api.integrations.github.pullRequests.readOverview, { projectId: project._id, repositoryId, number: 1, baseSha: "base", headSha: "head-1" });
    expect(overview.mergeable).toBe("conflicting");
    await drain(t, 5000);
    const pr = await asUser.query(api.integrations.github.pullRequests.list, {
      projectId: project._id,
      tab: "open",
      sort: "created",
      order: "asc",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(pr.page[0].conflicts).toBe(true);
  });

  test("readMergeability re-reads only the PR, and answers null once the revision moved", async () => {
    const { project, asUser, repositoryId, github } = await connectedProject();
    const read = (headSha: string) =>
      asUser.action(api.integrations.github.pullRequests.readMergeability, { projectId: project._id, repositoryId, number: 1, baseSha: "base", headSha });
    const pr = github.state.pulls.get(1)![0];
    Object.assign(pr, { mergeable: null });
    expect(await read("head-1")).toEqual({ mergeable: "unknown", mergeBlock: null });
    Object.assign(pr, { mergeable: true, mergeableState: "behind" });
    const before = github.state.requests.length;
    expect(await read("head-1")).toEqual({ mergeable: "clean", mergeBlock: "behind" });
    expect(github.state.requests.slice(before).filter((request) => request.includes("/repositories/"))).toEqual(["GET /repositories/1/pulls/1"]);
    expect(await read("head-0")).toBeNull();
  });

  test("another project cannot read it", async () => {
    const { ctx, org, user, repositoryId, asUser } = await connectedProject();
    const other = await ctx.project(org._id, user._id);
    await expect(
      asUser.action(api.integrations.github.pullRequests.readOverview, { projectId: other._id, repositoryId, number: 1, baseSha: "base", headSha: "head-1" })
    ).rejects.toThrow(errors.NOT_CONNECTED);
  });
});

describe("reading a whole file", () => {
  test("text, binary, too large, and missing files", async () => {
    const { project, asUser, repositoryId, github } = await connectedProject();
    const read = (path: string) =>
      asUser.action(api.integrations.github.pullRequests.readFile, { projectId: project._id, repositoryId, number: 1, path, ref: "head-1" });
    github.state.contents.set("1:head-1:src/a b.ts", "export const b = 1;\n");
    github.state.contents.set("1:head-1:logo.png", "PNG\u0000data");
    github.state.contents.set("1:head-1:big.txt", "x".repeat(1024 * 1024 + 1));
    expect(await read("src/a b.ts")).toEqual({ kind: "text", contents: "export const b = 1;\n" });
    expect(await read("logo.png")).toEqual({ kind: "binary" });
    expect(await read("big.txt")).toEqual({ kind: "tooLarge" });
    await expect(read("missing.ts")).rejects.toThrow(errors.FILE_NOT_FOUND);
  });

  test("another project cannot read it", async () => {
    const { ctx, org, user, repositoryId, asUser, github } = await connectedProject();
    github.state.contents.set("1:head-1:a.ts", "secret");
    const other = await ctx.project(org._id, user._id);
    await expect(
      asUser.action(api.integrations.github.pullRequests.readFile, { projectId: other._id, repositoryId, number: 1, path: "a.ts", ref: "head-1" })
    ).rejects.toThrow(errors.NOT_CONNECTED);
  });
});

describe("attached pull requests", () => {
  test("getAttached matches the project's connected repository by name, case-insensitively", async () => {
    const { project, asUser } = await connectedProject([fakePullRequest(1, { title: "Fix billing" })]);
    const get = (owner: string, name: string, number: number) =>
      asUser.query(api.integrations.github.pullRequests.getAttached, { projectId: project._id, owner, name, number });

    expect((await get("ACME", "Repo-1", 1))?.title).toBe("Fix billing");
    expect(await get("acme", "repo-1", 2)).toBeNull();
    expect(await get("contoso", "repo-1", 1)).toBeNull();
  });
});
