/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import {
  authorizedSetup,
  connectedProject,
  drain,
  fakePullRequest,
  linkGithubAccount,
  listTitles,
  stubGithubAppEnv,
  type T,
} from "../../../convex-testing/github";
import type { Id } from "../../_generated/dataModel";

// Closed history and live search (docs/specs/github-integration.md#lists-history-and-search).

beforeEach(async () => {
  vi.useFakeTimers();
  await stubGithubAppEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** `count` closed PRs numbered from `from`; every other one merged. */
const closedPulls = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => fakePullRequest(from + index, { state: "closed", merged: index % 2 === 0 }));

const storedNumbers = (t: T) =>
  t.run(async (run) => (await run.db.query("integrationPullRequests").collect()).map((row) => row.number).sort((a, b) => a - b));

describe("closed history", () => {
  test("opening Closed imports the newest page; Load more imports the next, until GitHub runs out", async () => {
    const { project, asUser, t, github } = await connectedProject([fakePullRequest(1), ...closedPulls(100, 45)]);
    const closed = () => listTitles(asUser, project._id, { tab: "closed" });
    const load = (more: boolean) => asUser.mutation(api.integrations.github.pullRequests.loadHistory, { projectId: project._id, more });
    const history = async () => (await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.connections[0]?.repository.history;
    expect(await closed()).toEqual([]);
    expect(await history()).toMatchObject({ started: false, complete: false, loading: false });

    await load(false);
    expect(await history()).toMatchObject({ started: false, complete: false, loading: true });
    await drain(t);
    const firstPage = await closed();
    expect(firstPage).toHaveLength(30);
    expect(firstPage[0]).toBe("PR 144");
    expect(await history()).toMatchObject({ started: true, complete: false, loading: false });

    // Opening Closed again imports nothing more.
    github.state.requests.length = 0;
    await load(false);
    await drain(t);
    expect(github.state.requests).toEqual([]);

    await load(true);
    await drain(t);
    expect(await closed()).toHaveLength(45);
    expect(await history()).toMatchObject({ started: true, complete: true, loading: false });
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]?.repository.closedCount).toBe(45);
  });

  test("a closed PR reopened between pages shifts the next page up without skipping a PR", async () => {
    const { project, asUser, t, github } = await connectedProject([fakePullRequest(1), ...closedPulls(100, 35)]);
    const load = (more: boolean) => asUser.mutation(api.integrations.github.pullRequests.loadHistory, { projectId: project._id, more });
    await load(false);
    await drain(t);
    // Page 1 held 134..105; reopening 134 moves 104 onto page 1, ahead of page 2's offset.
    Object.assign(github.state.pulls.get(1)!.find((pr) => pr.number === 134)!, { state: "open", updatedAt: Date.now() });
    await load(true);
    await drain(t);
    expect(await storedNumbers(t)).toContain(104);
  });

  test("more reopens than a page holds walk the next page back until it meets the covered rows", async () => {
    const { project, asUser, t, github } = await connectedProject([fakePullRequest(1), ...closedPulls(100, 95)]);
    const load = (more: boolean) => asUser.mutation(api.integrations.github.pullRequests.loadHistory, { projectId: project._id, more });
    await load(false);
    await drain(t);
    await load(true);
    await drain(t);
    // Pages 1 and 2 held 194..135; reopening 164..194 moves 134 to page 1, out of pages 2 and 3.
    for (const pr of github.state.pulls.get(1)!.filter((candidate) => candidate.number >= 164)) {
      Object.assign(pr, { state: "open", updatedAt: Date.now() });
    }
    await load(true);
    await drain(t);
    expect(await storedNumbers(t)).toContain(134);
    while (!(await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.connections[0]?.repository.history.complete) {
      await load(true);
      await drain(t);
    }
    expect((await storedNumbers(t)).filter((number) => number >= 100)).toHaveLength(95);
  });

  test("two sessions opening Closed at once import the page once, one row per PR", async () => {
    const { ctx, org, project, asUser, t, github } = await connectedProject([fakePullRequest(1), ...closedPulls(100, 40)]);
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const asViewer = ctx.asUser(viewer);
    github.state.requests.length = 0;
    await Promise.all(
      [asUser, asViewer].map((session) => session.mutation(api.integrations.github.pullRequests.loadHistory, { projectId: project._id, more: false }))
    );
    await drain(t);
    expect(github.state.requests.filter((request) => request === "GET /repositories/1/pulls")).toHaveLength(1);
    const numbers = await storedNumbers(t);
    expect(numbers).toHaveLength(31);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(await listTitles(asViewer, project._id, { tab: "closed" })).toHaveLength(30);
  });

  test("a repository with less history imported holds back the merged list", async () => {
    const setup = await connectedProject([fakePullRequest(1), ...closedPulls(100, 35)]);
    const { project, asUser, t, github } = setup;
    // Repository 2's closed PRs are older than all of repository 1's.
    github.addRepository({ id: 2, name: "repo-2" }, closedPulls(10, 5));
    const setupId = await authorizedSetup(asUser, project._id);
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [2], removeRepositoryLinkIds: [] });
    await drain(t);
    const load = (more: boolean) => asUser.mutation(api.integrations.github.pullRequests.loadHistory, { projectId: project._id, more });

    await load(false);
    await drain(t);
    // Repository 2 is complete, but repository 1 covers only its newest 30, so older rows wait.
    const first = await listTitles(asUser, project._id, { tab: "closed" });
    expect(first).toHaveLength(30);
    expect(first).not.toContain("PR 10");

    github.state.requests.length = 0;
    await load(true);
    await drain(t);
    // Only the repository holding the list back pages on.
    expect(github.state.requests.filter((request) => request.endsWith("/pulls"))).toEqual(["GET /repositories/1/pulls", "GET /repositories/1/pulls"]);
    expect(await listTitles(asUser, project._id, { tab: "closed" })).toHaveLength(40);
  });

  test("once history started, reconciliation stores an old closed PR that changed, so the list keeps it", async () => {
    const { project, asUser, t, github } = await connectedProject([fakePullRequest(1), ...closedPulls(100, 35)]);
    await asUser.mutation(api.integrations.github.pullRequests.loadHistory, { projectId: project._id, more: false });
    await drain(t);
    expect(await storedNumbers(t)).not.toContain(101);
    vi.advanceTimersByTime(60_000);
    // A comment on an old closed PR moves it above the covered time without a pull_request webhook.
    Object.assign(github.state.pulls.get(1)!.find((pr) => pr.number === 101)!, { updatedAt: Date.now() });
    await t.mutation(internal.integrations.github.sync.reconcile, {});
    await drain(t);
    expect((await listTitles(asUser, project._id, { tab: "closed" }))[0]).toBe("PR 101");
  });

  test("another project's repository id loads nothing", async () => {
    const { ctx, org, user, asUser, t, github, repositoryId } = await connectedProject([fakePullRequest(1), ...closedPulls(100, 5)]);
    const other = await ctx.project(org._id, user._id);
    github.state.requests.length = 0;
    await asUser.mutation(api.integrations.github.pullRequests.loadHistory, { projectId: other._id, repositoryId, more: false });
    await drain(t);
    expect(github.state.requests).toEqual([]);
  });
});

describe("reading a PR Convoy never stored", () => {
  test("readDiff returns the live PR and writes no metadata", async () => {
    const { project, asUser, t, repositoryId, github } = await connectedProject([fakePullRequest(1)]);
    github.state.pulls.get(1)!.push(fakePullRequest(7, { state: "closed", merged: true, title: "Old fix" }));
    const diff = await asUser.action(api.integrations.github.pullRequests.readDiff, { projectId: project._id, repositoryId, number: 7 });
    expect(diff.pullRequest).toMatchObject({ number: 7, title: "Old fix", state: "merged", repositoryId });
    await drain(t);
    expect(await storedNumbers(t)).toEqual([1]);
  });
});

describe("search", () => {
  async function search(
    session: Awaited<ReturnType<typeof connectedProject>>["asUser"],
    projectId: Id<"projects">,
    query: string,
    page = 1
  ) {
    return session.action(api.integrations.github.pullRequests.search, { projectId, query, sort: "updated", order: "desc", page });
  }

  test("finds unimported PRs in the project's repositories, without writing metadata", async () => {
    const { project, asUser, t, github, repositoryId } = await connectedProject([fakePullRequest(1, { title: "Fix login" })]);
    github.state.pulls.get(1)!.push(fakePullRequest(7, { state: "closed", merged: true, title: "Fix old login bug" }));
    const result = await search(asUser, project._id, "login fix");
    expect(result.pullRequests.map(({ number, state, repositoryId: id }) => ({ number, state, id }))).toEqual([
      { number: 7, state: "merged", id: repositoryId },
      { number: 1, state: "open", id: repositoryId },
    ]);
    expect(result).toMatchObject({ hasMore: false, incomplete: false, failures: [] });
    await drain(t);
    expect(await storedNumbers(t)).toEqual([1]);
  });

  test("You filters add the Linked GitHub account's login, and search nothing without one", async () => {
    const { org, project, asUser, github } = await connectedProject([fakePullRequest(1, { title: "Fix" })]);
    const args = { projectId: project._id, query: "fix", sort: "updated", order: "desc", page: 1, author: "me", assignee: "me" } as const;
    expect((await asUser.action(api.integrations.github.pullRequests.search, args)).pullRequests).toEqual([]);
    expect(github.state.searches).toEqual([]);

    await linkGithubAccount(asUser, github, org._id, { id: 42, login: "maya" });
    await asUser.action(api.integrations.github.pullRequests.search, args);
    expect(github.state.searches).toEqual(['is:pr repo:acme/repo-1 author:maya assignee:maya "fix"']);
  });

  test("query syntax cannot widen the scope, and other repositories' hits are dropped", async () => {
    const { project, asUser, github } = await connectedProject([fakePullRequest(1, { title: "Fix" })]);
    github.addRepository({ id: 9, owner: "evil", name: "secret", installationId: 88 }, [fakePullRequest(5, { title: "Fix secret" })]);
    github.state.extraSearchItems.push({
      number: 5,
      title: "Fix secret",
      state: "open",
      user: { login: "x" },
      labels: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      repository_url: "https://api.github.com/repos/evil/secret",
      pull_request: { merged_at: null },
    });
    const result = await search(asUser, project._id, 'fix repo:evil/secret "OR" is:issue');
    expect(github.state.searches).toEqual(['is:pr repo:acme/repo-1 "fix" "repo:evil/secret" "OR" "is:issue"']);
    expect(result.pullRequests).toEqual([]);
    expect((await search(asUser, project._id, "fix")).pullRequests.map((pr) => pr.number)).toEqual([1]);
  });

  test("GitHub's incomplete answer is labeled, and a project without access finds nothing", async () => {
    const { ctx, org, user, project, asUser, github } = await connectedProject([fakePullRequest(1, { title: "Fix" })]);
    github.state.searchIncomplete = true;
    expect(await search(asUser, project._id, "fix")).toMatchObject({ incomplete: true });
    const other = await ctx.project(org._id, user._id);
    github.state.searches.length = 0;
    expect((await search(asUser, other._id, "fix")).pullRequests).toEqual([]);
    expect(github.state.searches).toEqual([]);
  });
});
