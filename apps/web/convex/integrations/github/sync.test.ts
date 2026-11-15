/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import {
  authorizedSetup,
  connectedProject,
  drain,
  fakePullRequest,
  listTitles,
  signedWebhook,
  stubGithubAppEnv,
  type FakeGithub,
} from "../../../convex-testing/github";

beforeEach(async () => {
  vi.useFakeTimers();
  await stubGithubAppEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function editPull(github: FakeGithub, repositoryId: number, number: number, patch: Partial<ReturnType<typeof fakePullRequest>>) {
  const pr = github.state.pulls.get(repositoryId)!.find((candidate) => candidate.number === number)!;
  Object.assign(pr, { updatedAt: Date.now() }, patch);
}

/** A project with repositories 1 (PRs 1, 2) and 2 (PRs 3, 4 merged, 5 closed). */
async function twoRepositoryProject() {
  const setup = await connectedProject();
  setup.github.addRepository({ id: 2, name: "repo-2" }, [
    fakePullRequest(3),
    fakePullRequest(4, { state: "closed", merged: true }),
    fakePullRequest(5, { state: "closed" }),
  ]);
  const setupId = await authorizedSetup(setup.asUser, setup.project._id);
  const [secondLinkId] = await setup.asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [2], removeRepositoryLinkIds: [] });
  await drain(setup.t);
  const second = await setup.t.run((run) => run.db.get("integrationRepositoryLinks", secondLinkId));
  return { ...setup, secondLinkId, secondRepositoryId: second!.repositoryId };
}

async function runReconciliation(t: Awaited<ReturnType<typeof connectedProject>>["t"]) {
  await t.mutation(internal.integrations.github.sync.reconcile, {});
  await drain(t);
}

describe("the pull request list", () => {
  test("merges repositories, splits Open from Closed, and filters by repository", async () => {
    const { project, asUser, github, t, secondRepositoryId } = await twoRepositoryProject();
    // The import never stores closed PRs; a webhook for a tracked PR that closed does.
    editPull(github, 2, 3, { state: "closed", merged: true });
    await signedWebhook(t, "pull_request", { installation: { id: 77 }, repository: { id: 2 }, pull_request: { number: 3 } });
    await drain(t);

    expect(await listTitles(asUser, project._id)).toEqual(["PR 2", "PR 1"]);
    // Closed lists nothing until its history is imported.
    expect(await listTitles(asUser, project._id, { tab: "closed" })).toEqual([]);
    await asUser.mutation(api.integrations.github.pullRequests.loadHistory, { projectId: project._id, more: false });
    await drain(t);
    expect(await listTitles(asUser, project._id, { tab: "closed" })).toEqual(["PR 3", "PR 5", "PR 4"]);
    expect(await listTitles(asUser, project._id, { sort: "created", order: "asc" })).toEqual(["PR 1", "PR 2"]);
    expect(await listTitles(asUser, project._id, { tab: "closed", repositoryId: secondRepositoryId })).toEqual(["PR 3", "PR 5", "PR 4"]);
    expect(await listTitles(asUser, project._id, { repositoryId: secondRepositoryId })).toEqual([]);
  });

  test("updated sort merges both repositories by update time", async () => {
    const { project, asUser, github, t } = await twoRepositoryProject();
    editPull(github, 1, 1, { title: "PR 1 edited" });
    await signedWebhook(t, "pull_request", { installation: { id: 77 }, repository: { id: 1 }, pull_request: { number: 1 } });
    await drain(t);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 1 edited", "PR 3", "PR 2"]);
  });

  test("another project's repository id lists nothing", async () => {
    const { ctx, org, user, project, asUser, github, t } = await connectedProject();
    github.addRepository({ id: 2 }, [fakePullRequest(3)]);
    const other = await ctx.project(org._id, user._id);
    const setupId = await authorizedSetup(asUser, other._id);
    const [linkId] = await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [2], removeRepositoryLinkIds: [] });
    await drain(t);
    const link = await t.run((run) => run.db.get("integrationRepositoryLinks", linkId));
    expect(await listTitles(asUser, other._id)).toEqual(["PR 3"]);
    expect(await listTitles(asUser, project._id, { repositoryId: link!.repositoryId })).toEqual([]);
  });

  test("each repository counts its open and closed PRs", async () => {
    const { project, asUser, github, t } = await twoRepositoryProject();
    editPull(github, 1, 1, { state: "closed" });
    await signedWebhook(t, "pull_request", { installation: { id: 77 }, repository: { id: 1 }, pull_request: { number: 1 } });
    await drain(t);
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections.map(({ repository }) => [repository.name, repository.openCount, repository.closedCount])).toEqual(
      expect.arrayContaining([
        ["repo-1", 1, 1],
        ["repo-2", 1, 0],
      ])
    );
  });

  test("a repository from before the counters counts its rows on its next sync", async () => {
    const { project, asUser, t, repositoryId } = await connectedProject();
    await t.run((run) => run.db.patch("integrationRepositories", repositoryId, { openCount: undefined, closedCount: undefined }));
    await runReconciliation(t);
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]?.repository).toMatchObject({ openCount: 2, closedCount: 0 });
  });
});

describe("reconciliation", () => {
  test("repairs a missed edit and a missed close, without importing closed history", async () => {
    const { project, asUser, github, t } = await connectedProject([fakePullRequest(1), fakePullRequest(2), fakePullRequest(3)]);
    vi.advanceTimersByTime(60_000);
    editPull(github, 1, 1, { title: "PR 1 edited" });
    editPull(github, 1, 2, { state: "closed" });
    github.state.pulls.get(1)!.push(fakePullRequest(9, { state: "closed", updatedAt: Date.now() }));

    await runReconciliation(t);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 1 edited", "PR 3"]);
    const closed = await t.run(async (run) => (await run.db.query("integrationPullRequests").collect()).filter((row) => row.state !== "open"));
    expect(closed.map((row) => row.title)).toEqual(["PR 2"]);
  });

  test("finds an open PR the import skipped", async () => {
    const { project, asUser, t, repositoryId } = await connectedProject();
    await t.run(async (run) => {
      const row = await run.db
        .query("integrationPullRequests")
        .withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", repositoryId).eq("number", 1))
        .unique();
      await run.db.delete("integrationPullRequests", row!._id);
    });
    await runReconciliation(t);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 2", "PR 1"]);
    const repository = await t.run((run) => run.db.get("integrationRepositories", repositoryId));
    expect(repository?.syncStatus).toBe("synced");
    expect(repository?.reconcileStartedAt).toBeUndefined();
    expect(repository?.reconciledAt).toBeTypeOf("number");
  });

  test("resumes an import that failed for good", async () => {
    const pulls = Array.from({ length: 35 }, (_, index) => fakePullRequest(index + 1));
    const { project, asUser, t, repositoryId } = await connectedProject(pulls);
    await t.run((run) => run.db.patch("integrationRepositories", repositoryId, { syncStatus: "error", error: "boom", importPage: 2 }));
    await runReconciliation(t);
    const repository = await t.run((run) => run.db.get("integrationRepositories", repositoryId));
    expect(repository).toMatchObject({ syncStatus: "synced", importedCount: 35 });
    expect([repository?.importPage, repository?.error]).toEqual([undefined, undefined]);
    expect(await listTitles(asUser, project._id)).toHaveLength(35);
  });

  test("a duplicate import page dies instead of running a second chain", async () => {
    const pulls = Array.from({ length: 35 }, (_, index) => fakePullRequest(index + 1));
    const { github, t, repositoryId, repositoryLinkId } = await connectedProject(pulls);
    await t.run((run) => run.db.patch("integrationRepositories", repositoryId, { syncStatus: "importing", importPage: 1 }));
    const job = { repositoryId, repositoryLinkId, generation: 1, target: { kind: "import" as const, page: 1 } };
    github.state.requests.length = 0;
    await t.action(internal.integrations.github.sync.syncRepository, job);
    await t.action(internal.integrations.github.sync.syncRepository, job);
    await drain(t);
    // Page 1 once, page 2 once; the duplicate of page 1 claims nothing.
    expect(github.state.requests.filter((request) => request.startsWith("GET /repositories/1/pulls"))).toHaveLength(2);
    const repository = await t.run((run) => run.db.get("integrationRepositories", repositoryId));
    expect(repository).toMatchObject({ syncStatus: "synced", importedCount: 35 });
  });

  test("a running pass is left alone until it goes stale", async () => {
    const { t, repositoryId } = await connectedProject();
    const startedAt = Date.now();
    await t.run((run) => run.db.patch("integrationRepositories", repositoryId, { reconcileStartedAt: startedAt }));
    await t.mutation(internal.integrations.github.sync.reconcile, {});
    expect((await t.run((run) => run.db.get("integrationRepositories", repositoryId)))?.reconcileStartedAt).toBe(startedAt);

    vi.advanceTimersByTime(60 * 60 * 1000);
    await runReconciliation(t);
    const repository = await t.run((run) => run.db.get("integrationRepositories", repositoryId));
    expect(repository?.reconcileStartedAt).toBeUndefined();
    expect(repository?.reconciledAt).toBeGreaterThan(startedAt);
  });

  test("an uninstall without a webhook hides the PRs", async () => {
    const { project, asUser, github, t } = await connectedProject();
    github.state.installations.get(77)!.repositoryIds.delete(1);
    await runReconciliation(t);
    expect(await listTitles(asUser, project._id)).toEqual([]);
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]).toMatchObject({ status: "disconnected" });
  });

  test("skips repositories with no active link", async () => {
    const { project, asUser, github, t, repositoryLinkId } = await connectedProject();
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    github.state.requests.length = 0;
    await runReconciliation(t);
    expect(github.state.requests).toEqual([]);
  });
});

describe("two projects sharing a repository", () => {
  test("one disconnects and reconnects while the other keeps access throughout", async () => {
    const first = await connectedProject();
    const { ctx, org, t } = first;
    const second = await ctx.project(org._id, first.user._id);
    const setupId = await authorizedSetup(first.asUser, second._id);
    await first.asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    await drain(t);

    await first.asUser.mutation(api.integrations.github.core.disconnect, { projectId: first.project._id, repositoryLinkId: first.repositoryLinkId });
    expect(await listTitles(first.asUser, first.project._id)).toEqual([]);
    expect(await listTitles(first.asUser, second._id)).toEqual(["PR 2", "PR 1"]);

    // The other project's link keeps the shared rows current meanwhile.
    editPull(first.github, 1, 2, { title: "PR 2 edited" });
    await runReconciliation(t);
    expect(await listTitles(first.asUser, second._id)).toEqual(["PR 2 edited", "PR 1"]);

    const again = await authorizedSetup(first.asUser, first.project._id);
    await first.asUser.action(api.integrations.github.setup.saveRepositories, { setupId: again, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    await drain(t);
    expect(await listTitles(first.asUser, first.project._id)).toEqual(["PR 2 edited", "PR 1"]);
  });
});

describe("review round 1 regressions", () => {
  test("a lease from before claim times were stored is taken over, so its lost recovery cannot block sync", async () => {
    const { project, asUser, github, t, repositoryId } = await connectedProject();
    // A worker leased the repository before the deploy that removed its recovery's module.
    await t.run((run) => run.db.patch("integrationRepositories", repositoryId, { leaseToken: "orphaned" }));
    editPull(github, 1, 1, { title: "PR 1 edited" });
    await signedWebhook(t, "pull_request", { installation: { id: 77 }, repository: { id: 1 }, pull_request: { number: 1 } });
    await drain(t);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 1 edited", "PR 2"]);
  });

  test("a lease abandoned for 10 minutes is taken over", async () => {
    const { project, asUser, github, t, repositoryId } = await connectedProject();
    await t.run((run) => run.db.patch("integrationRepositories", repositoryId, { leaseToken: "orphaned", leaseClaimedAt: Date.now() }));
    editPull(github, 1, 1, { title: "PR 1 edited" });
    await signedWebhook(t, "pull_request", { installation: { id: 77 }, repository: { id: 1 }, pull_request: { number: 1 } });
    await drain(t, 5 * 60_000);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 2", "PR 1"]);
    await drain(t, 6 * 60_000);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 1 edited", "PR 2"]);
  });

  test("a pre-counter repository larger than one transaction's read budget still syncs and counts", async () => {
    const pulls = Array.from({ length: 120 }, (_, index) => fakePullRequest(index + 1));
    const { project, asUser, t, repositoryId } = await connectedProject(pulls, { transactionLimits: { documentsRead: 100 } });
    await t.run((run) => run.db.patch("integrationRepositories", repositoryId, { openCount: undefined, closedCount: undefined }));
    await runReconciliation(t);
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]?.repository).toMatchObject({ openCount: 120, closedCount: 0 });
  });

  test("a state change during the counter backfill is counted once, before or after the backfill passes it", async () => {
    const pulls = Array.from({ length: 40 }, (_, index) => fakePullRequest(index + 1));
    const { project, asUser, github, t, repositoryId } = await connectedProject(pulls);
    // The backfill has counted rows 1 to 30.
    await t.run((run) =>
      run.db.patch("integrationRepositories", repositoryId, { openCount: 30, closedCount: 0, countedThroughNumber: 30 })
    );
    for (const number of [5, 35]) {
      editPull(github, 1, number, { state: "closed" });
      await signedWebhook(t, "pull_request", { installation: { id: 77 }, repository: { id: 1 }, pull_request: { number } });
    }
    await drain(t);
    await t.mutation(internal.integrations.github.sync.countPullRequests, { repositoryId });
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]?.repository).toMatchObject({ openCount: 38, closedCount: 2 });
    expect((await t.run((run) => run.db.get("integrationRepositories", repositoryId)))?.countedThroughNumber).toBeUndefined();
  });
});

describe("review round 2 regressions", () => {
  test("reconnecting between retention purge batches recounts the PRs instead of adding to stale counts", async () => {
    const pulls = Array.from({ length: 35 }, (_, index) => fakePullRequest(index + 1));
    const { project, asUser, t, repositoryId, repositoryLinkId } = await connectedProject(pulls);
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    const link = await t.run((run) => run.db.get("integrationRepositoryLinks", repositoryLinkId));
    vi.setSystemTime(link!.deleteAfter!);
    // One batch of 30 goes; the purge's continuation loses to the reconnect.
    await t.mutation(internal.integrations.github.core.purge, { repositoryLinkId, generation: link!.generation });
    const setupId = await authorizedSetup(asUser, project._id);
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    await drain(t);
    expect(await listTitles(asUser, project._id)).toHaveLength(35);
    const repository = await t.run((run) => run.db.get("integrationRepositories", repositoryId));
    expect([repository?.openCount, repository?.closedCount]).toEqual([35, 0]);
  });

  test("a repository never reconciled repairs a close missed before a later PR refresh", async () => {
    const { project, asUser, github, t, repositoryId } = await connectedProject();
    // A slice 1 repository: synced, never reconciled.
    await t.run((run) => run.db.patch("integrationRepositories", repositoryId, { reconciledAt: undefined }));
    vi.advanceTimersByTime(60_000);
    editPull(github, 1, 1, { state: "closed" });
    vi.advanceTimersByTime(10 * 60_000);
    editPull(github, 1, 2, { title: "PR 2 edited" });
    await signedWebhook(t, "pull_request", { installation: { id: 77 }, repository: { id: 1 }, pull_request: { number: 2 } });
    await drain(t);
    await runReconciliation(t);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 2 edited"]);
  });
});

describe("count repair", () => {
  test("a reconciliation pass that finds the stored open count off recounts the repository", async () => {
    const { project, asUser, t, repositoryId } = await connectedProject();
    // Counts drifted: two open PRs are stored, the counters say none.
    await t.run((run) => run.db.patch("integrationRepositories", repositoryId, { openCount: 0, closedCount: 0 }));
    await runReconciliation(t);
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]?.repository).toMatchObject({ openCount: 2, closedCount: 0, counting: false });
  });
});
