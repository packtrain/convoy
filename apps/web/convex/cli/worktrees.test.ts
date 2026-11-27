import * as cliProfilesRepo from "./lib/cliProfilesRepo";
import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { buildPathEntry } from "../../convex-testing/builders";
import { mergeProfilePaths, mergeWorktreeEntries, setProfilePathsIfChanged } from "./lib/cliProfilesRepo";

describe("cli worktrees", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup() {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();

    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    const repoPath = buildPathEntry({
      path: "/home/dev/repo",
      gitRemoteUrl: "git@github.com:acme/repo.git",
    });
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [repoPath],
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    return {
      ctx,
      user,
      project,
      asUser,
      t,
      apiKey: apiKeyResult.key,
      profile,
      repoPath,
      session,
    };
  }

  describe("threads.create with worktree spec", () => {
    test("keeps the parent checkout when an existing worktree disappears from discovery", async () => {
      const s = await setup();
      const entry = buildPathEntry({ path: "/wt/existing", kind: "worktree", parentPathId: s.repoPath.id, branch: "feat/existing" });
      await s.t.run(async (ctx) => {
        await ctx.db.patch("cliProfiles", s.profile._id, { paths: [s.repoPath, entry] });
      });
      const threadId = await s.asUser.mutation(api.cli.threads.core.create, {
        profileId: s.profile._id, pathId: entry.id, cliType: "claude-code", content: "Review this worktree",
      });
      await s.t.mutation(api.cli.worktrees.sync, {
        profileId: s.profile._id, sessionId: s.session._id, apiKey: s.apiKey,
        scannedParentPaths: [s.repoPath.path], worktrees: [],
      });
      const pending = await s.t.query(api.cli.threads.lists.listPendingThreads, { profileId: s.profile._id, apiKey: s.apiKey });
      expect(pending.find((item) => item._id === threadId)?.worktree).toMatchObject({
        parentPathId: s.repoPath.id, parentPath: s.repoPath.path,
        parentGitRemoteUrl: s.repoPath.gitRemoteUrl, branch: "feat/existing", status: "created",
      });
    });

    test("stores a pending spec and exposes it via listPendingThreads", async () => {
      const s = await setup();

      const threadId = await s.asUser.mutation(api.cli.threads.core.create, {
        profileId: s.profile._id,
        pathId: s.repoPath.id,
        cliType: "claude-code",
        content: "Fix the login bug",
        worktree: {
          parentPathId: s.repoPath.id,
          branch: "feat/fix-login",
          baseRef: "main",
          startFromOrigin: true,
        },
      });

      const pending = await s.t.query(api.cli.threads.lists.listPendingThreads, {
        profileId: s.profile._id,
        apiKey: s.apiKey,
      });
      const item = pending.find((chat) => chat._id === threadId);
      expect(item?.workingDirectory).toBe(s.repoPath.path);
      expect(item?.worktree).toMatchObject({
        parentPathId: s.repoPath.id,
        branch: "feat/fix-login",
        baseRef: "main",
        startFromOrigin: true,
        status: "pending",
      });
    });

    test("rejects mismatched parent, worktree parents, and invalid branches", async () => {
      const s = await setup();
      const base = {
        profileId: s.profile._id,
        cliType: "claude-code" as const,
        content: "hello",
      };

      await expect(
        s.asUser.mutation(api.cli.threads.core.create, {
          ...base,
          pathId: s.repoPath.id,
          worktree: { parentPathId: "other-path", branch: "feat/x" },
        })
      ).rejects.toThrow("Worktree parent must match the selected path");

      await expect(
        s.asUser.mutation(api.cli.threads.core.create, {
          ...base,
          pathId: s.repoPath.id,
          worktree: { parentPathId: s.repoPath.id, branch: "bad..branch" },
        })
      ).rejects.toThrow("Invalid worktree branch name");

      const worktreeEntry = buildPathEntry({
        path: "/home/dev/repo-worktrees/feat-x",
        kind: "worktree",
        parentPathId: s.repoPath.id,
        branch: "feat/x",
      });
      await s.t.run(async (runCtx) => {
        await runCtx.db.patch("cliProfiles", s.profile._id, {
          paths: [s.repoPath, worktreeEntry],
        });
      });
      await expect(
        s.asUser.mutation(api.cli.threads.core.create, {
          ...base,
          pathId: worktreeEntry.id,
          worktree: { parentPathId: worktreeEntry.id, branch: "feat/y" },
        })
      ).rejects.toThrow("Worktrees can only be created from a repository path");
    });
  });

  describe("resolveCreated", () => {
    test("returns canonical workspace state at run start without another profile read", async () => {
      const s = await setup();
      const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        pathId: s.repoPath.id, path: "/stale-snapshot",
        git: {
          previousWorkingDirectory: "/removed",
          worktree: { parentPathId: s.repoPath.id, branch: "feat/fix", status: "pending" },
        },
        claimedBySessionId: s.session._id, claimLeaseExpiresAt: Date.now() + 120000,
      });
      const message = await s.ctx.cliMessage(thread._id, s.profile._id);
      const reads = vi.spyOn(cliProfilesRepo, "getCliProfileById");
      try {
        const started = await s.t.mutation(api.cli.messages.startRunResponse, {
          threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey,
          userMessageIds: [message._id],
        });
        expect(started).toMatchObject({ workspace: {
          pathId: s.repoPath.id, path: s.repoPath.path, previousPath: "/removed",
          worktree: {
            parentPathId: s.repoPath.id, parentPath: s.repoPath.path,
            parentGitRemoteUrl: s.repoPath.gitRemoteUrl, branch: "feat/fix", status: "pending",
          },
        } });
        expect(reads).toHaveBeenCalledTimes(1);
      } finally {
        reads.mockRestore();
      }
    });

    test("loads the profile once when reading a claimed workspace", async () => {
      const s = await setup();
      const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        pathId: s.repoPath.id, path: s.repoPath.path,
        claimedBySessionId: s.session._id, claimLeaseExpiresAt: Date.now() + 120000,
      });
      const reads = vi.spyOn(cliProfilesRepo, "getCliProfileById");
      try {
        await s.t.query(api.cli.worktrees.getExecutionWorkspace, {
          threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey,
        });
        expect(reads).toHaveBeenCalledTimes(1);
      } finally {
        reads.mockRestore();
      }
    });

    test("rejects container threads even if stale data carries a live claim", async () => {
      const s = await setup();
      const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        kind: "group", claimedBySessionId: s.session._id, claimLeaseExpiresAt: Date.now() + 120000,
      });
      await expect(s.t.query(api.cli.worktrees.getExecutionWorkspace, {
        threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey,
      })).rejects.toThrow("Groups and workflow runs cannot be processed by a CLI");
    });

    test("acknowledges recovery context only for the matching completed run", async () => {
      const s = await setup();
      const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        path: s.repoPath.path, pathId: s.repoPath.id,
        git: { previousWorkingDirectory: "/removed" },
        claimedBySessionId: s.session._id, claimLeaseExpiresAt: Date.now() + 120000,
      });
      const message = await s.ctx.cliMessage(thread._id, s.profile._id, {
        role: "assistant", status: "streaming", claimedBySessionId: s.session._id,
      });
      const args = { messageId: message._id, sessionId: s.session._id, apiKey: s.apiKey };
      await s.t.mutation(api.cli.messages.complete, { ...args,
        workspaceNotice: { previousPath: "/older", path: s.repoPath.path },
      });
      expect(await s.t.query(api.cli.worktrees.getExecutionWorkspace, {
        threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey,
      })).toMatchObject({ previousPath: "/removed" });
      await s.t.mutation(api.cli.messages.complete, { ...args,
        workspaceNotice: { previousPath: "/removed", path: s.repoPath.path },
      });
      expect(await s.t.query(api.cli.worktrees.getExecutionWorkspace, {
        threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey,
      })).not.toHaveProperty("previousPath");
    });

    test("repairs a claimed thread after discovery prunes its worktree", async () => {
      const s = await setup();
      const threadId = await s.asUser.mutation(api.cli.threads.core.create, {
        profileId: s.profile._id, pathId: s.repoPath.id, cliType: "claude-code", content: "Continue",
        worktree: { parentPathId: s.repoPath.id, branch: "feat/fix" },
      });
      await s.t.mutation(api.cli.worktrees.resolveCreated, {
        threadId, sessionId: s.session._id, apiKey: s.apiKey, path: "/wt/removed", branch: "feat/fix",
      });
      await s.t.mutation(api.cli.worktrees.sync, {
        profileId: s.profile._id, sessionId: s.session._id, apiKey: s.apiKey,
        scannedParentPaths: [s.repoPath.path], worktrees: [],
      });
      await s.t.mutation(api.cli.threads.runControl.claimThread, { threadId, sessionId: s.session._id, apiKey: s.apiKey, leaseMs: 120000 });
      await s.t.mutation(api.cli.worktrees.resolveExecutionWorkspace, {
        threadId, sessionId: s.session._id, apiKey: s.apiKey,
        expectedPath: "/wt/removed", path: s.repoPath.path, repositoryId: "repository-1", branch: "main",
      });
      const workspace = await s.t.query(api.cli.worktrees.getExecutionWorkspace, { threadId, sessionId: s.session._id, apiKey: s.apiKey });
      expect(workspace).toEqual({ pathId: s.repoPath.id, path: s.repoPath.path, previousPath: "/wt/removed" });
      const thread = await s.asUser.query(api.cli.threads.core.get, { threadId });
      expect(thread?.branch).toBe("main");
      await expect(s.t.mutation(api.cli.worktrees.resolveExecutionWorkspace, {
        threadId, sessionId: s.session._id, apiKey: s.apiKey,
        expectedPath: "/wt/removed", path: "/somewhere-else", repositoryId: "repository-1", branch: "main",
      })).rejects.toThrow("Thread working directory changed");
      const op = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        pathId: s.repoPath.id, path: s.repoPath.path,
      });
      // Release the recovered thread before enqueueing Undo in the parent.
      await s.t.mutation(api.cli.threads.runControl.releaseClaim, {
        threadId, sessionId: s.session._id, apiKey: s.apiKey,
      });
      const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id, pathId: s.repoPath.id, kind: "revertRun",
        preRef: `refs/convoy/checkpoints/${threadId}/old-run/pre`,
      });
      expect(await s.asUser.query(api.cli.worktreeOps.get, { opId }))
        .toMatchObject({ allowLegacyCheckpoint: false });
      const safeOpId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id, pathId: s.repoPath.id, kind: "revertRun",
        preRef: `refs/convoy/checkpoints/${op._id}/old-run/pre`,
      });
      expect(await s.asUser.query(api.cli.worktreeOps.get, { opId: safeOpId }))
        .toMatchObject({ allowLegacyCheckpoint: true });
      await s.t.mutation(api.cli.threads.runControl.claimThread, {
        threadId, sessionId: s.session._id, apiKey: s.apiKey, leaseMs: 120000,
      });
      const otherSession = await s.ctx.cliSession(s.profile._id, s.session.apiKeyId);
      await expect(s.t.query(api.cli.worktrees.getExecutionWorkspace, {
        threadId, sessionId: otherSession._id, apiKey: s.apiKey,
      })).rejects.toThrow("not claimed by this session");
      vi.setSystemTime(Date.now() + 120001);
      await expect(s.t.query(api.cli.worktrees.getExecutionWorkspace, {
        threadId, sessionId: s.session._id, apiKey: s.apiKey,
      })).rejects.toThrow("not claimed by this session");
    });

    test("registers the worktree path and repoints the thread; idempotent", async () => {
      const s = await setup();
      const threadId = await s.asUser.mutation(api.cli.threads.core.create, {
        profileId: s.profile._id,
        pathId: s.repoPath.id,
        cliType: "claude-code",
        content: "Fix it",
        worktree: { parentPathId: s.repoPath.id, branch: "feat/fix" },
      });

      const worktreePath = "/home/dev/repo-worktrees/feat-fix";
      const resolveArgs = {
        threadId,
        sessionId: s.session._id,
        path: worktreePath,
        branch: "feat/fix",
        apiKey: s.apiKey,
      };
      await s.t.mutation(api.cli.worktrees.resolveCreated, resolveArgs);
      await s.t.mutation(api.cli.worktrees.resolveCreated, resolveArgs);

      const { thread, profile } = await s.t.run(async (runCtx) => ({
        thread: await runCtx.db.get("cliThreads", threadId),
        profile: await runCtx.db.get("cliProfiles", s.profile._id),
      }));

      const worktreeEntries = profile!.paths.filter((path) => path.kind === "worktree");
      expect(worktreeEntries).toHaveLength(1);
      expect(worktreeEntries[0]).toMatchObject({
        path: worktreePath,
        branch: "feat/fix",
        parentPathId: s.repoPath.id,
        gitRemoteUrl: s.repoPath.gitRemoteUrl,
      });

      expect(thread?.pathId).toBe(worktreeEntries[0]!.id);
      expect(thread?.path).toBe(worktreePath);
      expect(thread?.git?.worktree?.status).toBe("created");
    });

    test("rejects when the thread has no worktree spec", async () => {
      const s = await setup();
      const threadId = await s.asUser.mutation(api.cli.threads.core.create, {
        profileId: s.profile._id,
        pathId: s.repoPath.id,
        cliType: "claude-code",
        content: "No worktree here",
      });

      await expect(
        s.t.mutation(api.cli.worktrees.resolveCreated, {
          threadId,
          sessionId: s.session._id,
          path: "/tmp/x",
          branch: "feat/x",
          apiKey: s.apiKey,
        })
      ).rejects.toThrow("Thread has no pending worktree");
    });
  });

  describe("moveThread", () => {
    const target = "/home/dev/repo-worktrees/feat-x";
    const move = { path: target, repositoryId: "repository-1", worktreeId: "worktree-1", branch: "feat/x" };

    async function runningLocalThread(s: Awaited<ReturnType<typeof setup>>) {
      const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        pathId: s.repoPath.id, path: s.repoPath.path,
        claimedBySessionId: s.session._id, claimLeaseExpiresAt: Date.now() + 120000,
      });
      const message = await s.ctx.cliMessage(thread._id, s.profile._id, {
        role: "assistant", status: "streaming", claimedBySessionId: s.session._id,
      });
      return { thread, message };
    }

    test("repoints a running local thread at the worktree for its next run", async () => {
      const s = await setup();
      const { thread, message } = await runningLocalThread(s);

      await s.t.mutation(api.cli.worktrees.moveThread, { threadId: thread._id, apiKey: s.apiKey, ...move });

      const workspace = await s.t.query(api.cli.worktrees.getExecutionWorkspace, {
        threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey,
      });
      expect(workspace).toMatchObject({
        path: target, previousPath: s.repoPath.path, movedByAgent: true,
        worktree: {
          parentPathId: s.repoPath.id, parentPath: s.repoPath.path, parentGitRemoteUrl: s.repoPath.gitRemoteUrl,
          repositoryId: "repository-1", worktreeId: "worktree-1", branch: "feat/x", status: "created",
        },
      });
      const profile = await s.t.run((ctx) => ctx.db.get("cliProfiles", s.profile._id));
      expect(profile?.paths.find((path) => path.id === workspace.pathId))
        .toMatchObject({ path: target, kind: "worktree", parentPathId: s.repoPath.id, branch: "feat/x" });
      expect((await s.asUser.query(api.cli.threads.core.get, { threadId: thread._id }))?.branch).toBe("feat/x");

      // The current run still finishes in the old checkout: its reports must not undo the move.
      await s.t.mutation(api.cli.threads.runControl.reportExecutionBranch, {
        threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey, branch: "main", path: s.repoPath.path,
      });
      await s.t.mutation(api.cli.threads.runControl.reportPullRequest, {
        threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey, path: s.repoPath.path,
        pullRequest: {
          provider: "github", number: 1, title: "Old branch", url: "https://github.com/acme/repo/pull/1",
          state: "open", headBranch: "main", baseBranch: "main", capturedAt: Date.now(),
        },
      });
      await s.t.mutation(api.cli.messages.complete, { messageId: message._id, sessionId: s.session._id, apiKey: s.apiKey });
      const after = await s.asUser.query(api.cli.threads.core.get, { threadId: thread._id });
      expect(after?.branch).toBe("feat/x");
      expect(after?.pullRequest).toBeUndefined();
      expect(await s.t.query(api.cli.worktrees.getExecutionWorkspace, {
        threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey,
      })).toMatchObject({ previousPath: s.repoPath.path, movedByAgent: true });
    });

    test("the next completed run acknowledges the move", async () => {
      const s = await setup();
      const { thread, message } = await runningLocalThread(s);
      await s.t.mutation(api.cli.worktrees.moveThread, { threadId: thread._id, apiKey: s.apiKey, ...move });

      await s.t.mutation(api.cli.messages.complete, {
        messageId: message._id, sessionId: s.session._id, apiKey: s.apiKey,
        workspaceNotice: { previousPath: s.repoPath.path, path: target },
      });

      const workspace = await s.t.query(api.cli.worktrees.getExecutionWorkspace, {
        threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey,
      });
      expect(workspace).not.toHaveProperty("previousPath");
      expect(workspace).not.toHaveProperty("movedByAgent");
    });

    test("moves a worktree thread to another worktree of the same repository only", async () => {
      const s = await setup();
      const entry = buildPathEntry({ path: "/wt/old", kind: "worktree", parentPathId: s.repoPath.id, branch: "feat/old" });
      await s.t.run(async (ctx) => {
        await ctx.db.patch("cliProfiles", s.profile._id, { paths: [s.repoPath, entry] });
      });
      const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        pathId: entry.id, path: entry.path,
        git: { worktree: { parentPathId: s.repoPath.id, repositoryId: "repository-1", worktreeId: "old", branch: "feat/old", status: "created" } },
      });

      await expect(s.t.mutation(api.cli.worktrees.moveThread, {
        threadId: thread._id, apiKey: s.apiKey, ...move, repositoryId: "other-repository",
      })).rejects.toThrow("The parent checkout no longer matches this thread's repository");
      await expect(s.t.mutation(api.cli.worktrees.moveThread, {
        threadId: thread._id, apiKey: s.apiKey, ...move, path: s.repoPath.path,
      })).rejects.toThrow("Not a linked worktree of this thread's repository");

      await s.t.mutation(api.cli.worktrees.moveThread, { threadId: thread._id, apiKey: s.apiKey, ...move });
      const stored = await s.t.run((ctx) => ctx.db.get("cliThreads", thread._id));
      expect(stored).toMatchObject({
        path: target,
        git: { previousWorkingDirectory: "/wt/old", worktree: { worktreeId: "worktree-1", branch: "feat/x", status: "created" } },
      });
    });

    test("refuses legacy Undo checkpoints in the new checkout", async () => {
      const s = await setup();
      const { thread } = await runningLocalThread(s);
      await s.t.mutation(api.cli.worktrees.moveThread, { threadId: thread._id, apiKey: s.apiKey, ...move });
      await s.t.mutation(api.cli.threads.runControl.releaseClaim, { threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey });

      const stored = await s.t.run((ctx) => ctx.db.get("cliThreads", thread._id));
      const opId = await s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id, pathId: stored!.pathId, kind: "revertRun",
        preRef: `refs/convoy/checkpoints/${thread._id}/old-run/pre`,
      });
      expect(await s.asUser.query(api.cli.worktreeOps.get, { opId })).toMatchObject({ allowLegacyCheckpoint: false });
    });

    test("keeps the checkout the run is still in protected from discards and removal", async () => {
      const s = await setup();
      const entry = buildPathEntry({ path: "/wt/old", kind: "worktree", parentPathId: s.repoPath.id, branch: "feat/old" });
      await s.t.run(async (ctx) => {
        await ctx.db.patch("cliProfiles", s.profile._id, { paths: [s.repoPath, entry] });
      });
      const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        pathId: entry.id, path: entry.path,
        git: { worktree: { parentPathId: s.repoPath.id, repositoryId: "repository-1", worktreeId: "old", branch: "feat/old", status: "created" } },
        claimedBySessionId: s.session._id, claimLeaseExpiresAt: Date.now() + 120000,
      });
      await s.t.mutation(api.cli.worktrees.moveThread, { threadId: thread._id, apiKey: s.apiKey, ...move });

      await expect(s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id, pathId: entry.id, kind: "revertWorkingFile", filePath: "src/index.ts",
      })).rejects.toThrow("A thread is currently running in this working directory");
      await expect(s.asUser.mutation(api.cli.worktreeOps.enqueue, {
        profileId: s.profile._id, pathId: entry.id, kind: "remove",
      })).rejects.toThrow("A thread is currently running in this worktree");
    });

    test("a second move keeps the directory the run is in as the previous one", async () => {
      const s = await setup();
      const { thread } = await runningLocalThread(s);
      await s.t.mutation(api.cli.worktrees.moveThread, { threadId: thread._id, apiKey: s.apiKey, ...move });
      await s.t.mutation(api.cli.worktrees.moveThread, {
        threadId: thread._id, apiKey: s.apiKey, ...move, path: "/home/dev/repo-worktrees/feat-y", worktreeId: "worktree-2", branch: "feat/y",
      });

      await s.t.mutation(api.cli.threads.runControl.reportExecutionBranch, {
        threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey, branch: "main", path: s.repoPath.path,
      });
      expect((await s.asUser.query(api.cli.threads.core.get, { threadId: thread._id }))?.branch).toBe("feat/y");
      expect(await s.t.query(api.cli.worktrees.getExecutionWorkspace, {
        threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey,
      })).toMatchObject({ path: "/home/dev/repo-worktrees/feat-y", previousPath: s.repoPath.path, movedByAgent: true });
    });

    test("moving back to the directory the run is in clears the pending move", async () => {
      const s = await setup();
      const entry = buildPathEntry({ path: "/wt/old", kind: "worktree", parentPathId: s.repoPath.id, branch: "feat/old" });
      await s.t.run(async (ctx) => {
        await ctx.db.patch("cliProfiles", s.profile._id, { paths: [s.repoPath, entry] });
      });
      const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        pathId: entry.id, path: entry.path,
        git: { worktree: { parentPathId: s.repoPath.id, repositoryId: "repository-1", worktreeId: "old", branch: "feat/old", status: "created" } },
        claimedBySessionId: s.session._id, claimLeaseExpiresAt: Date.now() + 120000,
      });
      await s.t.mutation(api.cli.worktrees.moveThread, { threadId: thread._id, apiKey: s.apiKey, ...move });
      await s.t.mutation(api.cli.worktrees.moveThread, {
        threadId: thread._id, apiKey: s.apiKey, ...move, path: entry.path, worktreeId: "old", branch: "feat/old",
      });

      const workspace = await s.t.query(api.cli.worktrees.getExecutionWorkspace, {
        threadId: thread._id, sessionId: s.session._id, apiKey: s.apiKey,
      });
      expect(workspace).toMatchObject({ pathId: entry.id, path: entry.path });
      expect(workspace).not.toHaveProperty("previousPath");
      expect(workspace).not.toHaveProperty("movedByAgent");
    });

    test("rejects a thread whose worktree is still pending", async () => {
      const s = await setup();
      const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        pathId: s.repoPath.id, path: s.repoPath.path,
        git: { worktree: { parentPathId: s.repoPath.id, branch: "feat/fix", status: "pending" } },
      });
      await expect(s.t.mutation(api.cli.worktrees.moveThread, { threadId: thread._id, apiKey: s.apiKey, ...move }))
        .rejects.toThrow("The thread's worktree is still being created");
    });
  });

  describe("sync", () => {
    test("adds, keeps stable ids, and prunes scanned worktrees", async () => {
      const s = await setup();
      const syncArgs = {
        profileId: s.profile._id,
        sessionId: s.session._id,
        apiKey: s.apiKey,
      };

      await s.t.mutation(api.cli.worktrees.sync, {
        ...syncArgs,
        scannedParentPaths: [s.repoPath.path],
        worktrees: [
          { parentPath: s.repoPath.path, path: "/wt/a", branch: "feat/a" },
          { parentPath: s.repoPath.path, path: "/wt/b", branch: "feat/b" },
        ],
      });

      const firstPaths = await s.t.run(async (runCtx) => (await runCtx.db.get("cliProfiles", s.profile._id))!.paths);
      const firstA = firstPaths.find((path) => path.path === "/wt/a");
      expect(firstPaths.filter((path) => path.kind === "worktree")).toHaveLength(2);

      // Re-sync: /wt/a survives with the same id, /wt/b was removed on disk.
      await s.t.mutation(api.cli.worktrees.sync, {
        ...syncArgs,
        scannedParentPaths: [s.repoPath.path],
        worktrees: [{ parentPath: s.repoPath.path, path: "/wt/a", branch: "feat/a" }],
      });

      const secondPaths = await s.t.run(async (runCtx) => (await runCtx.db.get("cliProfiles", s.profile._id))!.paths);
      const worktrees = secondPaths.filter((path) => path.kind === "worktree");
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0]!.id).toBe(firstA!.id);
      expect(secondPaths.some((path) => path.id === s.repoPath.id)).toBe(true);
    });

    test("ignores unknown parents and main-checkout collisions", async () => {
      const s = await setup();

      await s.t.mutation(api.cli.worktrees.sync, {
        profileId: s.profile._id,
        sessionId: s.session._id,
        apiKey: s.apiKey,
        scannedParentPaths: [s.repoPath.path],
        worktrees: [
          { parentPath: "/unknown/repo", path: "/wt/x", branch: "feat/x" },
          // The main checkout must never become a worktree entry.
          { parentPath: s.repoPath.path, path: s.repoPath.path, branch: "main" },
        ],
      });

      const paths = await s.t.run(async (runCtx) => (await runCtx.db.get("cliProfiles", s.profile._id))!.paths);
      expect(paths.filter((path) => path.kind === "worktree")).toHaveLength(0);
    });

    /**
     * The CLI re-syncs on every connect and after every worktree op, usually with
     * an identical scan, and `sync` writes through `setProfilePathsIfChanged`
     * (OS-1721). Exercises that helper against a *stored* document, which is where
     * absent-vs-`undefined` fields decide whether the skip fires at all;
     * `patch.test.ts` covers the predicate over plain objects.
     */
    test("setProfilePathsIfChanged skips a stored path list it matches", async () => {
      const s = await setup();
      const syncArgs = {
        profileId: s.profile._id,
        sessionId: s.session._id,
        apiKey: s.apiKey,
      };

      await s.t.mutation(api.cli.worktrees.sync, {
        ...syncArgs,
        scannedParentPaths: [s.repoPath.path],
        worktrees: [{ parentPath: s.repoPath.path, path: "/wt/a", branch: "feat/a" }],
      });

      const { unchanged, changed } = await s.t.run(async (runCtx) => {
        const profile = (await runCtx.db.get("cliProfiles", s.profile._id))!;
        return {
          unchanged: await setProfilePathsIfChanged(runCtx, profile, [...profile.paths]),
          changed: await setProfilePathsIfChanged(runCtx, profile, profile.paths.slice(1)),
        };
      });

      expect(unchanged).toBe(false);
      expect(changed).toBe(true);
    });
  });

  describe("path merge helpers", () => {
    test("mergeProfilePaths preserves worktrees of surviving parents", () => {
      const parent = buildPathEntry({ path: "/repo" });
      const otherParent = buildPathEntry({ path: "/other" });
      const worktree = buildPathEntry({
        path: "/wt/a",
        kind: "worktree",
        parentPathId: parent.id,
        branch: "feat/a",
      });
      const orphanWorktree = buildPathEntry({
        path: "/wt/b",
        kind: "worktree",
        parentPathId: otherParent.id,
        branch: "feat/b",
      });

      // Reconnect reports only /repo — /other and its worktree drop out.
      const merged = mergeProfilePaths([parent, otherParent, worktree, orphanWorktree], [{ path: "/repo" }]);

      expect(merged.map((path) => path.path).sort()).toEqual(["/repo", "/wt/a"]);
      expect(merged.find((path) => path.path === "/repo")!.id).toBe(parent.id);
    });

    test("mergeWorktreeEntries keeps worktrees under unscanned parents", () => {
      const parentA = buildPathEntry({ path: "/a" });
      const parentB = buildPathEntry({ path: "/b" });
      const worktreeB = buildPathEntry({
        path: "/wt/b",
        kind: "worktree",
        parentPathId: parentB.id,
        branch: "feat/b",
      });

      const merged = mergeWorktreeEntries([parentA, parentB, worktreeB], {
        scannedParentPaths: ["/a"],
        worktrees: [{ parentPath: "/a", path: "/wt/a", branch: "feat/a" }],
      });

      expect(merged.map((path) => path.path).sort()).toEqual(["/a", "/b", "/wt/a", "/wt/b"]);
    });
  });
});
