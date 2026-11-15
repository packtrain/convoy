/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { createTestContext } from "../../../convex-testing";
import {
  GOOD_CODE,
  authorizedSetup,
  connectedProject,
  createFakeGithub,
  drain,
  fakePullRequest,
  listTitles,
  signedWebhook,
  stubGithubAppEnv,
  type FakeGithub,
  type T,
} from "../../../convex-testing/github";
import { errors } from "./errors";
import { DIFF_MAX_PATCH_BYTES, normalizeDiffFiles } from "./lib/parsers";
import { normalizedPullRequestValidator, type NormalizedPullRequest } from "../../lib/contracts/github";

beforeEach(async () => {
  vi.useFakeTimers();
  await stubGithubAppEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function pullRequestEvent(number: number, repositoryId = 1, installationId = 77) {
  return { action: "edited", installation: { id: installationId }, repository: { id: repositoryId }, pull_request: { number } };
}

function editPull(github: FakeGithub, repositoryId: number, number: number, patch: Partial<ReturnType<typeof fakePullRequest>>) {
  const pr = github.state.pulls.get(repositoryId)!.find((candidate) => candidate.number === number)!;
  Object.assign(pr, { updatedAt: pr.updatedAt + 60_000 }, patch);
}

describe("connecting a repository", () => {
  test("a project admin connects, the open PRs import, and a viewer reads them without GitHub access", async () => {
    const { ctx, org, project, asUser, t } = await connectedProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");

    expect(await listTitles(ctx.asUser(viewer), project._id)).toEqual(["PR 2", "PR 1"]);
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]).toMatchObject({ status: "active", accountLogin: "acme" });
    expect(status?.connections[0]?.repository).toMatchObject({ owner: "acme", name: "repo-1", syncStatus: "synced", importedCount: 2 });
    const setups = await t.run((run) => run.db.query("integrationSetups").take(5));
    expect(setups).toEqual([]);
  });

  test("the import pages through more than one provider page", async () => {
    const pulls = Array.from({ length: 35 }, (_, index) => fakePullRequest(index + 1));
    const { project, asUser } = await connectedProject(pulls);
    expect(await listTitles(asUser, project._id)).toHaveLength(35);
  });

  test("viewers and members cannot start a connection", async () => {
    const ctx = createTestContext();
    const { org, project } = await ctx.setupProject();
    for (const role of ["viewer", "member"] as const) {
      const user = await ctx.user();
      await ctx.orgMember(org._id, user._id, "member");
      await ctx.projectMember(project._id, user._id, role);
      await expect(ctx.asUser(user).mutation(api.integrations.github.setup.beginSetup, { projectId: project._id })).rejects.toThrow(
        "Permission denied"
      );
    }
  });

  test("an organization owner outside the project cannot connect or read", async () => {
    const { ctx, org, project } = await connectedProject();
    const owner = await ctx.user();
    await ctx.orgMember(org._id, owner._id, "owner");
    const asOwner = ctx.asUser(owner);
    await expect(asOwner.mutation(api.integrations.github.setup.beginSetup, { projectId: project._id })).rejects.toThrow(
      "Not a member of this project"
    );
    expect(await asOwner.query(api.integrations.github.core.get, { projectId: project._id })).toBeNull();
    expect(await listTitles(asOwner, project._id)).toEqual([]);
  });

  test("the callback is bound to the user who started it and works once", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    createFakeGithub();
    const { authorizeUrl } = await asUser.mutation(api.integrations.github.setup.beginSetup, { projectId: project._id });
    const state = new URL(authorizeUrl).searchParams.get("state")!;

    const otherAdmin = await ctx.user();
    await ctx.orgMember(org._id, otherAdmin._id, "member");
    await ctx.projectMember(project._id, otherAdmin._id, "project-admin");
    await expect(ctx.asUser(otherAdmin).action(api.integrations.github.setup.completeSetup, { state, code: GOOD_CODE })).rejects.toThrow(
      errors.SETUP_NOT_FOUND
    );
    await expect(asUser.action(api.integrations.github.setup.completeSetup, { state: "forged", code: GOOD_CODE })).rejects.toThrow(
      errors.SETUP_NOT_FOUND
    );

    await asUser.action(api.integrations.github.setup.completeSetup, { state, code: GOOD_CODE });
    await expect(asUser.action(api.integrations.github.setup.completeSetup, { state, code: GOOD_CODE })).rejects.toThrow(
      errors.SETUP_ALREADY_USED
    );
  });

  test("an expired setup and a rejected GitHub code fail", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    createFakeGithub();
    const first = await asUser.mutation(api.integrations.github.setup.beginSetup, { projectId: project._id });
    await expect(
      asUser.action(api.integrations.github.setup.completeSetup, {
        state: new URL(first.authorizeUrl).searchParams.get("state")!,
        code: "bad-code",
      })
    ).rejects.toThrow(errors.GITHUB_AUTHORIZATION_FAILED);

    const second = await asUser.mutation(api.integrations.github.setup.beginSetup, { projectId: project._id });
    vi.advanceTimersByTime(11 * 60 * 1000);
    await expect(
      asUser.action(api.integrations.github.setup.completeSetup, {
        state: new URL(second.authorizeUrl).searchParams.get("state")!,
        code: GOOD_CODE,
      })
    ).rejects.toThrow(errors.SETUP_EXPIRED);
  });

  test("losing project admin during setup blocks the final connect", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    createFakeGithub().addRepository({ id: 1 });
    const setupId = await authorizedSetup(asUser, project._id);
    await t.run(async (run) => {
      const membership = await run.db
        .query("projectMembers")
        .withIndex("by_project_and_user", (q) => q.eq("projectId", project._id).eq("userId", user._id))
        .unique();
      await run.db.patch("projectMembers", membership!._id, { role: "viewer" });
    });
    await expect(asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] })).rejects.toThrow(
      "Permission denied"
    );
  });

  test("selection lists installation repositories and rejects non-admin or uninstalled ones", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const github = createFakeGithub();
    github.addRepository({ id: 1 });
    github.addRepository({ id: 2, admin: false });
    const setupId = await authorizedSetup(asUser, project._id);

    const page = await asUser.action(api.integrations.github.setup.listSetupRepositories, { setupId });
    expect(page.repositories.map(({ fullName, isAdmin }) => ({ fullName, isAdmin }))).toEqual([
      { fullName: "acme/repo-1", isAdmin: true },
      { fullName: "acme/repo-2", isAdmin: false },
    ]);
    expect(page.nextCursor).toBeNull();
    await expect(asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [2], removeRepositoryLinkIds: [] })).rejects.toThrow(
      errors.REPOSITORY_ADMIN_REQUIRED
    );
    await expect(asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [3], removeRepositoryLinkIds: [] })).rejects.toThrow(
      errors.REPOSITORY_NOT_INSTALLED
    );
  });

  test("a save that fails on a new repository keeps the repositories it would have removed", async () => {
    const { ctx, org, user, project, asUser, github, repositoryLinkId } = await connectedProject();
    github.addRepository({ id: 2, admin: false });
    const otherProject = await ctx.project(org._id, user._id);
    const [otherLinkId] = await asUser.action(api.integrations.github.setup.saveRepositories, {
      setupId: await authorizedSetup(asUser, otherProject._id),
      providerRepositoryIds: [1],
      removeRepositoryLinkIds: [],
    });
    const setupId = await authorizedSetup(asUser, project._id);
    await expect(
      asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [2], removeRepositoryLinkIds: [repositoryLinkId] })
    ).rejects.toThrow(errors.REPOSITORY_ADMIN_REQUIRED);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 2", "PR 1"]);

    // Removing alone needs no GitHub admin access, and another project's link cannot be named.
    await expect(
      asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [], removeRepositoryLinkIds: [otherLinkId] })
    ).rejects.toThrow(errors.CONNECTION_NOT_FOUND);
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [], removeRepositoryLinkIds: [repositoryLinkId] });
    expect(await listTitles(asUser, project._id)).toEqual([]);
  });

  test("a project connects more repositories, all or none", async () => {
    const { project, asUser, github, t, repositoryLinkId } = await connectedProject();
    github.addRepository({ id: 2 }, [fakePullRequest(3)]);
    github.addRepository({ id: 3, admin: false });
    const failed = await authorizedSetup(asUser, project._id);
    await expect(
      asUser.action(api.integrations.github.setup.saveRepositories, { setupId: failed, providerRepositoryIds: [2, 3], removeRepositoryLinkIds: [] })
    ).rejects.toThrow(errors.REPOSITORY_ADMIN_REQUIRED);
    expect((await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.connections).toHaveLength(1);

    const setupId = await authorizedSetup(asUser, project._id);
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1, 2], removeRepositoryLinkIds: [] });
    await drain(t);
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections.map((connection) => connection.repository.name).sort()).toEqual(["repo-1", "repo-2"]);
    // Connecting an already active repository leaves its link and jobs alone.
    expect((await t.run((run) => run.db.get("integrationRepositoryLinks", repositoryLinkId)))?.generation).toBe(1);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 3", "PR 2", "PR 1"]);
  });
});

describe("webhooks", () => {
  test("a signed PR event refreshes the title and closing removes it from the open list", async () => {
    const { project, asUser, t, github } = await connectedProject();
    editPull(github, 1, 1, { title: "Renamed" });
    expect((await signedWebhook(t, "pull_request", pullRequestEvent(1))).status).toBe(202);
    await drain(t, 5000);
    expect(await listTitles(asUser, project._id)).toEqual(["Renamed", "PR 2"]);

    editPull(github, 1, 1, { state: "closed", merged: true });
    await signedWebhook(t, "pull_request", pullRequestEvent(1));
    await drain(t, 5000);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 2"]);
  });

  test("an invalid signature is rejected and schedules nothing", async () => {
    const { project, asUser, t, github } = await connectedProject();
    editPull(github, 1, 1, { title: "Renamed" });
    expect((await signedWebhook(t, "pull_request", pullRequestEvent(1), "wrong-secret")).status).toBe(401);
    await drain(t, 5000);
    expect(await listTitles(asUser, project._id)).toEqual(["PR 2", "PR 1"]);
  });

  test("duplicate deliveries keep one row and never regress newer data", async () => {
    const { repositoryId, t, github } = await connectedProject();
    editPull(github, 1, 1, { title: "Newest" });
    await signedWebhook(t, "pull_request", pullRequestEvent(1));
    await signedWebhook(t, "pull_request", pullRequestEvent(1));
    await drain(t, 30_000);
    const rows = await t.run((run) =>
      run.db
        .query("integrationPullRequests")
        .withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", repositoryId).eq("number", 1))
        .collect()
    );
    expect(rows.map((row) => row.title)).toEqual(["Newest"]);
  });

  test("an older provider timestamp does not overwrite a newer row", async () => {
    const { repositoryId, repositoryLinkId, t } = await connectedProject();
    const fields = await normalizedPr(t, repositoryId);
    const job = { repositoryId, repositoryLinkId, generation: 1, target: { kind: "pullRequest" as const, number: 1 } };
    const claim = await t.mutation(internal.integrations.github.sync.claimSync, job);
    if (claim.kind !== "acquired") throw new Error("expected the lease");
    await t.mutation(internal.integrations.github.sync.commitSync, {
      ...job,
      leaseToken: claim.leaseToken,
      hasMore: false,
      pullRequests: [{ ...fields, title: "Stale", providerUpdatedAt: fields.providerUpdatedAt - 1 }],
    });
    expect((await normalizedPr(t, repositoryId)).title).toBe("PR 1");
  });

  test("a PR refresh that finds the lease busy retries with its PR number", async () => {
    const { repositoryId, repositoryLinkId, project, asUser, t, github } = await connectedProject();
    // A job that never commits holds the lease until its recovery runs.
    await t.mutation(internal.integrations.github.sync.claimSync, {
      repositoryId,
      repositoryLinkId,
      generation: 1,
      target: { kind: "pullRequest", number: 1 },
    });
    editPull(github, 1, 2, { title: "After the lease" });
    await signedWebhook(t, "pull_request", pullRequestEvent(2));
    await drain(t, 10_000);
    expect(await listTitles(asUser, project._id)).toContain("PR 2");
    await drain(t, 3 * 60_000);
    expect(await listTitles(asUser, project._id)).toContain("After the lease");
  });

  test("an expired lease stays busy until its recovery runs", async () => {
    const { repositoryId, repositoryLinkId, t } = await connectedProject();
    const job = (number: number) => ({
      repositoryId,
      repositoryLinkId,
      generation: 1,
      target: { kind: "pullRequest" as const, number },
    });
    expect((await t.mutation(internal.integrations.github.sync.claimSync, job(1))).kind).toBe("acquired");
    vi.setSystemTime(Date.now() + 3 * 60_000);
    expect((await t.mutation(internal.integrations.github.sync.claimSync, job(2))).kind).toBe("busy");
  });

  test("a recovered job with no retries left does not promise one", async () => {
    const { repositoryId, repositoryLinkId, t } = await connectedProject();
    const job = { repositoryId, repositoryLinkId, generation: 1, target: { kind: "pullRequest" as const, number: 1 }, attempt: 5 };
    const claim = await t.mutation(internal.integrations.github.sync.claimSync, job);
    if (claim.kind !== "acquired") throw new Error("expected the lease");
    await t.mutation(internal.integrations.github.sync.recoverSync, { ...job, leaseToken: claim.leaseToken });
    const repository = await t.run((run) => run.db.get("integrationRepositories", repositoryId));
    expect(repository?.error).toBe("Sync was interrupted");
  });

  test("sync and diff reads find a renamed repository by its id", async () => {
    const { project, asUser, repositoryId, t, github } = await connectedProject();
    github.state.repositories.get(1)!.name = "renamed";
    editPull(github, 1, 1, { title: "After rename" });
    await signedWebhook(t, "pull_request", pullRequestEvent(1));
    await drain(t, 5000);
    expect(await listTitles(asUser, project._id)).toContain("After rename");
    const diff = await asUser.action(api.integrations.github.pullRequests.readDiff, { projectId: project._id, repositoryId, number: 1 });
    expect(diff.headSha).toBe("head-1");
  });

  test("every GitHub request carries a timeout", async () => {
    const { github } = await connectedProject();
    expect(github.fetchMock.mock.calls.length).toBeGreaterThan(0);
    expect(github.fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
  });

  test("an event fans out to every tenant copy past one batch", async () => {
    const ctx = createTestContext();
    const { user, t } = await ctx.setupProject();
    const github = createFakeGithub();
    github.addRepository({ id: 1 }, [fakePullRequest(1)]);
    const repositoryIds: Id<"integrationRepositories">[] = [];
    for (let index = 0; index < 31; index++) {
      const org = await ctx.organization(user._id);
      const project = await ctx.project(org._id, user._id);
      repositoryIds.push(
        await t.run(async (run) => {
          const repositoryId = await run.db.insert("integrationRepositories", {
            organizationId: org._id,
            provider: "github",
            host: "github.com",
            providerRepositoryId: 1,
            owner: "acme",
            name: "repo-1",
            isPrivate: true,
            htmlUrl: "https://github.com/acme/repo-1",
            syncStatus: "synced",
          });
          await run.db.insert("integrationRepositoryLinks", {
            organizationId: org._id,
            projectId: project._id,
            repositoryId,
            provider: "github",
            github: { installationId: 77, accountLogin: "acme" },
            status: "active",
            generation: 1,
            connectedBy: user._id,
            connectedAt: Date.now(),
          });
          return repositoryId;
        })
      );
    }
    await signedWebhook(t, "pull_request", pullRequestEvent(1));
    await drain(t, 5000);
    const refreshed = await t.run(async (run) =>
      Promise.all(
        repositoryIds.map((repositoryId) =>
          run.db
            .query("integrationPullRequests")
            .withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", repositoryId).eq("number", 1))
            .unique()
        )
      )
    );
    expect(refreshed.every((row) => row?.title === "PR 1")).toBe(true);
  });
});

describe("sync status", () => {
  test("a PR refresh that recovers on retry clears the sync error", async () => {
    const { project, asUser, t, github } = await connectedProject();
    github.state.failures.push({ match: /pulls\/1$/, status: 500 });
    await signedWebhook(t, "pull_request", pullRequestEvent(1));
    await drain(t, 5000);
    expect((await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.connections[0]?.repository.syncStatus).toBe("error");
    await drain(t, 60_000);
    const repository = (await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.connections[0]?.repository;
    expect(repository?.syncStatus).toBe("synced");
    expect(repository).not.toHaveProperty("error");
  });

  test("a PR refresh does not hide an unfinished import's failure", async () => {
    const { project, asUser, repositoryId, t } = await connectedProject();
    await t.run((run) =>
      run.db.patch("integrationRepositories", repositoryId, { syncStatus: "error", error: "Import failed", importPage: 2 })
    );
    await signedWebhook(t, "pull_request", pullRequestEvent(1));
    await drain(t, 5000);
    const repository = (await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.connections[0]?.repository;
    expect(repository).toMatchObject({ syncStatus: "error", error: "Import failed" });
  });
});

describe("fencing and revocation", () => {
  test("work that outlives a disconnect cannot write", async () => {
    const { project, asUser, repositoryId, repositoryLinkId, t } = await connectedProject();
    const job = { repositoryId, repositoryLinkId, generation: 1, target: { kind: "pullRequest" as const, number: 9 } };
    const claim = await t.mutation(internal.integrations.github.sync.claimSync, job);
    if (claim.kind !== "acquired") throw new Error("expected the lease");
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    const accepted = await t.mutation(internal.integrations.github.sync.commitSync, {
      ...job,
      leaseToken: claim.leaseToken,
      hasMore: false,
      pullRequests: [{ ...(await normalizedPr(t, repositoryId)), number: 9 }],
    });
    expect(accepted).toBe(false);
    const row = await t.run((run) =>
      run.db
        .query("integrationPullRequests")
        .withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", repositoryId).eq("number", 9))
        .unique()
    );
    expect(row).toBeNull();
    const repository = await t.run((run) => run.db.get("integrationRepositories", repositoryId));
    expect(repository?.leaseToken).toBeUndefined();
  });

  test("an access signal revokes only when GitHub confirms the loss", async () => {
    const { project, asUser, t, github } = await connectedProject();
    await signedWebhook(t, "installation_repositories", { action: "removed", installation: { id: 77 } });
    await drain(t, 5000);
    expect((await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.connections[0]?.status).toBe("active");

    github.state.failures.push({ match: /access_tokens/, status: 500 });
    github.state.installations.get(77)!.repositoryIds.clear();
    github.state.failures.push({ match: /access_tokens/, status: 502 });
    await signedWebhook(t, "installation", { action: "deleted", installation: { id: 77 } });
    await drain(t, 5000);
    expect((await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.connections[0]?.status).toBe("active");

    await drain(t, 5 * 60_000);
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]).toMatchObject({ status: "disconnected", error: "GitHub access to this repository was removed" });
    expect(await listTitles(asUser, project._id)).toEqual([]);
  });

  test("a live read that finds the App uninstalled hides the stored PRs", async () => {
    const { project, asUser, repositoryId, t, github } = await connectedProject();
    github.state.installations.delete(77);
    await expect(asUser.action(api.integrations.github.pullRequests.readDiff, { projectId: project._id, repositoryId, number: 1 })).rejects.toThrow(
      errors.NOT_CONNECTED
    );
    await drain(t, 5000);
    expect(await listTitles(asUser, project._id)).toEqual([]);
    expect(await asUser.query(api.integrations.github.pullRequests.get, { projectId: project._id, repositoryId, number: 1 })).toBeNull();
  });

  test("a secondary rate limit is not an access loss", async () => {
    const { project, asUser, t, github } = await connectedProject();
    github.state.failures.push({
      match: /access_tokens/,
      status: 403,
      headers: { "retry-after": "60", "x-ratelimit-remaining": "4999" },
      message: "You have exceeded a secondary rate limit.",
    });
    await signedWebhook(t, "installation", { action: "suspend", installation: { id: 77 } });
    await drain(t, 5 * 60_000);
    expect((await asUser.query(api.integrations.github.core.get, { projectId: project._id }))?.connections[0]?.status).toBe("active");
  });

  test("a replayed revocation after reconnect leaves the new connection intact", async () => {
    const { project, asUser, repositoryLinkId, t } = await connectedProject();
    await asUser.mutation(api.integrations.github.core.disconnect, { projectId: project._id, repositoryLinkId });
    const setupId = await authorizedSetup(asUser, project._id);
    await asUser.action(api.integrations.github.setup.saveRepositories, { setupId, providerRepositoryIds: [1], removeRepositoryLinkIds: [] });
    await drain(t, 5000);
    await t.mutation(internal.integrations.github.core.revoke, { repositoryLinkId, expectedGeneration: 1 });
    const status = await asUser.query(api.integrations.github.core.get, { projectId: project._id });
    expect(status?.connections[0]?.status).toBe("active");
    expect(await listTitles(asUser, project._id)).toEqual(["PR 2", "PR 1"]);
  });
});

describe("reading a diff", () => {
  test("returns GitHub's file entries for the PR revision", async () => {
    const { project, asUser, repositoryId } = await connectedProject();
    const diff = await asUser.action(api.integrations.github.pullRequests.readDiff, { projectId: project._id, repositoryId, number: 1 });
    expect(diff).toMatchObject({ headSha: "head-1", baseSha: "base", partial: false });
    expect(diff.files).toEqual([{ path: "src/a.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b" }]);
  });

  test("patches past the byte budget come back without text and mark the diff partial", async () => {
    const big = "@@ -1 +1 @@\n+" + "x".repeat(DIFF_MAX_PATCH_BYTES);
    const { project, asUser, repositoryId } = await connectedProject([
      fakePullRequest(1, {
        files: [
          { filename: "big.txt", status: "added", additions: 1, deletions: 0, patch: big },
          { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
        ],
      }),
    ]);
    const diff = await asUser.action(api.integrations.github.pullRequests.readDiff, { projectId: project._id, repositoryId, number: 1 });
    expect(diff.partial).toBe(true);
    expect(diff.files.map((file) => [file.path, file.patch === undefined])).toEqual([
      ["big.txt", true],
      ["logo.png", true],
    ]);
  });

  test("file statuses narrow to the set the reader shows", () => {
    const entry = (status: string) => ({ filename: "a.ts", status, additions: 0, deletions: 0 });
    const { files } = normalizeDiffFiles(["added", "removed", "renamed", "copied", "changed", "unchanged", "new"].map(entry));
    expect(files.map((file) => file.status)).toEqual(["added", "removed", "renamed", "modified", "modified", "modified", "modified"]);
  });

  test("the patch budget counts UTF-8 bytes, not characters", async () => {
    // 3 bytes per character: about 1.5 MiB in fewer than DIFF_MAX_PATCH_BYTES characters.
    const wide = "@@ -1 +1 @@\n+" + "語".repeat(Math.ceil(DIFF_MAX_PATCH_BYTES / 2));
    const { project, asUser, repositoryId } = await connectedProject([
      fakePullRequest(1, { files: [{ filename: "wide.txt", status: "added", additions: 1, deletions: 0, patch: wide }] }),
    ]);
    const diff = await asUser.action(api.integrations.github.pullRequests.readDiff, { projectId: project._id, repositoryId, number: 1 });
    expect(diff.partial).toBe(true);
    expect(diff.files[0].patch).toBeUndefined();
  });

  test("a push during every read asks for a refresh instead of mixing revisions", async () => {
    const { project, asUser, repositoryId, github } = await connectedProject();
    let pushes = 0;
    github.state.onFilesRead = () => editPull(github, 1, 1, { headSha: `pushed-${++pushes}` });
    await expect(asUser.action(api.integrations.github.pullRequests.readDiff, { projectId: project._id, repositoryId, number: 1 })).rejects.toThrow(
      errors.PULL_REQUEST_CHANGED
    );
  });

  test("GitHub failures reach the user as catalog messages", async () => {
    const { project, asUser, repositoryId, github } = await connectedProject();
    const read = (number = 1) => asUser.action(api.integrations.github.pullRequests.readDiff, { projectId: project._id, repositoryId, number });
    github.state.failures.push({ match: /pulls\/1$/, status: 502 });
    await expect(read()).rejects.toThrow(errors.GITHUB_UNAVAILABLE);
    github.state.failures.push({ match: /pulls\/1$/, status: 429, headers: { "retry-after": "60" } });
    await expect(read()).rejects.toThrow(errors.GITHUB_RATE_LIMITED);
    await expect(read(99)).rejects.toThrow(errors.PULL_REQUEST_NOT_FOUND);

    const setupId = await authorizedSetup(asUser, project._id);
    github.state.failures.push({ match: /\/repositories$/, status: 503 });
    await expect(asUser.action(api.integrations.github.setup.listSetupRepositories, { setupId })).rejects.toThrow(errors.GITHUB_UNAVAILABLE);
  });

  test("a diff read that finds the stored PR behind schedules its refresh", async () => {
    const { project, asUser, repositoryId, t, github } = await connectedProject();
    editPull(github, 1, 1, { headSha: "pushed", title: "Pushed" });
    const diff = await asUser.action(api.integrations.github.pullRequests.readDiff, { projectId: project._id, repositoryId, number: 1 });
    expect(diff.headSha).toBe("pushed");
    await drain(t, 5000);
    expect(await listTitles(asUser, project._id)).toContain("Pushed");
  });

  test("another project cannot read the connected repository", async () => {
    const { ctx, org, user, repositoryId, asUser } = await connectedProject();
    const other = await ctx.project(org._id, user._id);
    await expect(asUser.action(api.integrations.github.pullRequests.readDiff, { projectId: other._id, repositoryId, number: 1 })).rejects.toThrow(
      errors.NOT_CONNECTED
    );
    expect(await asUser.query(api.integrations.github.pullRequests.get, { projectId: other._id, repositoryId, number: 1 })).toBeNull();
  });
});

async function normalizedPr(t: T, repositoryId: Id<"integrationRepositories">) {
  const row = await t.run((run) =>
    run.db
      .query("integrationPullRequests")
      .withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", repositoryId).eq("number", 1))
      .unique()
  );
  const keys = Object.keys(normalizedPullRequestValidator.fields) as (keyof NormalizedPullRequest)[];
  return Object.fromEntries(keys.map((key) => [key, row![key]])) as NormalizedPullRequest;
}
