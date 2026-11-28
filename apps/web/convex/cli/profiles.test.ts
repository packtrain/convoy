import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { buildPathEntry } from "../../convex-testing/builders";
import type { Id } from "../_generated/dataModel";

describe("cliProfiles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("findOrCreate", () => {
    test("should create new profile", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();

      const profileId = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      expect(profileId).toBeDefined();

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", profileId);
        expect(profile).toBeDefined();
        expect(profile?.userId).toBe(user._id);
        expect(profile?.projectId).toBe(project._id);
        expect(profile?.hostname).toBe("my-laptop");
        expect(profile?.name).toBe("my-laptop"); // Default from hostname
        expect(profile?.paths).toEqual([]); // Paths managed separately via syncPaths
      });
    });

    test("should default name to CLI when no hostname", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();

      const profileId = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
      });

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", profileId);
        expect(profile?.name).toBe("CLI");
      });
    });

    test("should return existing profile and update hostname", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();

      const profileId1 = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "old-machine",
      });

      const profileId2 = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "new-machine",
      });

      // Same profile (one per user per project)
      expect(profileId2).toBe(profileId1);

      // Hostname should be updated
      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", profileId1);
        expect(profile?.hostname).toBe("new-machine");
      });
    });

    test("should not overwrite name on reconnect", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();

      const profileId1 = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "my-laptop",
        name: "Original Name",
      });

      // Reconnect without explicit name
      const profileId2 = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      expect(profileId2).toBe(profileId1);

      // Name should still be the original
      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", profileId1);
        expect(profile?.name).toBe("Original Name");
      });
    });

    test("should reuse same profile for same user+project+profileKey", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();

      const profileId1 = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "machine-1",
      });

      const profileId2 = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "machine-2",
      });

      // Same profile (same user+project+undefined profileKey)
      expect(profileId2).toBe(profileId1);
    });

    test("should create separate profiles for different profileKeys", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();

      const profileId1 = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "my-laptop",
        profileKey: "os-local",
      });

      const profileId2 = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "devcontainer",
        profileKey: "os-devcontainer",
      });

      // Different profileKeys should create different profiles
      expect(profileId2).not.toBe(profileId1);
    });

    test("should create a new profile when the matching row is soft-deleted", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();

      const profileId1 = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "my-laptop",
        profileKey: "os-local",
      });

      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliProfiles", profileId1, {
          isDeleted: true,
          deletedAt: Date.now(),
          deletedBy: user._id,
        });
      });

      const profileId2 = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "new-machine",
        profileKey: "os-local",
      });

      expect(profileId2).not.toBe(profileId1);

      await t.run(async (runCtx) => {
        const deleted = await runCtx.db.get("cliProfiles", profileId1);
        const created = await runCtx.db.get("cliProfiles", profileId2);
        expect(deleted?.isDeleted).toBe(true);
        expect(created?.isDeleted).toBe(false);
        expect(created?.hostname).toBe("new-machine");
      });
    });

    test("should require project access", async () => {
      const ctx = createTestContext();
      const { project } = await ctx.setupProject();
      const { user: otherUser } = await ctx.setupUser();

      await expect(
        ctx.t.mutation(internal.cli.profiles.findOrCreate, {
          userId: otherUser._id,
          projectId: project._id,
          hostname: "test-machine",
        }),
      ).rejects.toThrow();
    });
  });

  describe("syncPaths", () => {
    test("should add new paths with generated IDs", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();

      const profileId = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      const result = await t.mutation(internal.cli.profiles.syncPaths, {
        profileId,
        paths: [
          { path: "/home/user/project1" },
          { path: "/home/user/project2", label: "Custom Label" },
        ],
      });

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe("/home/user/project1");
      expect(result[0].id).toBeDefined();
      expect(result[1].path).toBe("/home/user/project2");

      // Verify in DB
      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", profileId);
        expect(profile?.paths).toHaveLength(2);
        expect(profile?.paths[0].label).toBe("project1"); // Default from basename
        expect(profile?.paths[1].label).toBe("Custom Label");
      });
    });

    test("should preserve existing path IDs on update", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();

      const profileId = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      // First sync
      const result1 = await t.mutation(internal.cli.profiles.syncPaths, {
        profileId,
        paths: [{ path: "/home/user/project1" }],
      });

      const originalId = result1[0].id;

      // Second sync with same path
      const result2 = await t.mutation(internal.cli.profiles.syncPaths, {
        profileId,
        paths: [{ path: "/home/user/project1", label: "Updated Label" }],
      });

      // ID should be preserved
      expect(result2[0].id).toBe(originalId);

      // Label should be updated
      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", profileId);
        expect(profile?.paths[0].label).toBe("Updated Label");
      });
    });

    test("should remove paths not in incoming list", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();

      const profileId = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      // Sync with two paths
      await t.mutation(internal.cli.profiles.syncPaths, {
        profileId,
        paths: [
          { path: "/home/user/project1" },
          { path: "/home/user/project2" },
        ],
      });

      // Sync again with only one path
      const result = await t.mutation(internal.cli.profiles.syncPaths, {
        profileId,
        paths: [{ path: "/home/user/project1" }],
      });

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("/home/user/project1");

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", profileId);
        expect(profile?.paths).toHaveLength(1);
      });
    });

    test("should update gitRemoteUrl on existing path", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();

      const profileId = await t.mutation(internal.cli.profiles.findOrCreate, {
        userId: user._id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      // First sync without gitRemoteUrl
      await t.mutation(internal.cli.profiles.syncPaths, {
        profileId,
        paths: [{ path: "/home/user/myproject" }],
      });

      // Second sync with gitRemoteUrl
      await t.mutation(internal.cli.profiles.syncPaths, {
        profileId,
        paths: [
          {
            path: "/home/user/myproject",
            gitRemoteUrl: "git@github.com:user/repo.git",
          },
        ],
      });

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", profileId);
        expect(profile?.paths[0].gitRemoteUrl).toBe(
          "git@github.com:user/repo.git",
        );
      });
    });
  });

  describe("syncRepos", () => {
    async function setup() {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const apiKey = await asUser.mutation(api.apiKeys.core.create, { name: "CLI Key", expiresAt: Date.now() + 86_400_000 });
      const top = buildPathEntry({ path: "/code/acme" });
      const other = buildPathEntry({ path: "/code/other" });
      const profile = await ctx.cliProfile(user._id, project._id, { paths: [top, other] });
      const session = await ctx.cliSession(profile._id, apiKey.id);
      // relativePath defaults to the path below the folder, as the CLI sends it.
      const sync = (path: string, repos: { path: string; relativePath?: string; gitRemoteUrl?: string; branch?: string }[]) =>
        t.mutation(api.cli.profiles.syncRepos, {
          profileId: profile._id, sessionId: session._id, apiKey: apiKey.key, path,
          repos: repos.map((repo) => ({ ...repo, relativePath: repo.relativePath ?? repo.path.slice(path.length + 1) })),
        });
      const paths = () => t.run(async (runCtx) => (await runCtx.db.get("cliProfiles", profile._id))!.paths);
      return { t, asUser, user, project, top, other, profile, session, apiKey, sync, paths };
    }

    test("adds repo entries under the top folder with stable ids", async () => {
      const s = await setup();
      await s.sync("/code/acme", [
        { path: "/code/acme/new-app", gitRemoteUrl: "git@github.com:acme/new-app.git", branch: "main" },
        { path: "/code/acme/packages/api" },
      ]);
      const first = await s.paths();
      expect(first.filter((p) => p.kind === "repo")).toEqual([
        expect.objectContaining({ path: "/code/acme/new-app", label: "new-app", kind: "repo", parentPathId: s.top.id, gitRemoteUrl: "git@github.com:acme/new-app.git", branch: "main" }),
        expect.objectContaining({ path: "/code/acme/packages/api", label: "packages/api", kind: "repo", parentPathId: s.top.id }),
      ]);

      // A repo cloned later shows up; the known one keeps its id; a removed one drops.
      await s.sync("/code/acme", [
        { path: "/code/acme/new-app", branch: "feat/x" },
        { path: "/code/acme/old-app" },
      ]);
      const second = (await s.paths()).filter((p) => p.kind === "repo");
      expect(second.map((p) => p.path)).toEqual(["/code/acme/new-app", "/code/acme/old-app"]);
      expect(second[0]!.id).toBe(first.find((p) => p.path === "/code/acme/new-app")!.id);
      expect(second[0]!.branch).toBe("feat/x");
    });

    test("leaves other paths alone and ignores relative paths that leave the folder", async () => {
      const s = await setup();
      await s.sync("/code/other", [{ path: "/code/other/web" }]);
      await s.sync("/code/acme", [
        { path: "/code/acme/app" },
        { path: "/elsewhere/app", relativePath: "../../elsewhere/app" },
        { path: "/abs", relativePath: "/abs" },
        { path: "/code/acme", relativePath: "." },
      ]);

      const repos = (await s.paths()).filter((p) => p.kind === "repo");
      // Grouped by folder in configured order, not by sync order.
      expect(repos.map((p) => [p.path, p.parentPathId])).toEqual([
        ["/code/acme/app", s.top.id],
        ["/code/other/web", s.other.id],
      ]);
    });

    test("labels a repo by the relative path the CLI sends, whatever the separator", async () => {
      const s = await setup();
      await s.t.run(async (runCtx) => {
        await runCtx.db.patch("cliProfiles", s.profile._id, { paths: [buildPathEntry({ id: s.top.id, path: "C:\\code\\acme" })] });
      });
      await s.sync("C:\\code\\acme", [{ path: "C:\\code\\acme\\packages\\api", relativePath: "packages/api" }]);
      expect((await s.paths()).filter((p) => p.kind === "repo").map((p) => [p.path, p.label])).toEqual([["C:\\code\\acme\\packages\\api", "packages/api"]]);
    });

    test("an unchanged repo sync after a worktree sync writes nothing (OS-1721)", async () => {
      const s = await setup();
      await s.sync("/code/acme", [{ path: "/code/acme/app" }]);
      await s.t.mutation(api.cli.worktrees.sync, {
        profileId: s.profile._id, sessionId: s.session._id, apiKey: s.apiKey.key,
        scannedParentPaths: ["/code/acme", "/code/acme/app"],
        worktrees: [
          // A folder that holds repos is no worktree parent; its repo is.
          { parentPath: "/code/acme", path: "/code/acme-worktrees/x", branch: "x" },
          { parentPath: "/code/acme/app", path: "/code/acme/app-worktrees/y", branch: "y" },
        ],
      });
      const before = await s.paths();
      expect(before.map((p) => [p.path, p.kind])).toEqual([
        ["/code/acme", undefined], ["/code/other", undefined], ["/code/acme/app", "repo"], ["/code/acme/app-worktrees/y", "worktree"],
      ]);
      await s.sync("/code/acme", [{ path: "/code/acme/app" }]);
      expect(await s.paths()).toEqual(before);
      const written = await s.t.run(async (runCtx) => {
        const profile = (await runCtx.db.get("cliProfiles", s.profile._id))!;
        const { mergeRepoEntries } = await import("./lib/cliProfilesRepo");
        return mergeRepoEntries(profile.paths, { parentPath: "/code/acme", repos: [{ path: "/code/acme/app", relativePath: "app" }] });
      });
      expect(written).toEqual(before);
    });

    test("an unchanged sync of one folder keeps the other folder's repos in place", async () => {
      const s = await setup();
      await s.sync("/code/acme", [{ path: "/code/acme/app" }]);
      await s.sync("/code/other", [{ path: "/code/other/web" }]);
      const before = await s.paths();
      await s.sync("/code/acme", [{ path: "/code/acme/app" }]);
      expect(await s.paths()).toEqual(before);
    });

    test("an empty scan clears the folder's repos and an unknown folder is a no-op", async () => {
      const s = await setup();
      await s.sync("/code/acme", [{ path: "/code/acme/app" }]);
      await s.sync("/code/acme", []);
      await s.sync("/nowhere", [{ path: "/nowhere/app" }]);
      expect(await s.paths()).toEqual([s.top, s.other].map((p) => expect.objectContaining({ id: p.id, path: p.path })));
    });

    test("register keeps repo entries of a surviving folder", async () => {
      const s = await setup();
      await s.sync("/code/acme", [{ path: "/code/acme/app" }]);
      await s.t.run(async (runCtx) => {
        const { findOrCreateProfile } = await import("./lib/cliProfilesRepo");
        await findOrCreateProfile(runCtx, { userId: s.user._id, projectId: s.project._id, profileKey: s.profile.profileKey, incomingPaths: [{ path: "/code/acme" }] });
      });
      expect((await s.paths()).map((p) => [p.path, p.kind])).toEqual([["/code/acme", undefined], ["/code/acme/app", "repo"]]);
    });

    test("a thread starts on a repo entry, with or without a worktree; a folder with repos has no worktrees", async () => {
      const s = await setup();
      await s.sync("/code/acme", [{ path: "/code/acme/app" }]);
      const repo = (await s.paths()).find((p) => p.kind === "repo")!;
      const create = (pathId: string, worktree?: { parentPathId: string; branch: string }) =>
        s.asUser.mutation(api.cli.threads.core.create, { profileId: s.profile._id, pathId, cliType: "claude-code", content: "hi", ...(worktree ? { worktree } : {}) });
      const plain = await create(repo.id);
      const branched = await create(repo.id, { parentPathId: repo.id, branch: "feat/x" });
      const threads = await s.t.run(async (runCtx) => Promise.all([plain, branched].map((id) => runCtx.db.get("cliThreads", id))));
      expect(threads.map((thread) => [thread?.pathId, thread?.path, thread?.git?.worktree?.parentPathId])).toEqual([
        [repo.id, "/code/acme/app", undefined], [repo.id, "/code/acme/app", repo.id],
      ]);
      await expect(create(s.top.id, { parentPathId: s.top.id, branch: "feat/y" })).rejects.toThrow(/holds several git repositories/);
    });

    test("worktrees under a repo entry sync, survive register and are pruned with their repo", async () => {
      const s = await setup();
      await s.sync("/code/acme", [{ path: "/code/acme/app" }]);
      const syncWorktrees = (worktrees: { parentPath: string; path: string; branch: string }[]) =>
        s.t.mutation(api.cli.worktrees.sync, {
          profileId: s.profile._id, sessionId: s.session._id, apiKey: s.apiKey.key, scannedParentPaths: ["/code/acme/app"], worktrees,
        });
      await syncWorktrees([{ parentPath: "/code/acme/app", path: "/code/acme/app-worktrees/y", branch: "y" }]);
      const repo = (await s.paths()).find((p) => p.kind === "repo")!;
      expect((await s.paths()).map((p) => [p.path, p.kind, p.parentPathId])).toEqual([
        ["/code/acme", undefined, undefined], ["/code/other", undefined, undefined], ["/code/acme/app", "repo", s.top.id],
        ["/code/acme/app-worktrees/y", "worktree", repo.id],
      ]);
      await s.t.run(async (runCtx) => {
        const { findOrCreateProfile } = await import("./lib/cliProfilesRepo");
        await findOrCreateProfile(runCtx, { userId: s.user._id, projectId: s.project._id, profileKey: s.profile.profileKey, incomingPaths: [{ path: "/code/acme" }] });
      });
      expect((await s.paths()).map((p) => p.path)).toEqual(["/code/acme", "/code/acme/app", "/code/acme/app-worktrees/y"]);
      await s.sync("/code/acme", []);
      expect((await s.paths()).map((p) => p.path)).toEqual(["/code/acme"]);
    });

    test("a thread on a vanished repo moves to its folder at the next run", async () => {
      const s = await setup();
      await s.sync("/code/acme", [{ path: "/code/acme/app" }]);
      const repo = (await s.paths()).find((p) => p.kind === "repo")!;
      const threadId = await s.asUser.mutation(api.cli.threads.core.create, { profileId: s.profile._id, pathId: repo.id, cliType: "claude-code", content: "hi" });
      const [onRepo] = await s.t.query(api.cli.threads.lists.listPendingThreads, { profileId: s.profile._id, apiKey: s.apiKey.key });
      // The server names a repo thread's folder, so the CLI never guesses it from paths.
      expect(onRepo.projectFolder).toBe("/code/acme");
      await s.sync("/code/acme", []);
      const [pending] = await s.t.query(api.cli.threads.lists.listPendingThreads, { profileId: s.profile._id, apiKey: s.apiKey.key });
      expect([pending.pathId, pending.workingDirectory, pending.projectFolder]).toEqual([s.top.id, "/code/acme", undefined]);

      const userMessages = await s.t.run((runCtx) => runCtx.db.query("cliMessages").withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId)).collect());
      await s.t.mutation(api.cli.threads.runControl.claimThread, { threadId, sessionId: s.session._id, leaseMs: 60_000, apiKey: s.apiKey.key });
      const started = await s.t.mutation(api.cli.messages.startRunResponse, {
        threadId, sessionId: s.session._id, userMessageIds: userMessages.map((message) => message._id), apiKey: s.apiKey.key,
      });
      expect(started.workspace).toMatchObject({ pathId: s.top.id, path: "/code/acme", previousPath: "/code/acme/app" });
      const thread = await s.t.run((runCtx) => runCtx.db.get("cliThreads", threadId));
      expect([thread?.pathId, thread?.path, thread?.git?.previousWorkingDirectory]).toEqual([s.top.id, "/code/acme", "/code/acme/app"]);
    });

    test("rejects a session of another profile", async () => {
      const s = await setup();
      const other = await s.t.run((runCtx) => runCtx.db.insert("cliProfiles", {
        userId: s.user._id, projectId: s.project._id, profileKey: "other", name: "Other", paths: [], createdAt: 0, isDeleted: false,
      }));
      await expect(
        s.t.mutation(api.cli.profiles.syncRepos, { profileId: other, sessionId: s.session._id, apiKey: s.apiKey.key, path: "/code/acme", repos: [] })
      ).rejects.toThrow("Session cannot process threads for a different profile");
    });
  });

  describe("get", () => {
    test("should return profile with online status", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();

      // Create profile
      const profile = await ctx.cliProfile(user._id, project._id, {
        name: "Test Profile",
        profileKey: "os-local",
        paths: [
          {
            id: "path-1",
            path: "/home/user/myproject",
            label: "myproject",
          },
        ],
      });

      const result = await asUser.query(api.cli.profiles.get, {
        profileId: profile._id,
      });

      expect(result).toBeDefined();
      expect(result?.name).toBe("Test Profile");
      expect(result?.profileKey).toBe("os-local");
      expect(result?.paths).toHaveLength(1);
      expect(result?.paths[0].path).toBe("/home/user/myproject");
      expect(result?.isOnline).toBe(false); // No active session
      expect(result?.availableClis).toEqual([]);
    });

    test("falls back to the profile's lastKnownClis when offline", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const lastKnown = [
        {
          type: "opencode" as const,
          version: "1.17.13",
          models: [
            {
              slug: "anthropic/claude-sonnet-5",
              name: "Claude Sonnet 5",
            },
          ],
        },
      ];

      const profile = await ctx.cliProfile(user._id, project._id, {
        name: "Offline With Snapshot",
      });
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliProfiles", profile._id, {
          lastKnownClis: lastKnown,
        });
      });

      const result = await asUser.query(api.cli.profiles.get, {
        profileId: profile._id,
      });
      expect(result?.isOnline).toBe(false);
      expect(result?.availableClis).toEqual(lastKnown);

      const listed = await asUser.query(api.cli.profiles.listByProject, {
        projectId: project._id,
      });
      expect(listed.find((p) => p._id === profile._id)?.availableClis).toEqual(
        lastKnown,
      );
    });

    test("live session availableClis win over the profile snapshot", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliProfiles", profile._id, {
          lastKnownClis: [{ type: "codex" as const, version: "0.1.0" }],
        });
      });
      await ctx.cliSession(profile._id, apiKeyResult.id, {
        availableClis: [{ type: "codex", version: "0.142.3" }],
      });

      const result = await asUser.query(api.cli.profiles.get, {
        profileId: profile._id,
      });
      expect(result?.isOnline).toBe(true);
      expect(result?.availableClis).toEqual([
        { type: "codex", version: "0.142.3" },
      ]);
    });

    test("should show online when session active", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();

      // Create API key
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // Create profile with session
      const profile = await ctx.cliProfile(user._id, project._id);

      await ctx.cliSession(profile._id, apiKeyResult.id, {
        appVersion: "0.28.0",
        availableClis: [
          {
            type: "claude-code",
            version: "1.0.0",
            provider: "bedrock",
            models: [
              {
                slot: "sonnet-1m",
                label: "Sonnet 4.6 (1M)",
                runModel: "us.anthropic.claude-sonnet-4-6:0[1m]",
              },
            ],
          },
        ],
      });

      const result = await asUser.query(api.cli.profiles.get, {
        profileId: profile._id,
      });

      expect(result?.isOnline).toBe(true);
      expect(result?.appVersion).toBe("0.28.0");
      expect(result?.availableClis).toEqual([
        {
          type: "claude-code",
          version: "1.0.0",
          provider: "bedrock",
          models: [
            {
              slot: "sonnet-1m",
              label: "Sonnet 4.6 (1M)",
              runModel: "us.anthropic.claude-sonnet-4-6:0[1m]",
            },
          ],
        },
      ]);
    });

    test("should return null for non-existent profile", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      // Create and delete a profile to get a valid but non-existent ID
      const profile = await ctx.cliProfile(user._id, project._id);
      await t.run(async (runCtx) => {
        await runCtx.db.delete("cliProfiles", profile._id);
      });

      const result = await asUser.query(api.cli.profiles.get, {
        profileId: profile._id,
      });

      expect(result).toBeNull();
    });

    test("should return null for a soft-deleted profile", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const profile = await ctx.cliProfile(user._id, project._id);
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliProfiles", profile._id, {
          isDeleted: true,
          deletedAt: Date.now(),
          deletedBy: user._id,
        });
      });

      const result = await asUser.query(api.cli.profiles.get, {
        profileId: profile._id,
      });

      expect(result).toBeNull();
    });

    test("should return null for a profile in a project out of reach", async () => {
      const ctx = createTestContext();
      const { user, project } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const { asUser: asOutsider } = await ctx.setupUser();

      expect(await asOutsider.query(api.cli.profiles.get, { profileId: profile._id })).toBeNull();
    });
  });

  describe("project viewers", () => {
    test("read profile lists and catalogs without throwing", async () => {
      const ctx = createTestContext();
      const { org, project } = await ctx.setupProject();
      const viewer = await ctx.user();
      await ctx.orgMember(org._id, viewer._id, "member");
      await ctx.projectMember(project._id, viewer._id, "viewer");
      const asViewer = ctx.asUser(viewer);
      const profile = await ctx.cliProfile(viewer._id, project._id);

      expect(await asViewer.query(api.cli.profiles.get, { profileId: profile._id })).toMatchObject({ _id: profile._id });
      expect(await asViewer.query(api.cli.profiles.listByProject, { projectId: project._id })).toHaveLength(1);
      expect(await asViewer.query(api.cli.profiles.listRuntimeCatalogs, { projectId: project._id })).toEqual([]);
    });
  });

  describe("listByProject", () => {
    test("should list only the current user's profiles for the project", async () => {
      const ctx = createTestContext();
      const { user, project, org, asUser } = await ctx.setupProject();

      // Add another user to the project
      const user2 = await ctx.user();
      await ctx.orgMember(org._id, user2._id, "member");
      await ctx.projectMember(project._id, user2._id, "member");

      // Create profiles for different users (one per user per project)
      await ctx.cliProfile(user._id, project._id, {
        name: "User 1 Profile",
        profileKey: "os-local",
      });
      await ctx.cliProfile(user2._id, project._id, {
        name: "User 2 Profile",
        profileKey: "os-devcontainer",
        hostname: "teammate-machine",
        paths: [
          {
            id: "teammate-path",
            path: "/home/teammate/private-repo",
            label: "private-repo",
          },
        ],
      });

      const profiles = await asUser.query(api.cli.profiles.listByProject, {
        projectId: project._id,
      });

      expect(profiles).toHaveLength(1);
      expect(profiles[0]?.name).toBe("User 1 Profile");
      expect(profiles[0]?.profileKey).toBe("os-local");
      expect(profiles.map((profile) => profile.hostname)).not.toContain("teammate-machine");
      expect(profiles.flatMap((profile) => profile.paths.map((path) => path.path))).not.toContain(
        "/home/teammate/private-repo"
      );
    });

    test("should include online status", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      await ctx.cliProfile(user._id, project._id, {
        name: "Offline",
        profileKey: "os-offline",
      });

      const onlineProfile = await ctx.cliProfile(user._id, project._id, {
        name: "Online",
        profileKey: "os-online",
      });
      await ctx.cliSession(onlineProfile._id, apiKeyResult.id);

      const profiles = await asUser.query(api.cli.profiles.listByProject, {
        projectId: project._id,
      });

      expect(profiles).toHaveLength(2);
      const offline = profiles.find((e) => e.name === "Offline");
      const online = profiles.find((e) => e.name === "Online");
      expect(offline?.isOnline).toBe(false);
      expect(online?.isOnline).toBe(true);
      expect(offline?.profileKey).toBe("os-offline");
      expect(online?.profileKey).toBe("os-online");
    });

    test("should require project access", async () => {
      const ctx = createTestContext();
      const { project } = await ctx.setupProject();
      const { asUser: asOtherUser } = await ctx.setupUser();

      await expect(
        asOtherUser.query(api.cli.profiles.listByProject, {
          projectId: project._id,
        }),
      ).rejects.toThrow();
    });

    test("should exclude soft-deleted profiles", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const activeProfile = await ctx.cliProfile(user._id, project._id, {
        name: "Active",
        profileKey: "os-active",
      });
      const deletedProfile = await ctx.cliProfile(user._id, project._id, {
        name: "Deleted",
        profileKey: "os-deleted",
      });

      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliProfiles", deletedProfile._id, {
          isDeleted: true,
          deletedAt: Date.now(),
          deletedBy: user._id,
        });
      });

      const profiles = await asUser.query(api.cli.profiles.listByProject, {
        projectId: project._id,
      });

      expect(profiles).toHaveLength(1);
      expect(profiles[0]?._id).toBe(activeProfile._id);
    });

    // `list_cli_profiles` (OS-1162) is how an agent discovers spawn targets, and
    // it authenticates by API key with no Clerk identity — hence `t`, not
    // `asUser`.
    test("accepts a valid API key with no Clerk identity", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id, { name: "Laptop" });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "MCP Profiles",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      const profiles = await t.query(api.cli.profiles.listByProject, {
        projectId: project._id,
        apiKey: key,
      });

      expect(profiles.map((entry) => entry._id)).toEqual([profile._id]);
      expect(profiles[0]?.isOnline).toBe(false);
    });

    test("denies a key scoped to another organization", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      await ctx.cliProfile(user._id, project._id, { name: "Laptop" });
      // The caller can hold this key, but it is scoped away from this project:
      // the credential boundary must be applied, not merely resolved. Passing
      // `user._id` instead of `principal` would let this through.
      const otherOrg = await ctx.organization(user._id, { name: "Other Org", slug: "other-org" });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Other-org key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: { organizationId: otherOrg._id, projectIds: [] },
      });

      await expect(
        t.query(api.cli.profiles.listByProject, { projectId: project._id, apiKey: key })
      ).rejects.toThrow("Permission denied");
    });
  });

  describe("listForUser", () => {
    test("lists only the current user's active profiles across organizations and projects", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject({
        organization: { name: "Alpha Org", slug: "alpha-org" },
        project: { name: "Alpha Project", alias: "ALP" },
      });
      const secondProject = await ctx.project(org._id, user._id, {
        name: "Beta Project",
        alias: "BET",
        isArchived: true,
      });
      const secondOrg = await ctx.organization(user._id, {
        name: "Gamma Org",
        slug: "gamma-org",
      });
      const thirdProject = await ctx.project(secondOrg._id, user._id, {
        name: "Gamma Project",
        alias: "GAM",
      });

      const first = await ctx.cliProfile(user._id, project._id, {
        name: "Laptop",
        profileKey: "local",
        hostname: "laptop.local",
        lastConnectedAt: Date.now() - 5_000,
      });
      await ctx.cliProfile(user._id, secondProject._id, { name: "Devcontainer" });
      await ctx.cliProfile(user._id, thirdProject._id, { name: "Remote VM" });

      const otherUser = await ctx.user();
      await ctx.cliProfile(otherUser._id, project._id, { name: "Someone Else" });
      const deleted = await ctx.cliProfile(user._id, project._id, { name: "Deleted" });
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliProfiles", deleted._id, {
          isDeleted: true,
          deletedAt: Date.now(),
          deletedBy: user._id,
        });
      });

      const result = await asUser.query(api.cli.profiles.listForUser, {});

      expect(result).toHaveLength(3);
      expect(result.map((profile) => profile.name)).not.toContain("Someone Else");
      expect(result.map((profile) => profile.name)).not.toContain("Deleted");
      expect(result.find((profile) => profile._id === first._id)).toMatchObject({
        hostname: "laptop.local",
        profileKey: "local",
        isOnline: false,
        project: { name: "Alpha Project", alias: "ALP", isArchived: false },
        organization: { name: "Alpha Org", slug: "alpha-org" },
      });
      expect(result.find((profile) => profile.project?.alias === "BET")?.project?.isArchived).toBe(true);
      expect(result.find((profile) => profile.project?.alias === "GAM")?.organization?.name).toBe("Gamma Org");
    });

    test("uses live runtime data and connection timing over the offline snapshot", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const apiKey = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const profile = await ctx.cliProfile(user._id, project._id, {
        lastKnownClis: [{ type: "codex", version: "0.1.0" }],
      });
      const startedAt = Date.now() - 20_000;
      await ctx.cliSession(profile._id, apiKey.id, {
        startedAt,
        availableClis: [
          {
            type: "claude-code",
            version: "2.1.3",
            provider: "anthropic",
            models: [
              { slot: "default", label: "Default", runModel: "default" },
            ],
          },
        ],
      });

      const result = await asUser.query(api.cli.profiles.listForUser, {});

      expect(result[0]).toMatchObject({
        _id: profile._id,
        isOnline: true,
        sessionStartedAt: startedAt,
        runtimes: [
          {
            type: "claude-code",
            version: "2.1.3",
            provider: "anthropic",
            modelCount: 1,
          },
        ],
      });

      await t.run(async (runCtx) => {
        const session = await runCtx.db
          .query("cliSessions")
          .withIndex("by_profile_and_isOnline", (q) => q.eq("profileId", profile._id))
          .first();
        if (session) {
          await runCtx.db.patch("cliSessions", session._id, { isOnline: false, offlineAt: Date.now() });
        }
      });

      const offlineResult = await asUser.query(api.cli.profiles.listForUser, {});
      expect(offlineResult[0]).toMatchObject({
        isOnline: false,
        runtimes: [{ type: "codex", version: "0.1.0" }],
      });
      expect(offlineResult[0]?.sessionStartedAt).toBeUndefined();
    });

    test("retains an owned profile without leaking inaccessible project metadata", async () => {
      const ctx = createTestContext();
      const { user, asUser } = await ctx.setupUser();
      const owner = await ctx.user();
      const org = await ctx.organization(owner._id, { name: "Private Org" });
      const project = await ctx.project(org._id, owner._id, { name: "Private Project" });
      const profile = await ctx.cliProfile(user._id, project._id, { name: "Stale Profile" });

      const result = await asUser.query(api.cli.profiles.listForUser, {});

      expect(result).toHaveLength(1);
      expect(result[0]?._id).toBe(profile._id);
      expect(result[0]?.project).toBeUndefined();
      expect(result[0]?.organization).toBeUndefined();
    });
  });

  describe("rename", () => {
    test("should rename profile with trimmed non-empty name", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const profile = await ctx.cliProfile(user._id, project._id, {
        name: "Original Name",
      });

      await asUser.mutation(api.cli.profiles.rename, {
        profileId: profile._id,
        name: "  New Name  ",
      });

      await t.run(async (runCtx) => {
        const updated = await runCtx.db.get("cliProfiles", profile._id);
        expect(updated?.name).toBe("New Name");
      });
    });

    test("falls back to hostname when name is cleared", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const profile = await ctx.cliProfile(user._id, project._id, {
        name: "Original Name",
        hostname: "my-machine",
        profileKey: "os-local",
      });

      await asUser.mutation(api.cli.profiles.rename, {
        profileId: profile._id,
        name: "   ",
      });

      await t.run(async (runCtx) => {
        const updated = await runCtx.db.get("cliProfiles", profile._id);
        expect(updated?.name).toBe("my-machine");
      });
    });

    test("falls back to profileKey when hostname is unavailable", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const profile = await ctx.cliProfile(user._id, project._id, {
        name: "Original Name",
        hostname: undefined,
        profileKey: "os-devcontainer",
      });

      await asUser.mutation(api.cli.profiles.rename, {
        profileId: profile._id,
        name: "",
      });

      await t.run(async (runCtx) => {
        const updated = await runCtx.db.get("cliProfiles", profile._id);
        expect(updated?.name).toBe("os-devcontainer");
      });
    });

    test("rejects empty rename when hostname and profileKey are unavailable", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();

      const profile = await ctx.cliProfile(user._id, project._id, {
        name: "Original Name",
        hostname: undefined,
        profileKey: undefined,
      });

      await expect(
        asUser.mutation(api.cli.profiles.rename, {
          profileId: profile._id,
          name: "   ",
        }),
      ).rejects.toThrow("Hostname and profile key unavailable. Enter a name.");
    });

    test("should reject rename from non-owner", async () => {
      const ctx = createTestContext();
      const { user, project, org } = await ctx.setupProject();

      // Add another user to the project
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      await ctx.projectMember(project._id, otherUser._id, "member");
      const asOtherUser = ctx.asUser(otherUser);

      // Create profile owned by first user
      const profile = await ctx.cliProfile(user._id, project._id, {
        name: "Original Name",
      });

      // Other user tries to rename
      await expect(
        asOtherUser.mutation(api.cli.profiles.rename, {
          profileId: profile._id,
          name: "New Name",
        }),
      ).rejects.toThrow("Not authorized");
    });

    test("should reject rename for a soft-deleted profile", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const profile = await ctx.cliProfile(user._id, project._id, {
        name: "Original Name",
      });

      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliProfiles", profile._id, {
          isDeleted: true,
          deletedAt: Date.now(),
          deletedBy: user._id,
        });
      });

      await expect(
        asUser.mutation(api.cli.profiles.rename, {
          profileId: profile._id,
          name: "New Name",
        }),
      ).rejects.toThrow("Profile not found");
    });
  });

  describe("listRuntimeCatalogs", () => {
    /** A catalog row for `profile`, denormalized like `register` writes it. */
    async function seedCatalog(
      ctx: ReturnType<typeof createTestContext>,
      profile: { _id: string; projectId: string; userId: string },
      slug: string
    ) {
      await ctx.t.run(async (runCtx) => {
        await runCtx.db.insert("cliRuntimeCatalogs", {
          profileId: profile._id as Id<"cliProfiles">,
          projectId: profile.projectId as Id<"projects">,
          userId: profile.userId as Id<"users">,
          cliType: "opencode",
          models: [{ slug, name: slug }],
          reportedAt: Date.now(),
        });
      });
    }

    test("returns the caller's catalogs for the project, one subscription for every profile", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const first = await ctx.cliProfile(user._id, project._id);
      const second = await ctx.cliProfile(user._id, project._id, { profileKey: "second" });
      await seedCatalog(ctx, first, "openai/gpt-5");
      await seedCatalog(ctx, second, "openai/gpt-4");

      const catalogs = await asUser.query(api.cli.profiles.listRuntimeCatalogs, { projectId: project._id });

      expect(catalogs.map((catalog) => catalog.profileId).sort()).toEqual([first._id, second._id].sort());
      expect(catalogs.every((catalog) => catalog.cliType === "opencode")).toBe(true);
    });

    test("excludes another project's and another user's catalogs", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, { name: "Beta", alias: "BET" });
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      await ctx.projectMember(project._id, otherUser._id, "member");

      const mine = await ctx.cliProfile(user._id, project._id);
      const elsewhere = await ctx.cliProfile(user._id, otherProject._id);
      const theirs = await ctx.cliProfile(otherUser._id, project._id);
      await seedCatalog(ctx, mine, "openai/mine");
      await seedCatalog(ctx, elsewhere, "openai/elsewhere");
      await seedCatalog(ctx, theirs, "openai/theirs");

      const catalogs = await asUser.query(api.cli.profiles.listRuntimeCatalogs, { projectId: project._id });

      expect(catalogs.map((catalog) => catalog.models[0]?.slug)).toEqual(["openai/mine"]);
    });

    // Same credential boundary as `listByProject`: a scoped key must not read
    // outside its projects, and a revoked member must not read at all.
    test("denies a key scoped away from the project", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      await seedCatalog(ctx, profile, "openai/gpt-5");
      const otherOrg = await ctx.organization(user._id, { name: "Other Org", slug: "other-org" });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Other-org key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: { organizationId: otherOrg._id, projectIds: [] },
      });

      await expect(
        t.query(api.cli.profiles.listRuntimeCatalogs, { projectId: project._id, apiKey: key })
      ).rejects.toThrow("Permission denied");
    });

    test("denies a caller who has lost project access", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      await seedCatalog(ctx, profile, "openai/gpt-5");
      await ctx.t.run(async (runCtx) => {
        const membership = await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) => q.eq("projectId", project._id).eq("userId", user._id))
          .unique();
        if (membership) {
          await runCtx.db.delete("projectMembers", membership._id);
        }
      });

      await expect(
        asUser.query(api.cli.profiles.listRuntimeCatalogs, { projectId: project._id })
      ).rejects.toThrow();
    });
  });

  describe("remove", () => {
    test("soft-deletes a profile, disconnects sessions, and drops its catalogs", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const profile = await ctx.cliProfile(user._id, project._id, {
        name: "To Delete",
      });

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliRuntimeCatalogs", {
          profileId: profile._id,
          projectId: project._id,
          userId: user._id,
          cliType: "opencode",
          models: [{ slug: "openai/gpt-5", name: "GPT-5" }],
          reportedAt: Date.now(),
        });
      });

      await asUser.mutation(api.cli.profiles.remove, {
        profileId: profile._id,
      });

      await t.run(async (runCtx) => {
        const deletedProfile = await runCtx.db.get("cliProfiles", profile._id);
        const deletedSession = await runCtx.db.get("cliSessions", session._id);
        expect(deletedProfile?.isDeleted).toBe(true);
        expect(deletedProfile?.deletedAt).toBeDefined();
        expect(deletedProfile?.deletedBy).toBe(user._id);
        expect(deletedSession).toBeNull();
        expect(
          await runCtx.db
            .query("cliRuntimeCatalogs")
            .withIndex("by_profile_and_cliType", (q) => q.eq("profileId", profile._id))
            .collect()
        ).toEqual([]);
      });
    });

    test("rejects deleting another user's profile", async () => {
      const ctx = createTestContext();
      const { user, project, org } = await ctx.setupProject();
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      await ctx.projectMember(project._id, otherUser._id, "member");
      const asOtherUser = ctx.asUser(otherUser);

      const profile = await ctx.cliProfile(user._id, project._id);

      await expect(
        asOtherUser.mutation(api.cli.profiles.remove, {
          profileId: profile._id,
        }),
      ).rejects.toThrow("Not authorized");
    });

    test("rejects deleting an already deleted profile", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const profile = await ctx.cliProfile(user._id, project._id);
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliProfiles", profile._id, {
          isDeleted: true,
          deletedAt: Date.now(),
          deletedBy: user._id,
        });
      });

      await expect(
        asUser.mutation(api.cli.profiles.remove, {
          profileId: profile._id,
        }),
      ).rejects.toThrow("Profile not found");
    });
  });
});
