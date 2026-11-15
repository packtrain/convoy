/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import { authorizedSetup, connectedProject, drain, fakePullRequest, listTitles, stubGithubAppEnv } from "../../../convex-testing/github";
import { RETENTION_MS } from "./lib/integrationRepositoryLinksRepo";
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

describe("integrations.core", () => {
  test("reports unavailable when the deployment has no GitHub App, and still names the admin", async () => {
    const { project, asUser } = await connectedProject();
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status).toMatchObject({ configured: false, canManage: true, installUrl: null });
    await expect(asUser.mutation(api.integrations.github.setup.beginSetup, { projectId: project._id })).rejects.toThrow(errors.NOT_CONFIGURED);
  });

  test("a PKCS#1 private key reads as not configured", async () => {
    const { project, asUser } = await connectedProject();
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----");
    expect((await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.configured).toBe(false);
  });

  test("disconnect hides the project's PRs and keeps the retained metadata for reconnect", async () => {
    const { project, asUser, repositoryLinkId, repositoryId, t } = await connectedProject();
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });

    expect(await listTitles(asUser, project._id)).toEqual([]);
    expect(await asUser.query(api.integrations.github.pullRequests.get, { projectId: project._id, repositoryId, number: 1 })).toBeNull();
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]?.status).toBe("disconnected");
    expect(status?.connections[0]?.deleteAfter).toBe(Date.now() + RETENTION_MS);

    const setupId = await authorizedSetup(asUser, project._id);
    const relinked = (await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] }))[0];
    expect(relinked).toBe(repositoryLinkId);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 2", "PR 1"]);
    await drain(t, 5000);
    const link = await t.run((run) => run.db.get("integrationRepositoryLinks", repositoryLinkId));
    expect(link).toMatchObject({ status: "active", generation: 3 });
    expect(link).not.toHaveProperty("deleteAfter");
  });

  test("reconnecting catches up on PRs closed while disconnected", async () => {
    const { project, asUser, repositoryLinkId, t, github } = await connectedProject();
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    const pr = github.state.pulls.get(1)!.find((candidate) => candidate.number === 1)!;
    Object.assign(pr, { state: "closed", merged: true, updatedAt: Date.now() + 1000 });
    github.state.pulls.get(1)!.push(fakePullRequest(3, { state: "closed", updatedAt: Date.now() + 2000 }));

    const setupId = await authorizedSetup(asUser, project._id);
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    await drain(t, 30_000);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 2"]);
    const stored = await t.run((run) => run.db.query("integrationPullRequests").take(10));
    expect(stored.map((row) => row.number).sort()).toEqual([1, 2]);
  });

  test("the retention purge deletes the data after 30 days, and a reconnect cancels it", async () => {
    const first = await connectedProject();
    await first.asUser.mutation(api.integrations.github.core.disconnect, {
      projectId: first.project._id,
      repositoryLinkId: first.repositoryLinkId,
    });
    // Too early: nothing happens.
    await first.t.mutation(internal.integrations.github.core.purge, { repositoryLinkId: first.repositoryLinkId, generation: 2 });
    expect(await first.t.run((run) => run.db.get("integrationRepositories", first.repositoryId))).not.toBeNull();

    vi.setSystemTime(Date.now() + RETENTION_MS + 1);
    await first.t.mutation(internal.integrations.github.core.purge, { repositoryLinkId: first.repositoryLinkId, generation: 2 });
    await first.t.finishInProgressScheduledFunctions();
    expect(await first.t.run((run) => run.db.get("integrationRepositories", first.repositoryId))).toBeNull();
    expect(await first.t.run((run) => run.db.query("integrationPullRequests").take(1))).toEqual([]);
    expect(await first.t.run((run) => run.db.get("integrationRepositoryLinks", first.repositoryLinkId))).toBeNull();

    const second = await connectedProject();
    await second.asUser.mutation(api.integrations.github.core.disconnect, {
      projectId: second.project._id,
      repositoryLinkId: second.repositoryLinkId,
    });
    const setupId = await authorizedSetup(second.asUser, second.project._id);
    await second.asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    vi.setSystemTime(Date.now() + RETENTION_MS + 1);
    await second.t.mutation(internal.integrations.github.core.purge, { repositoryLinkId: second.repositoryLinkId, generation: 2 });
    expect(await listTitles(second.asUser, second.project._id)).toEqual(["PR 2", "PR 1"]);
  });

  test("another project's link to the same repository keeps the data through a purge", async () => {
    const { ctx, org, user, project, asUser, repositoryLinkId, t } = await connectedProject();
    const other = await ctx.project(org._id, user._id);
    const setupId = await authorizedSetup(asUser, other._id);
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    await drain(t, 5000);

    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    vi.setSystemTime(Date.now() + RETENTION_MS + 1);
    await t.mutation(internal.integrations.github.core.purge, { repositoryLinkId, generation: 2 });

    expect(await listTitles(asUser, other._id)).toEqual(["PR 2", "PR 1"]);
    expect(await listTitles(asUser, project._id)).toEqual([]);
  });

  test("Delete now deletes a disconnected repository's PRs and its row without waiting 30 days", async () => {
    const pulls = Array.from({ length: 35 }, (_, index) => fakePullRequest(index + 1));
    const { project, asUser, repositoryId, repositoryLinkId, t } = await connectedProject(pulls);
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    await asUser.mutation(api.integrations.github.core.deleteRetained, { projectId: project._id, repositoryLinkId });
    await drain(t);
    expect((await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.connections).toEqual([]);
    expect(await t.run((run) => run.db.get("integrationRepositories", repositoryId))).toBeNull();
    expect(await t.run((run) => run.db.query("integrationPullRequests").take(1))).toEqual([]);
  });

  test("Delete now leaves another project's copy of the repository alone", async () => {
    const { ctx, org, user, project, asUser, repositoryLinkId, t } = await connectedProject();
    const other = await ctx.project(org._id, user._id);
    const setupId = await authorizedSetup(asUser, other._id);
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    await drain(t);
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    await asUser.mutation(api.integrations.github.core.deleteRetained, { projectId: project._id, repositoryLinkId });
    await drain(t);
    expect((await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.connections).toEqual([]);
    expect(await listTitles(asUser, other._id)).toEqual(["PR 2", "PR 1"]);
  });

  test("Delete now refuses a connected repository", async () => {
    const { project, asUser, repositoryLinkId } = await connectedProject();
    await expect(asUser.mutation(api.integrations.github.core.deleteRetained, { projectId: project._id, repositoryLinkId })).rejects.toThrow(
      errors.STILL_CONNECTED
    );
  });

  test("deleting the project disconnects it and stops its import", async () => {
    const { project, asUser, repositoryLinkId, t } = await connectedProject();
    await asUser.mutation(api.projects.core.remove, { id: project._id });
    await drain(t, 5000);
    const link = await t.run((run) => run.db.get("integrationRepositoryLinks", repositoryLinkId));
    expect(link?.status).toBe("disconnected");
  });

  test("retry restarts a failed import and only admins may disconnect or retry", async () => {
    const { ctx, org, project, asUser, repositoryLinkId, repositoryId, t } = await connectedProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const asViewer = ctx.asUser(viewer);
    await expect(asViewer.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId })).rejects.toThrow(
      "Permission denied"
    );
    await expect(asViewer.mutation(api.integrations.github.core.retrySync, { projectId: project._id, repositoryLinkId })).rejects.toThrow(
      "Permission denied"
    );
    expect((await asViewer.query(api.integrations.github.core.get, { projectId: project._id }))?.canManage).toBe(false);

    await t.run((run) => run.db.patch("integrationRepositories", repositoryId, { syncStatus: "error", error: "boom", importPage: 1 }));
    await asUser.mutation(api.integrations.github.core.retrySync, { projectId: project._id, repositoryLinkId });
    await drain(t, 5000);
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]?.repository.syncStatus).toBe("synced");
    expect(status?.connections[0]?.repository).not.toHaveProperty("error");
  });
});

describe("connecting a repository that already has data", () => {
  test("another project connecting a retained repository catches up on PRs closed meanwhile", async () => {
    const { ctx, org, user, project, asUser, repositoryLinkId, t, github } = await connectedProject();
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    vi.setSystemTime(Date.now() + 60_000);
    const pr = github.state.pulls.get(1)!.find((candidate) => candidate.number === 1)!;
    Object.assign(pr, { state: "closed", updatedAt: Date.now() });

    const other = await ctx.project(org._id, user._id);
    const setupId = await authorizedSetup(asUser, other._id);
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    await drain(t, 30_000);
    expect(await listTitles(asUser, other._id)).toEqual(["PR 2"]);
  });

  test("reconnecting after a revocation catches up from the last successful sync", async () => {
    const { project, asUser, repositoryLinkId, t, github } = await connectedProject();
    vi.setSystemTime(Date.now() + 2 * 60 * 60_000);
    const pr = github.state.pulls.get(1)!.find((candidate) => candidate.number === 1)!;
    // GitHub stopped sending events an hour before Convoy noticed the loss.
    Object.assign(pr, { state: "closed", merged: true, updatedAt: Date.now() - 60 * 60_000 });
    await t.mutation(internal.integrations.github.core.revoke, { repositoryLinkId, expectedGeneration: 1 });

    const setupId = await authorizedSetup(asUser, project._id);
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    await drain(t, 30_000);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 2"]);
  });

  test("a second project joins a live repository without a second import", async () => {
    const { ctx, org, user, asUser, repositoryId, t, github } = await connectedProject();
    const other = await ctx.project(org._id, user._id);
    const setupId = await authorizedSetup(asUser, other._id);
    github.state.requests.length = 0;
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    await drain(t, 30_000);
    expect(github.state.requests.filter((request) => /\/pulls$/.test(request))).toEqual([]);
    expect(await listTitles(asUser, other._id)).toEqual(["PR 2", "PR 1"]);
    const repository = await t.run((run) => run.db.get("integrationRepositories", repositoryId));
    expect(repository).toMatchObject({ syncStatus: "synced", importedCount: 2 });
  });

  test("an import outlives the disconnect of the project that started it", async () => {
    const { ctx, org, user, project, asUser, repositoryLinkId, repositoryId, t } = await connectedProject();
    const other = await ctx.project(org._id, user._id);
    const setupId = await authorizedSetup(asUser, other._id);
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    await drain(t, 5000);
    // The first project's import is between pages when it disconnects.
    await t.run((run) =>
      run.db.patch("integrationRepositories", repositoryId, { syncStatus: "importing", importPage: 1, importedCount: 0 })
    );
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    await drain(t, 30_000);
    const repository = await t.run((run) => run.db.get("integrationRepositories", repositoryId));
    expect(repository).toMatchObject({ syncStatus: "synced", importedCount: 2 });
  });

  test("settings shows the most recently disconnected repository", async () => {
    const { project, asUser, repositoryLinkId, github, t } = await connectedProject();
    github.addRepository({ id: 2 });
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    for (const providerRepositoryId of [2, 1]) {
      vi.setSystemTime(Date.now() + 60_000);
      const setupId = await authorizedSetup(asUser, project._id);
      const linkId = (await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [providerRepositoryId], removeRepositoryLinkIds: [] }))[0];
      await drain(t, 5000);
      await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId: linkId });
    }
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]?.repository.name).toBe("repo-1");
  });
});

describe("Sync again", () => {
  test("after a finished import, it imports again without double counting", async () => {
    const { project, asUser, repositoryLinkId, repositoryId, t } = await connectedProject();
    await asUser.mutation(api.integrations.github.core.retrySync, { projectId: project._id, repositoryLinkId });
    await drain(t, 5000);
    const repository = await t.run((run) => run.db.get("integrationRepositories", repositoryId));
    expect(repository).toMatchObject({ syncStatus: "synced", importedCount: 2 });
  });

  test("while an import runs between pages, it starts nothing", async () => {
    const pulls = Array.from({ length: 35 }, (_, index) => fakePullRequest(index + 1));
    const { project, asUser, repositoryLinkId, repositoryId, t, github } = await connectedProject(pulls);
    await t.run((run) =>
      run.db.patch("integrationRepositories", repositoryId, { syncStatus: "importing", importPage: 2, importedCount: 30 })
    );
    github.state.requests.length = 0;
    await asUser.mutation(api.integrations.github.core.retrySync, { projectId: project._id, repositoryLinkId });
    await asUser.mutation(api.integrations.github.core.retrySync, { projectId: project._id, repositoryLinkId });
    await drain(t, 5000);
    expect(github.state.requests.filter((request) => /\/pulls$/.test(request))).toEqual([]);
  });

  test("while a PR refresh holds the lease, it queues the import", async () => {
    const { project, asUser, repositoryLinkId, repositoryId, t } = await connectedProject();
    await t.run((run) => run.db.patch("integrationRepositories", repositoryId, { syncStatus: "error", error: "boom", importPage: 1 }));
    const claim = await t.mutation(internal.integrations.github.sync.claimSync, {
      repositoryId,
      repositoryLinkId,
      generation: 1,
      target: { kind: "pullRequest", number: 1 },
    });
    expect(claim.kind).toBe("acquired");
    await asUser.mutation(api.integrations.github.core.retrySync, { projectId: project._id, repositoryLinkId });
    await drain(t, 5 * 60_000);
    const repository = await t.run((run) => run.db.get("integrationRepositories", repositoryId));
    expect(repository).toMatchObject({ syncStatus: "synced", importedCount: 2 });
  });
});

describe("PR link targets", () => {
  test("list the connected repositories of the projects the caller can read", async () => {
    const { ctx, org, project, asUser, repositoryId } = await connectedProject();
    expect(await asUser.query(api.integrations.github.core.listLinkTargets, { organizationId: org._id })).toEqual([
      { projectAlias: project.alias, repositoryId, owner: "acme", name: "repo-1" },
    ]);
    // An organization member outside the project gets nothing.
    const outsider = await ctx.user();
    await ctx.orgMember(org._id, outsider._id, "member");
    expect(await ctx.asUser(outsider).query(api.integrations.github.core.listLinkTargets, { organizationId: org._id })).toEqual([]);
  });
});
