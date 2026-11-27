import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import type { Id } from "../_generated/dataModel";
import { isSessionLive } from "./lib/cliSessionsRepo";

describe("cliSessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("validateApiKey", () => {
    test("should validate active API key", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      const validation = await t.query(internal.apiKeys.core.validateByKey, {
        apiKey: result.key,
      });

      expect(validation).not.toBeNull();
      expect(validation?.userId).toBe(user._id);
      expect(validation?.apiKeyId).toBe(result.id);
    });

    test("should reject expired API key", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      // Expire the key
      await t.run(async (runCtx) => {
        await runCtx.db.patch("apiKeys", result.id, {
          expiresAt: Date.now() - 1000,
        });
      });

      const validation = await t.query(internal.apiKeys.core.validateByKey, {
        apiKey: result.key,
      });

      expect(validation).toBeNull();
    });

    test("should reject invalid API key", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      const validation = await t.query(internal.apiKeys.core.validateByKey, {
        apiKey: "sk_user_invalid_key_12345",
      });

      expect(validation).toBeNull();
    });
  });

  describe("register", () => {
    test("should create new session and profile", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      // Create API key
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-1",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      expect(result.sessionId).toBeDefined();
      expect(result.profileId).toBeDefined();

      // Verify session in DB
      await t.run(async (runCtx) => {
        const session = await runCtx.db.get("cliSessions", result.sessionId);
        expect(session).toBeDefined();
        expect(session?.instanceId).toBe("test-instance-1");
        expect(session?.profileId).toBe(result.profileId);
        expect(session?.apiKeyId).toBe(apiKeyResult.id);
        expect(session?.availableClis).toEqual([]);
        expect(session?.startedAt).toBeDefined();
        expect(session?.isOnline).toBe(true);
        const heartbeat = await runCtx.db
          .query("cliSessionHeartbeats")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", result.sessionId))
          .unique();
        expect(heartbeat?.lastHeartbeatAt).toBe(session?.startedAt);

        // Verify profile
        const profile = await runCtx.db.get("cliProfiles", result.profileId);
        expect(profile).toBeDefined();
        expect(profile?.userId).toBe(user._id);
        expect(profile?.projectId).toBe(project._id);
        expect(profile?.hostname).toBe("my-laptop");
        expect(profile?.name).toBe("my-laptop"); // Default from hostname
        expect(profile?.paths).toEqual([]); // Paths empty until syncPaths
      });
    });

    test("should use custom name when provided", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-custom-name",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        name: "My Laptop",
      });

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", result.profileId);
        expect(profile?.name).toBe("My Laptop");
      });
    });

    test("should default name to CLI when no hostname", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-no-hostname",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
      });

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", result.profileId);
        expect(profile?.name).toBe("CLI");
      });
    });

    test("should sync paths during registration when provided", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-paths",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        paths: [
          { path: "/home/user/project1" },
          { path: "/home/user/project2", label: "Custom Label" },
        ],
      });

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", result.profileId);
        expect(profile?.paths).toHaveLength(2);
        expect(profile?.paths[0].path).toBe("/home/user/project1");
        expect(profile?.paths[0].label).toBe("project1"); // Default basename
        expect(profile?.paths[1].path).toBe("/home/user/project2");
        expect(profile?.paths[1].label).toBe("Custom Label");
      });
    });

    test("register stores runtimes narrow and the catalog in its own table", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const models = [{ slug: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" }];
      const advertised = [{ type: "opencode" as const, version: "1.17.13", models }];

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-last-known",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        availableClis: advertised,
      });

      const readCatalogs = async () =>
        t.run(async (runCtx) =>
          runCtx.db
            .query("cliRuntimeCatalogs")
            .withIndex("by_profile_and_cliType", (q) => q.eq("profileId", result.profileId))
            .collect()
        );

      // Neither hot row carries the catalog: the snapshot is runtimes only.
      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", result.profileId);
        expect(profile?.lastKnownClis).toEqual([{ type: "opencode", version: "1.17.13" }]);
        const session = await runCtx.db.get("cliSessions", result.sessionId);
        expect(session?.availableClis).toEqual([{ type: "opencode", version: "1.17.13" }]);
      });

      const [catalog] = await readCatalogs();
      expect(catalog).toMatchObject({ cliType: "opencode", models });

      // An empty detection (fixture/stream mode) must not wipe either snapshot.
      await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-last-known",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        availableClis: [],
      });

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", result.profileId);
        expect(profile?.lastKnownClis).toEqual([{ type: "opencode", version: "1.17.13" }]);
      });
      expect(await readCatalogs()).toHaveLength(1);

      // Re-advertising the same catalog writes nothing.
      vi.setSystemTime(Date.now() + 60_000);
      await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-last-known",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        availableClis: advertised,
      });
      expect(await readCatalogs()).toEqual([catalog]);

      // A changed catalog replaces the row.
      await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-last-known",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        availableClis: [{ type: "opencode", version: "1.18.0", models: [{ slug: "openai/gpt-5", name: "GPT-5" }] }],
      });
      expect(await readCatalogs()).toMatchObject([{ models: [{ slug: "openai/gpt-5", name: "GPT-5" }] }]);

      // Inventory query failed (20s timeout): the runtime registers with `models`
      // absent, which means UNKNOWN. Deleting here would drop the catalog the
      // table exists to keep across a bad detection (OS-1721).
      await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-last-known",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        availableClis: [{ type: "opencode", version: "1.18.0" }],
      });
      expect(await readCatalogs()).toMatchObject([{ models: [{ slug: "openai/gpt-5", name: "GPT-5" }] }]);

      // Inventory succeeded with nothing connected: an explicit empty catalog
      // clears the row, so a disconnected provider stops offering models.
      await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-last-known",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        availableClis: [{ type: "opencode", version: "1.18.0", models: [] }],
      });
      expect(await readCatalogs()).toEqual([]);
    });

    test("a registration without the runtime at all drops its catalog", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      const register = (availableClis: Parameters<typeof t.mutation>[1]["availableClis"]) =>
        t.mutation(internal.cli.sessions.register, {
          instanceId: "instance-runtime-gone",
          userId: user._id,
          apiKeyId: apiKeyResult.id,
          projectId: project._id,
          hostname: "my-laptop",
          availableClis,
        });

      const result = await register([
        { type: "opencode", version: "1.18.0", models: [{ slug: "openai/gpt-5", name: "GPT-5" }] },
      ]);

      // OpenCode uninstalled or downgraded below the minimum: not advertised at all.
      await register([{ type: "codex", version: "0.9.0" }]);

      await t.run(async (runCtx) => {
        expect(
          await runCtx.db
            .query("cliRuntimeCatalogs")
            .withIndex("by_profile_and_cliType", (q) => q.eq("profileId", result.profileId))
            .collect()
        ).toEqual([]);
      });
    });

    // Covers the merge, not the one-patch shape: `mergeProfilePaths` has always
    // reused the entry id of a re-reported path.
    test("merge keeps entry ids for re-reported paths", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      const paths = [{ path: "/home/user/project1", label: "project1" }];
      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "reconnect-paths",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        paths,
      });

      const firstPaths = await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", result.profileId);
        return profile?.paths;
      });

      await t.mutation(internal.cli.sessions.register, {
        instanceId: "reconnect-paths",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        paths,
      });

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", result.profileId);
        expect(profile?.paths).toEqual(firstPaths);
      });
    });

    test("should store availableClis without the catalogs nothing reads", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-clis",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        availableClis: [
          {
            type: "claude-code",
            version: "1.0.0",
            provider: "bedrock",
            models: [
              {
                slot: "sonnet",
                label: "Sonnet 4.6",
                runModel: "us.anthropic.claude-sonnet-4-6:0",
              },
            ],
          },
          { type: "codex", version: "2.0.0" },
        ],
      });

      await t.run(async (runCtx) => {
        const session = await runCtx.db.get("cliSessions", result.sessionId);
        // Claude's advertised models are read by nothing — provider is what
        // resolves its run model, so only that survives (OS-1721).
        expect(session?.availableClis).toEqual([
          { type: "claude-code", version: "1.0.0", provider: "bedrock" },
          { type: "codex", version: "2.0.0" },
        ]);
        const catalogs = await runCtx.db
          .query("cliRuntimeCatalogs")
          .withIndex("by_profile_and_cliType", (q) => q.eq("profileId", result.profileId))
          .collect();
        expect(catalogs).toEqual([]);
      });
    });

    test("keeps a managed Gemini key's provider on Antigravity (OS-2476)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "test-instance-agy",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        availableClis: [{ type: "antigravity", version: "1.5.14", provider: "gemini" }],
      });
      await t.run(async (runCtx) => {
        const session = await runCtx.db.get("cliSessions", result.sessionId);
        expect(session?.availableClis).toEqual([{ type: "antigravity", version: "1.5.14", provider: "gemini" }]);
      });
    });

    test("allows scoped API key registration only for projects in scope", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });
      const apiKeyScope = {
        kind: "organization" as const,
        organizationId: org._id,
        projectIds: [project._id],
      };

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "scoped-register-allowed",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        apiKeyScope,
        projectId: project._id,
        hostname: "my-laptop",
      });
      expect(result.sessionId).toBeDefined();

      await expect(
        t.mutation(internal.cli.sessions.register, {
          instanceId: "scoped-register-denied",
          userId: user._id,
          apiKeyId: apiKeyResult.id,
          apiKeyScope,
          projectId: otherProject._id,
          hostname: "my-laptop",
        })
      ).rejects.toThrow("Permission denied");
    });

    test("should update existing session with same instanceId (upsert)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // Create first session
      const result1 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "same-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      // Advance time
      await vi.advanceTimersByTimeAsync(5000);

      // Register again with same instanceId
      const result2 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "same-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        name: "New Name",
      });

      // Should be the same session
      expect(result2.sessionId).toBe(result1.sessionId);
      // Should be the same profile (same user+project+profileKey)
      expect(result2.profileId).toBe(result1.profileId);
    });

    test("register persists supportsSteering and getSessionCapabilities exposes it", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "steering-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        supportsSteering: true,
      });

      await t.run(async (runCtx) => {
        const session = await runCtx.db.get("cliSessions", result.sessionId);
        expect(session?.supportsSteering).toBe(true);
      });

      const capabilities = await asUser.query(api.cli.sessions.getSessionCapabilities, {
        sessionId: result.sessionId,
      });
      expect(capabilities).toEqual({ supportsSteering: true });

      // Defaults to false when the CLI does not advertise it.
      const legacy = await t.mutation(internal.cli.sessions.register, {
        instanceId: "legacy-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        force: true,
      });
      const legacyCapabilities = await asUser.query(api.cli.sessions.getSessionCapabilities, {
        sessionId: legacy.sessionId,
      });
      expect(legacyCapabilities).toEqual({ supportsSteering: false });

      // Not visible to other users.
      const otherUser = await ctx.user();
      const asOtherUser = ctx.asUser(otherUser);
      const otherView = await asOtherUser.query(api.cli.sessions.getSessionCapabilities, {
        sessionId: legacy.sessionId,
      });
      expect(otherView).toBeNull();
    });

    test("getSessionCapabilities resolves steering per cliType", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // App-server connection advertises codex steering explicitly.
      const appServer = await t.mutation(internal.cli.sessions.register, {
        instanceId: "app-server-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        supportsSteering: true,
        steeringCliTypes: ["claude-code", "codex"],
      });
      expect(
        await asUser.query(api.cli.sessions.getSessionCapabilities, {
          sessionId: appServer.sessionId,
          cliType: "codex",
        })
      ).toEqual({ supportsSteering: true });

      // Exec-transport connection steers Claude only.
      const execTransport = await t.mutation(internal.cli.sessions.register, {
        instanceId: "exec-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        supportsSteering: true,
        steeringCliTypes: ["claude-code"],
        force: true,
      });
      expect(
        await asUser.query(api.cli.sessions.getSessionCapabilities, {
          sessionId: execTransport.sessionId,
          cliType: "codex",
        })
      ).toEqual({ supportsSteering: false });
      expect(
        await asUser.query(api.cli.sessions.getSessionCapabilities, {
          sessionId: execTransport.sessionId,
          cliType: "claude-code",
        })
      ).toEqual({ supportsSteering: true });

      // Legacy session (boolean only, CLI < 0.8.0) means Claude Code steering.
      const legacy = await t.mutation(internal.cli.sessions.register, {
        instanceId: "legacy-bool-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        supportsSteering: true,
        force: true,
      });
      expect(
        await asUser.query(api.cli.sessions.getSessionCapabilities, {
          sessionId: legacy.sessionId,
          cliType: "claude-code",
        })
      ).toEqual({ supportsSteering: true });
      expect(
        await asUser.query(api.cli.sessions.getSessionCapabilities, {
          sessionId: legacy.sessionId,
          cliType: "codex",
        })
      ).toEqual({ supportsSteering: false });
    });

    test("should reuse profile when using force", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // Create first session
      const result1 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "instance-1",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      // Create second session (different instance) using force
      const result2 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "instance-2",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        force: true,
      });

      // Sessions should be different (old one was kicked)
      expect(result2.sessionId).not.toBe(result1.sessionId);
      // Profiles should be the same (same user+project)
      expect(result2.profileId).toBe(result1.profileId);
    });

    test("should require project access", async () => {
      const ctx = createTestContext();
      const { project } = await ctx.setupProject();

      // Create a different user without project access
      const { user: otherUser, asUser: asOtherUser } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asOtherUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // Should fail because otherUser doesn't have project access
      await expect(
        ctx.t.mutation(internal.cli.sessions.register, {
          instanceId: "test-instance",
          userId: otherUser._id,
          apiKeyId: apiKeyResult.id,
          projectId: project._id,
          hostname: "test-machine",
        }),
      ).rejects.toThrow();
    });

    test("should store profileKey on profile", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "profilekey-store-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        profileKey: "os-local",
      });

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", result.profileId);
        expect(profile?.profileKey).toBe("os-local");
      });
    });

    test("should create separate profiles for different profileKeys", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result1 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "profilekey-a-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        profileKey: "os-local",
      });

      const result2 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "profilekey-b-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "devcontainer",
        profileKey: "os-devcontainer",
      });

      // Different profileKeys should create different profiles
      expect(result2.profileId).not.toBe(result1.profileId);
    });

    test("should leave profileKey undefined when not provided (backward compat)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "profilekey-undefined-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", result.profileId);
        expect(profile?.profileKey).toBeUndefined();
      });
    });

    test("should find pre-existing profile without profileKey field (migration)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // Simulate a pre-migration profile: inserted directly without profileKey field
      let legacyProfileId: Id<"cliProfiles"> | null = null;
      await t.run(async (runCtx) => {
        legacyProfileId = await runCtx.db.insert("cliProfiles", {
          userId: user._id,
          projectId: project._id,
          name: "Legacy Profile",
          hostname: "old-machine",
          paths: [],
          createdAt: Date.now(),
          lastConnectedAt: Date.now(),
          isDeleted: false,
        });
      });

      // Register without profileKey should find the legacy profile
      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "migration-test-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "old-machine",
      });

      // Should reuse the legacy profile (both have undefined profileKey)
      expect(result.profileId).toBe(legacyProfileId!);
    });

    test("should preserve profileKey on reconnect with same instanceId", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // First registration with profileKey
      const result1 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "profilekey-update-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        profileKey: "old-key",
      });

      // Same instanceId reconnecting with same profileKey
      await t.mutation(internal.cli.sessions.register, {
        instanceId: "profilekey-update-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        profileKey: "old-key",
      });

      await t.run(async (runCtx) => {
        const profile = await runCtx.db.get("cliProfiles", result1.profileId);
        expect(profile?.profileKey).toBe("old-key");
      });
    });
  });

  describe("heartbeat", () => {
    test("stamps the heartbeat row and leaves the session row alone (OS-2549)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "heartbeat-test-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });
      const before = await t.run((runCtx) => runCtx.db.get("cliSessions", result.sessionId));

      await vi.advanceTimersByTimeAsync(30000);

      const success = await t.mutation(internal.cli.sessions.heartbeat, {
        sessionId: result.sessionId,
        userId: user._id,
      });

      expect(success).toBe(true);
      await t.run(async (runCtx) => {
        // An unchanged session row is what keeps online-status subscriptions from re-running.
        expect(await runCtx.db.get("cliSessions", result.sessionId)).toEqual(before);
        const heartbeat = await runCtx.db
          .query("cliSessionHeartbeats")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", result.sessionId))
          .unique();
        expect(heartbeat?.lastHeartbeatAt).toBe(Date.now());
      });
    });

    test("brings a legacy session without online state online", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const { id: apiKeyId } = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyId, { isOnline: undefined, lastHeartbeatAt: Date.now() });

      expect(await asUser.query(api.cli.sessions.listByProject, { projectId: project._id })).toHaveLength(0);

      await t.mutation(internal.cli.sessions.heartbeat, { sessionId: session._id, userId: user._id });

      const agents = await asUser.query(api.cli.sessions.listByProject, { projectId: project._id });
      expect(agents.map((agent) => agent.isOnline)).toEqual([true]);
    });

    test("should reject heartbeat from wrong user", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const { user: otherUser } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "heartbeat-wrong-user-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      // Try heartbeat from different user
      const success = await t.mutation(internal.cli.sessions.heartbeat, {
        sessionId: result.sessionId,
        userId: otherUser._id,
      });

      expect(success).toBe(false);
    });

    test("should return false for non-existent session", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // Create and delete a session to get a valid but non-existent ID
      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "heartbeat-nonexistent-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      await t.run(async (runCtx) => {
        await runCtx.db.delete("cliSessions", result.sessionId);
      });

      const success = await t.mutation(internal.cli.sessions.heartbeat, {
        sessionId: result.sessionId,
        userId: user._id,
      });

      expect(success).toBe(false);
    });

    test("reads no cliProfiles doc when the session carries a denormalized userId", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "heartbeat-no-profile-read-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      // Removing the profile row entirely is only observable through a profile
      // read. Profile removal deletes the session instead (OS-1719).
      await t.run(async (runCtx) => {
        await runCtx.db.delete("cliProfiles", result.profileId);
      });

      const success = await t.mutation(internal.cli.sessions.heartbeat, {
        sessionId: result.sessionId,
        userId: user._id,
      });

      expect(success).toBe(true);
    });

    test("falls back to the profile for a pre-denormalization session row", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "heartbeat-legacy-session-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliSessions", result.sessionId, { userId: undefined });
        await runCtx.db.patch("cliProfiles", result.profileId, {
          isDeleted: true,
          deletedAt: Date.now(),
          deletedBy: user._id,
        });
      });

      const success = await t.mutation(internal.cli.sessions.heartbeat, {
        sessionId: result.sessionId,
        userId: user._id,
      });

      expect(success).toBe(false);
    });

    test("keeps heartbeat ownership-based when current API key scope no longer covers the session project", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });
      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "heartbeat-scope-edited",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        apiKeyScope: {
          kind: "organization",
          organizationId: org._id,
          projectIds: [project._id],
        },
        projectId: project._id,
        hostname: "my-laptop",
      });

      const success = await t.mutation(internal.cli.sessions.heartbeat, {
        sessionId: result.sessionId,
        userId: user._id,
        apiKeyScope: {
          kind: "organization",
          organizationId: org._id,
          projectIds: [otherProject._id],
        },
      });

      expect(success).toBe(true);
    });
  });

  describe("disconnect", () => {
    test("should delete session", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "disconnect-test-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      const success = await t.mutation(internal.cli.sessions.disconnect, {
        sessionId: result.sessionId,
        userId: user._id,
      });

      expect(success).toBe(true);

      // Verify session was deleted
      await t.run(async (runCtx) => {
        const session = await runCtx.db.get("cliSessions", result.sessionId);
        expect(session).toBeNull();
      });
    });

    test("should reject disconnect from wrong user", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const { user: otherUser } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "disconnect-wrong-user-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      const success = await t.mutation(internal.cli.sessions.disconnect, {
        sessionId: result.sessionId,
        userId: otherUser._id,
      });

      expect(success).toBe(false);

      // Verify session still exists
      await t.run(async (runCtx) => {
        const session = await runCtx.db.get("cliSessions", result.sessionId);
        expect(session).not.toBeNull();
      });
    });

    test("fails streaming chat and assistant when disconnecting claimed session", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "disconnect-reconcile-streaming",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        hasPendingUserMessages: true,
        status: "pending",
      });
      const userMessage = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
      });

      await t.mutation(api.cli.threads.runControl.claimThread, {
        threadId: chat._id,
        sessionId: result.sessionId,
        leaseMs: 60_000,
        apiKey: apiKeyResult.key,
      });

      const started = await t.mutation(api.cli.messages.startRunResponse, {
        threadId: chat._id,
        sessionId: result.sessionId,
        userMessageIds: [userMessage._id],
        apiKey: apiKeyResult.key,
      });

      await t.mutation(internal.cli.sessions.disconnect, {
        sessionId: result.sessionId,
        userId: user._id,
      });

      await t.run(async (runCtx) => {
        const session = await runCtx.db.get("cliSessions", result.sessionId);
        const assistant = await runCtx.db.get("cliMessages", started.assistantMessageId);
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);

        expect(session).toBeNull();
        expect(assistant?.status).toBe("failed");
        expect(assistant?.errorMessage).toBe(
          "CLI disconnected during response generation",
        );
        expect(updatedChat?.status).toBe("failed");
        expect(updatedChat?.processingState).toBe("idle");
        expect(updatedChat?.claimedBySessionId).toBeUndefined();
        expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
        expect(updatedChat?.streamWatchdogId).toBeUndefined();
      });
    });

    test("requeues claimed chat without active assistant on disconnect", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "disconnect-requeue-claimed",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        hasPendingUserMessages: true,
        status: "pending",
      });
      await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
      });

      await t.mutation(api.cli.threads.runControl.claimThread, {
        threadId: chat._id,
        sessionId: result.sessionId,
        leaseMs: 60_000,
        apiKey: apiKeyResult.key,
      });

      await t.mutation(internal.cli.sessions.disconnect, {
        sessionId: result.sessionId,
        userId: user._id,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("pending");
        expect(updatedChat?.hasPendingUserMessages).toBe(true);
        expect(updatedChat?.processingState).toBe("idle");
        expect(updatedChat?.claimedBySessionId).toBeUndefined();
        expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
      });
    });

    test("releases non-streaming claimed chat without forcing pending when queue is empty", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const result = await t.mutation(internal.cli.sessions.register, {
        instanceId: "disconnect-requeue-empty-queue",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "completed",
        processingState: "claimed",
        hasPendingUserMessages: false,
        claimedBySessionId: result.sessionId,
        claimedAt: Date.now(),
        claimLeaseExpiresAt: Date.now() + 60_000,
      });

      await t.mutation(internal.cli.sessions.disconnect, {
        sessionId: result.sessionId,
        userId: user._id,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("completed");
        expect(updatedChat?.hasPendingUserMessages).toBe(false);
        expect(updatedChat?.processingState).toBe("idle");
        expect(updatedChat?.claimedBySessionId).toBeUndefined();
        expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
      });
    });
  });

  describe("listByProject", () => {
    test("should list online sessions with profile info", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      await t.mutation(internal.cli.sessions.register, {
        instanceId: "list-online-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        name: "My Laptop",
        paths: [{ path: "/home/user/myproject" }],
        availableClis: [{ type: "claude-code", version: "1.0.0" }],
        appVersion: "0.28.0",
      });

      const agents = await asUser.query(api.cli.sessions.listByProject, {
        projectId: project._id,
      });

      expect(agents).toHaveLength(1);
      expect(agents[0].userName).toBe(user.name);
      expect(agents[0].name).toBe("My Laptop");
      expect(agents[0].paths).toHaveLength(1);
      expect(agents[0].paths[0].path).toBe("/home/user/myproject");
      expect(agents[0].isOnline).toBe(true);
      expect(agents[0].availableClis).toEqual([
        { type: "claude-code", version: "1.0.0" },
      ]);
      expect(agents[0].appVersion).toBe("0.28.0");
    });

    test("should include profileKey in results", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      await t.mutation(internal.cli.sessions.register, {
        instanceId: "list-profilekey-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        name: "My Laptop",
        profileKey: "os-local",
        paths: [{ path: "/home/user/myproject" }],
      });

      const agents = await asUser.query(api.cli.sessions.listByProject, {
        projectId: project._id,
      });

      expect(agents).toHaveLength(1);
      expect(agents[0].profileKey).toBe("os-local");
    });

    test("drops a session once the sweep takes it offline", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      await t.mutation(internal.cli.sessions.register, {
        instanceId: "list-offline-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      // Silence alone changes nothing a query reads; the sweep does.
      await vi.advanceTimersByTimeAsync(61 * 1000);
      expect(await asUser.query(api.cli.sessions.listByProject, { projectId: project._id })).toHaveLength(1);

      await t.mutation(internal.cli.sessions.sweepOfflineSessions, {});

      expect(await asUser.query(api.cli.sessions.listByProject, { projectId: project._id })).toHaveLength(0);
    });

    test("should not return another member's sessions (OS-2321)", async () => {
      const ctx = createTestContext();
      const { user, project, org, asUser, t } = await ctx.setupProject();

      // Add another user to the project
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      await ctx.projectMember(project._id, otherUser._id, "member");
      const asOtherUser = ctx.asUser(otherUser);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Create API keys for both users
      const apiKey1 = await asUser.mutation(api.apiKeys.core.create, {
        name: "User 1 CLI",
        expiresAt,
      });
      const apiKey2 = await asOtherUser.mutation(api.apiKeys.core.create, {
        name: "User 2 CLI",
        expiresAt,
      });

      // Register sessions for both (different users = different profiles)
      await t.mutation(internal.cli.sessions.register, {
        instanceId: "list-multi-user1-instance",
        userId: user._id,
        apiKeyId: apiKey1.id,
        projectId: project._id,
        hostname: "user1-laptop",
      });
      await t.mutation(internal.cli.sessions.register, {
        instanceId: "list-multi-user2-instance",
        userId: otherUser._id,
        apiKeyId: apiKey2.id,
        projectId: project._id,
        hostname: "user2-laptop",
      });

      const agents = await asUser.query(api.cli.sessions.listByProject, {
        projectId: project._id,
      });

      expect(agents.map((a) => a.instanceId)).toEqual(["list-multi-user1-instance"]);

      const otherAgents = await asOtherUser.query(api.cli.sessions.listByProject, {
        projectId: project._id,
      });
      expect(otherAgents.map((a) => a.instanceId)).toEqual(["list-multi-user2-instance"]);
    });

    test("should require project access", async () => {
      const ctx = createTestContext();
      const { project } = await ctx.setupProject();
      const { asUser: asOtherUser } = await ctx.setupUser();

      await expect(
        asOtherUser.query(api.cli.sessions.listByProject, {
          projectId: project._id,
        }),
      ).rejects.toThrow();
    });
  });

  describe("session conflicts", () => {
    test("should throw SESSION_CONFLICT when another session is active", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // Create first session
      await t.mutation(internal.cli.sessions.register, {
        instanceId: "conflict-instance-1",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      // Second session should fail with SESSION_CONFLICT
      await expect(
        t.mutation(internal.cli.sessions.register, {
          instanceId: "conflict-instance-2",
          userId: user._id,
          apiKeyId: apiKeyResult.id,
          projectId: project._id,
          hostname: "my-laptop",
        }),
      ).rejects.toThrow(
        "Another CLI session is already active for this project.",
      );
    });

    test("should allow same instanceId to reconnect without conflict", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // Create session
      const result1 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "reconnect-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        appVersion: "0.27.0",
      });

      // Same instanceId reconnecting should succeed
      const result2 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "reconnect-instance",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        appVersion: "0.28.0",
      });

      // Should be the same session (upsert behavior)
      expect(result2.sessionId).toBe(result1.sessionId);

      // Reconnect refreshes the reported CLI version
      await t.run(async (runCtx) => {
        const session = await runCtx.db.get("cliSessions", result2.sessionId);
        expect(session?.appVersion).toBe("0.28.0");
      });
    });

    test("should kick existing session when force=true", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // Create first session
      const result1 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "force-instance-1",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      // Second session with force=true should succeed
      const result2 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "force-instance-2",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        force: true,
      });

      // New session should be created
      expect(result2.sessionId).not.toBe(result1.sessionId);

      // Old session should be deleted
      await t.run(async (runCtx) => {
        const oldSession = await runCtx.db.get("cliSessions", result1.sessionId);
        expect(oldSession).toBeNull();
      });
    });

    test("should reconcile streaming threads before kicking session when force=true", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const session1 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "force-reconcile-1",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        hasPendingUserMessages: true,
        status: "pending",
      });
      const userMessage = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
      });

      await t.mutation(api.cli.threads.runControl.claimThread, {
        threadId: chat._id,
        sessionId: session1.sessionId,
        leaseMs: 60_000,
        apiKey: apiKeyResult.key,
      });

      const started = await t.mutation(api.cli.messages.startRunResponse, {
        threadId: chat._id,
        sessionId: session1.sessionId,
        userMessageIds: [userMessage._id],
        apiKey: apiKeyResult.key,
      });

      await t.mutation(internal.cli.sessions.register, {
        instanceId: "force-reconcile-2",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        force: true,
      });

      await t.run(async (runCtx) => {
        const kickedSession = await runCtx.db.get("cliSessions", session1.sessionId);
        const assistant = await runCtx.db.get("cliMessages", started.assistantMessageId);
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);

        expect(kickedSession).toBeNull();
        expect(assistant?.status).toBe("failed");
        expect(assistant?.errorMessage).toBe(
          "CLI session replaced by a new connection",
        );
        expect(updatedChat?.status).toBe("failed");
        expect(updatedChat?.claimedBySessionId).toBeUndefined();
        expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
      });
    });

    test("should NOT conflict when different profileKeys are used for same project", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // First session with profileKey "os-local"
      const result1 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "multi-profile-instance-1",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        profileKey: "os-local",
      });

      // Second session with different profileKey "os-devcontainer" should succeed
      const result2 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "multi-profile-instance-2",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "devcontainer",
        profileKey: "os-devcontainer",
      });

      expect(result2.sessionId).not.toBe(result1.sessionId);
      expect(result2.profileId).not.toBe(result1.profileId);

      // Both sessions should be visible in listByProject
      const agents = await asUser.query(api.cli.sessions.listByProject, {
        projectId: project._id,
      });
      expect(agents).toHaveLength(2);
    });

    test("should allow new session after previous goes offline", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // Create first session
      const result1 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "offline-instance-1",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      // The first CLI dies; the sweep has not flipped it yet, but its heartbeat is stale.
      await vi.advanceTimersByTimeAsync(61 * 1000);

      // Second session should succeed (first is offline)
      const result2 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "offline-instance-2",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
      });

      expect(result2.sessionId).not.toBe(result1.sessionId);
      // The dead session is cleaned up rather than left online beside the new one.
      expect(await t.run((runCtx) => runCtx.db.get("cliSessions", result1.sessionId))).toBeNull();
    });

    test("should kick multiple sessions when force=true", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      // Create profile first
      const profile = await ctx.cliProfile(user._id, project._id);

      // Create two sessions directly via t.run
      let session1Id: Id<"cliSessions">;
      let session2Id: Id<"cliSessions">;
      await t.run(async (runCtx) => {
        session1Id = await runCtx.db.insert("cliSessions", {
          profileId: profile._id,
          instanceId: "multi-kick-1",
          apiKeyId: apiKeyResult.id,
          userId: user._id,
          projectId: project._id,
          availableClis: [],
          startedAt: Date.now(),
          isOnline: true,
        });
        await runCtx.db.insert("cliSessionHeartbeats", { sessionId: session1Id, lastHeartbeatAt: Date.now() });
        session2Id = await runCtx.db.insert("cliSessions", {
          profileId: profile._id,
          instanceId: "multi-kick-2",
          apiKeyId: apiKeyResult.id,
          userId: user._id,
          projectId: project._id,
          availableClis: [],
          startedAt: Date.now(),
          isOnline: true,
        });
        await runCtx.db.insert("cliSessionHeartbeats", { sessionId: session2Id, lastHeartbeatAt: Date.now() });
      });

      // Third session with force=true should succeed
      const result3 = await t.mutation(internal.cli.sessions.register, {
        instanceId: "multi-kick-3",
        userId: user._id,
        apiKeyId: apiKeyResult.id,
        projectId: project._id,
        hostname: "my-laptop",
        force: true,
      });

      expect(result3.sessionId).toBeDefined();

      // Both old sessions should be deleted
      await t.run(async (runCtx) => {
        const oldSession1 = await runCtx.db.get("cliSessions", session1Id!);
        const oldSession2 = await runCtx.db.get("cliSessions", session2Id!);
        expect(oldSession1).toBeNull();
        expect(oldSession2).toBeNull();
      });
    });
  });

  describe("sweepOfflineSessions (OS-2549)", () => {
    async function setup() {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const { id: apiKeyId } = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const { sessionId } = await t.mutation(internal.cli.sessions.register, {
        instanceId: "sweep-instance",
        userId: user._id,
        apiKeyId,
        projectId: project._id,
        hostname: "my-laptop",
      });
      const listOnline = async () =>
        (await asUser.query(api.cli.sessions.listByProject, { projectId: project._id })).map((agent) => agent.sessionId);
      return { ctx, user, project, t, sessionId, listOnline };
    }

    test("leaves a session that keeps heartbeating online", async () => {
      const { user, t, sessionId, listOnline } = await setup();

      await vi.advanceTimersByTimeAsync(30_000);
      await t.mutation(internal.cli.sessions.heartbeat, { sessionId, userId: user._id });
      await vi.advanceTimersByTimeAsync(45_000);
      await t.mutation(internal.cli.sessions.sweepOfflineSessions, {});

      expect(await listOnline()).toEqual([sessionId]);
    });

    test("brings a swept session back online when it heartbeats again", async () => {
      const { user, t, sessionId, listOnline } = await setup();

      await vi.advanceTimersByTimeAsync(61_000);
      await t.mutation(internal.cli.sessions.sweepOfflineSessions, {});
      expect(await listOnline()).toEqual([]);
      expect((await t.run((runCtx) => runCtx.db.get("cliSessions", sessionId)))?.offlineAt).toBe(Date.now());

      expect(await t.mutation(internal.cli.sessions.heartbeat, { sessionId, userId: user._id })).toBe(true);

      expect(await listOnline()).toEqual([sessionId]);
      expect((await t.run((runCtx) => runCtx.db.get("cliSessions", sessionId)))?.offlineAt).toBeUndefined();
    });

    test("deletes a session offline longer than VISIBLE_THRESHOLD_MS and releases its claims", async () => {
      const { ctx, user, project, t, sessionId } = await setup();
      const session = await t.run((runCtx) => runCtx.db.get("cliSessions", sessionId));
      const thread = await ctx.cliThread(user._id, project._id, session!.profileId, {
        claimedBySessionId: sessionId,
        claimedAt: Date.now(),
        claimLeaseExpiresAt: Date.now() + 10 * 60_000,
      });

      await vi.advanceTimersByTimeAsync(61_000);
      await t.mutation(internal.cli.sessions.sweepOfflineSessions, {});
      await vi.advanceTimersByTimeAsync(5 * 60_000 - 1_000);
      await t.mutation(internal.cli.sessions.sweepOfflineSessions, {});
      expect(await t.run((runCtx) => runCtx.db.get("cliSessions", sessionId))).not.toBeNull();

      await vi.advanceTimersByTimeAsync(2_000);
      await t.mutation(internal.cli.sessions.sweepOfflineSessions, {});

      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliSessions", sessionId)).toBeNull();
        expect(await runCtx.db.query("cliSessionHeartbeats").collect()).toEqual([]);
        expect((await runCtx.db.get("cliThreads", thread._id))?.claimedBySessionId).toBeUndefined();
      });
    });
  });

  test("migrateLegacySessionHeartbeats keeps fresh legacy sessions online and lets the sweep delete dead ones (OS-2549)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const { id: apiKeyId } = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const profile = await ctx.cliProfile(user._id, project._id);
    const dead = await ctx.cliSession(profile._id, apiKeyId, { isOnline: undefined, lastHeartbeatAt: Date.now() - 60 * 60_000 });
    // A live legacy CLI heartbeated after the deploy, before the migration reached its row.
    const live = await ctx.cliSession(profile._id, apiKeyId, { isOnline: undefined, lastHeartbeatAt: Date.now() });
    await t.mutation(internal.cli.sessions.heartbeat, { sessionId: live._id, userId: user._id });
    // A live legacy CLI the migration reaches before its first post-deploy heartbeat.
    const fresh = await ctx.cliSession(profile._id, apiKeyId, { isOnline: undefined, lastHeartbeatAt: Date.now() - 10_000 });

    await t.mutation(internal.migrations.migrateLegacySessionHeartbeats, { reset: true });
    await t.mutation(internal.cli.sessions.sweepOfflineSessions, {});

    await t.run(async (runCtx) => {
      expect(await runCtx.db.get("cliSessions", dead._id)).toBeNull();
      const liveRow = await runCtx.db.get("cliSessions", live._id);
      expect(liveRow?.isOnline).toBe(true);
      expect(liveRow?.lastHeartbeatAt).toBeUndefined();
      const freshRow = await runCtx.db.get("cliSessions", fresh._id);
      expect(freshRow?.isOnline).toBe(true);
      expect(freshRow?.lastHeartbeatAt).toBeUndefined();
    });
    expect(await t.run((runCtx) => isSessionLive(runCtx, fresh._id, Date.now()))).toBe(true);
  });
});
