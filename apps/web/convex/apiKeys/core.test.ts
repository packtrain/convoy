import { afterEach, expect, test, describe, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { hashApiKey, isLastUsedAtStale } from "../lib/access/apiKeys";
import { mintApiKey } from "../lib/access/mintApiKey";
import type { MutationCtx } from "../_generated/server";

/** convex-test bumps a transaction's clock past earlier commits in the same ms; let real time pass it. */
function tickPastLastCommit() {
  return new Promise((resolve) => setTimeout(resolve, 2));
}

const FIRST_PAGE = { numItems: 100, cursor: null };
/** Index names of every query `c.db` runs while recording; full-table scans record "(scan)". */
function recordQueries(c: MutationCtx) {
  const indexes: string[] = [];
  const query = c.db.query.bind(c.db);
  const spy = vi.spyOn(c.db, "query").mockImplementation((table) => {
    const q = query(table);
    indexes.push("(scan)");
    const withIndex = q.withIndex.bind(q) as (...args: unknown[]) => unknown;
    Object.assign(q, { withIndex: (...args: unknown[]) => (indexes.splice(-1, 1, String(args[0])), withIndex(...args)) });
    return q;
  });
  return { indexes, restore: () => spy.mockRestore() };
}

type Harness = Awaited<ReturnType<ReturnType<typeof createTestContext>["setupUser"]>>;
type Caller = Harness["asUser"];
const listKeys = async (as: Caller) =>
  (await as.query(api.apiKeys.core.list, { paginationOpts: FIRST_PAGE })).page;

describe("apiKeys", () => {
  describe("currentScope", () => {
    test("returns only the authenticated key's scope", async () => {
      const ctx = createTestContext();
      const { org, project, asUser, t } = await ctx.setupProject();
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Isolated worker", expiresAt: Date.now() + 86400000,
        scope: { organizationId: org._id, projectIds: [project._id] },
      });
      expect(await t.query(api.apiKeys.core.currentScope, { apiKey: key })).toEqual({
        kind: "organization", organizationId: org._id, projectIds: [project._id],
      });
      const broad = await asUser.mutation(api.apiKeys.core.create, {
        name: "Control", expiresAt: Date.now() + 86400000,
      });
      expect(await t.query(api.apiKeys.core.currentScope, { apiKey: broad.key })).toEqual({ kind: "unscoped" });
      await expect(t.query(api.apiKeys.core.currentScope, { apiKey: "invalid" })).rejects.toThrow("Not authenticated");
      await asUser.mutation(api.apiKeys.core.deleteKey, { id: broad.id });
      await expect(t.query(api.apiKeys.core.currentScope, { apiKey: broad.key })).rejects.toThrow("Not authenticated");
    });
  });
  describe("create", () => {
    test("should create a new API key", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      expect(result.id).toBeDefined();
      expect(result.key).toMatch(/^sk_user_/);
      expect(result.key).toHaveLength(40); // "sk_user_" (8) + 32 base64 chars

      // Verify in DB
      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey).toBeDefined();
        expect(apiKey?.userId).toBe(user._id);
        expect(apiKey?.name).toBe("Test Key");
        expect(apiKey?.keyPrefix).toBe(result.key.substring(0, 16));
        expect(apiKey?.expiresAt).toBe(expiresAt);
        // Verify key is hashed (not stored in plaintext)
        expect(apiKey?.keyHash).not.toBe(result.key);
      });
    });

    test("creates a key without expiration that stays valid and lists no expiry", async () => {
      const { asUser, t } = await createTestContext().setupUser();
      const result = await asUser.mutation(api.apiKeys.core.create, { name: "Forever" });

      expect(await t.query(internal.apiKeys.core.validateByKey, { apiKey: result.key })).not.toBeNull();
      const [listed] = await listKeys(asUser);
      expect(listed.expiresAt).toBeUndefined();
    });

    test("should reject expiration more than 1 year in the future", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const expiresAt = Date.now() + 367 * 24 * 60 * 60 * 1000; // > 1 year + clock skew tolerance

      await expect(
        asUser.mutation(api.apiKeys.core.create, {
          name: "Test Key",
          expiresAt,
        })
      ).rejects.toThrow("at most 1 year");
    });

    test("should reject expiration in the past", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const expiresAt = Date.now() - 1000; // In the past

      await expect(
        asUser.mutation(api.apiKeys.core.create, {
          name: "Test Key",
          expiresAt,
        })
      ).rejects.toThrow("in the future");
    });

    test("should reject empty name", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await expect(
        asUser.mutation(api.apiKeys.core.create, {
          name: "   ", // Only whitespace
          expiresAt,
        })
      ).rejects.toThrow("name is required");
    });

    test("should reject name longer than 100 characters", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const longName = "a".repeat(101);

      await expect(
        asUser.mutation(api.apiKeys.core.create, {
          name: longName,
          expiresAt,
        })
      ).rejects.toThrow("100 characters or less");
    });

    test("should trim whitespace from name", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "  Test Key  ",
        expiresAt,
      });

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.name).toBe("Test Key");
      });
    });

    test("mints past 100 existing keys without reading them", async () => {
      const { user, asUser, t } = await createTestContext().setupUser();
      const expiresAt = Date.now() + 86400000;
      await t.run(async (c) => {
        for (let i = 0; i < 150; i++) await mintApiKey(c, user._id, { name: `Key ${i}`, expiresAt, scope: undefined });
      });
      await expect(asUser.mutation(api.apiKeys.core.create, { name: "One more", expiresAt })).resolves.toHaveProperty("id");
      await t.run(async (c) => {
        const queries = recordQueries(c);
        for (const kind of [undefined, "cli-login", "mcp-oauth"] as const)
          await mintApiKey(c, user._id, { name: "fresh", expiresAt, scope: undefined, kind });
        expect(queries.indexes).toEqual([]);
      });
    });

    test("replaceSameName replaces only the key with the same kind and name, in one lookup", async () => {
      const { user, t } = await createTestContext().setupUser();
      const expiresAt = Date.now() + 86400000;
      const names = await t.run(async (c) => {
        await mintApiKey(c, user._id, { name: "CLI login (a)", expiresAt, scope: undefined, kind: "cli-login" });
        await mintApiKey(c, user._id, { name: "CLI login (b)", expiresAt, scope: undefined, kind: "cli-login" });
        await mintApiKey(c, user._id, { name: "CLI login (a)", expiresAt, scope: undefined });
        const queries = recordQueries(c);
        const fresh = await mintApiKey(c, user._id, { name: "CLI login (a)", expiresAt, scope: undefined, kind: "cli-login", replaceSameName: true });
        queries.restore();
        expect(queries.indexes).toEqual(["by_userId_and_kind_and_name"]);
        const keys = await c.db.query("apiKeys").collect();
        expect(keys.find((k) => k.kind === "cli-login" && k.name === "CLI login (a)")?._id).toBe(fresh.id);
        return keys.map((k) => `${k.kind ?? "manual"}:${k.name}`).sort();
      });
      expect(names).toEqual(["cli-login:CLI login (a)", "cli-login:CLI login (b)", "manual:CLI login (a)"]);
    });

    test("replaceSameName revokes every same-name key, including one renamed to collide", async () => {
      const { user, asUser, t } = await createTestContext().setupUser();
      const expiresAt = Date.now() + 86400000;
      const [a, b] = await t.run(async (c) => [
        await mintApiKey(c, user._id, { name: "CLI login (a)", expiresAt, scope: undefined, kind: "cli-login" }),
        await mintApiKey(c, user._id, { name: "CLI login (b)", expiresAt, scope: undefined, kind: "cli-login" }),
      ]);
      await asUser.mutation(api.apiKeys.core.update, { id: b.id, name: "CLI login (a)", scope: null });
      await t.run((c) => mintApiKey(c, user._id, { name: "CLI login (a)", expiresAt, scope: undefined, kind: "cli-login", replaceSameName: true }));
      for (const old of [a, b]) expect(await t.query(internal.apiKeys.core.validateByKey, { apiKey: old.key })).toBeNull();
    });

    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();

      await expect(
        ctx.t.mutation(api.apiKeys.core.create, {
          name: "Test Key",
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        })
      ).rejects.toThrow("Not authenticated");
    });

    test("stores unscoped keys by default", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Unscoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.scope).toBeUndefined();
      });

      const keys = await listKeys(asUser);
      expect(keys[0].scope).toEqual({ kind: "unscoped" });
    });

    test("stores organization scope with an empty project allowlist", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Org scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [],
        },
      });

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.scope).toEqual({
          kind: "organization",
          organizationId: org._id,
          projectIds: [],
        });
      });
    });

    test("stores deduped project allowlist after validating access", async () => {
      const ctx = createTestContext();
      const { org, project, user, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Project scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id, otherProject._id, project._id],
        },
      });

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.scope?.projectIds).toEqual([
          project._id,
          otherProject._id,
        ]);
      });
    });

    test("rejects selected projects outside the scoped organization", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();
      const outsideOwner = await ctx.user();
      const outsideOrg = await ctx.organization(outsideOwner._id);
      const outsideProject = await ctx.project(outsideOrg._id, outsideOwner._id, {
        name: "Outside",
        alias: "OUT",
      });

      await expect(
        asUser.mutation(api.apiKeys.core.create, {
          name: "Invalid",
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          scope: {
            organizationId: org._id,
            projectIds: [outsideProject._id],
          },
        })
      ).rejects.toThrow("selected organization");
    });

    test("rejects selected projects the key owner cannot view", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();
      const project = await ctx.project(org._id, user._id, {
        name: "Private",
        alias: "PRIV",
      });
      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, "member");
      const asMember = ctx.asUser(member);

      await expect(
        asMember.mutation(api.apiKeys.core.create, {
          name: "Invalid",
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          scope: {
            organizationId: org._id,
            projectIds: [project._id],
          },
        })
      ).rejects.toThrow("Project not found");
    });
  });

  describe("list", () => {
    test("should list user's API keys", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await asUser.mutation(api.apiKeys.core.create, {
        name: "Key 1",
        expiresAt,
      });
      await asUser.mutation(api.apiKeys.core.create, {
        name: "Key 2",
        expiresAt,
      });

      const keys = await listKeys(asUser);

      expect(keys).toHaveLength(2);
      expect(keys.map((k) => k.name).sort()).toEqual(["Key 1", "Key 2"]);
    });

    test("returns 100 keys per page, newest first, with a cursor to the rest", async () => {
      vi.useFakeTimers();
      const { user, asUser, t } = await createTestContext().setupUser();
      await t.run(async (c) => {
        for (let i = 0; i < 101; i++) {
          vi.advanceTimersByTime(1);
          await mintApiKey(c, user._id, { name: `Key ${i}`, expiresAt: undefined, scope: undefined });
        }
      });
      vi.useRealTimers();
      const first = await asUser.query(api.apiKeys.core.list, { paginationOpts: FIRST_PAGE });
      expect(first.page).toHaveLength(100);
      expect(first.page[0].name).toBe("Key 100");
      expect(first.isDone).toBe(false);
      const rest = await asUser.query(api.apiKeys.core.list, { paginationOpts: { numItems: 100, cursor: first.continueCursor } });
      expect(rest.page.map((k) => k.name)).toEqual(["Key 0"]);
    });

    test("a worker whose source is on another page still shows the source name and status", async () => {
      const { user, project, asUser, t } = await createTestContext().setupProject();
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "Setup source", expiresAt: Date.now() + 86400000 });
      await t.run(async (c) => {
        for (let i = 0; i < 100; i++) await mintApiKey(c, user._id, { name: `Key ${i}`, expiresAt: undefined, scope: undefined });
      });
      const worker = await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
      const first = await listKeys(asUser);
      expect(first.some((k) => k._id === source.id)).toBe(false);
      expect(first.find((k) => k._id === worker.id)).toMatchObject({ workerStatus: "active", sourceKeyName: "Setup source" });
    });

    test("never names a worker's source owned by another user", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "Someone else's key", expiresAt: Date.now() + 86400000 });
      const worker = await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
      const other = await ctx.user();
      await t.run((c) => c.db.patch("apiKeys", source.id, { userId: other._id }));
      const [listed] = await listKeys(asUser);
      expect(listed._id).toBe(worker.id);
      expect(listed.workerStatus).toBe("invalid");
      expect(listed.sourceKeyName).toBeUndefined();
    });

    test("should not expose keyHash", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      const keys = await listKeys(asUser);

      expect(keys).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((keys[0] as any).keyHash).toBeUndefined();
    });

    test("should only return user's own keys", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Create key for first user
      await asUser.mutation(api.apiKeys.core.create, {
        name: "User 1 Key",
        expiresAt,
      });

      // Create second user with their own key
      const { asUser: asUser2 } = await ctx.setupUser();
      await asUser2.mutation(api.apiKeys.core.create, {
        name: "User 2 Key",
        expiresAt,
      });

      // Each user should only see their own key
      const user1Keys = await listKeys(asUser);
      const user2Keys = await listKeys(asUser2);

      expect(user1Keys).toHaveLength(1);
      expect(user1Keys[0].name).toBe("User 1 Key");

      expect(user2Keys).toHaveLength(1);
      expect(user2Keys[0].name).toBe("User 2 Key");
    });

    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();

      await expect(ctx.t.query(api.apiKeys.core.list, { paginationOpts: FIRST_PAGE })).rejects.toThrow(
        "Not authenticated"
      );
    });
  });

  describe("deleteKey", () => {
    test("should permanently delete an API key", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      await asUser.mutation(api.apiKeys.core.deleteKey, { id: result.id });

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey).toBeNull();
      });
    });

    test("should prevent deleting another user's key", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();
      const { asUser: asUser2 } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // User 1 creates a key
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "User 1 Key",
        expiresAt,
      });

      // User 2 tries to delete it
      await expect(
        asUser2.mutation(api.apiKeys.core.deleteKey, { id: result.id })
      ).rejects.toThrow("not found");
    });

    test("should fail when key not found", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      // Create and then delete a key to get a valid but non-existent ID
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      await t.run(async (runCtx) => {
        await runCtx.db.delete("apiKeys", result.id);
      });

      await expect(
        asUser.mutation(api.apiKeys.core.deleteKey, { id: result.id })
      ).rejects.toThrow("not found");
    });
  });

  describe("update", () => {
    test("should update API key name", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Original Name",
        expiresAt,
      });

      await asUser.mutation(api.apiKeys.core.update, {
        id: result.id,
        name: "Updated Name",
        scope: null,
      });

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.name).toBe("Updated Name");
      });
    });

    test("should reject empty name", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      await expect(
        asUser.mutation(api.apiKeys.core.update, {
          id: result.id,
          name: "  ",
          scope: null,
        })
      ).rejects.toThrow("name is required");
    });

    test("should reject name longer than 100 characters", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      const longName = "a".repeat(101);
      await expect(
        asUser.mutation(api.apiKeys.core.update, {
          id: result.id,
          name: longName,
          scope: null,
        })
      ).rejects.toThrow("100 characters or less");
    });

    test("should prevent updating another user's key", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();
      const { asUser: asUser2 } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "User 1 Key",
        expiresAt,
      });

      await expect(
        asUser2.mutation(api.apiKeys.core.update, {
          id: result.id,
          name: "Hacked",
          scope: null,
        })
      ).rejects.toThrow("not found");
    });

    test("updates and clears scope without rotating key metadata", async () => {
      const ctx = createTestContext();
      const { org, project, asUser, t } = await ctx.setupProject();
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      await asUser.mutation(api.apiKeys.core.update, {
        id: result.id,
        name: "Scoped",
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      const scopedKey = await t.run(async (runCtx) => runCtx.db.get("apiKeys", result.id));
      expect(scopedKey?.scope).toEqual({
        kind: "organization",
        organizationId: org._id,
        projectIds: [project._id],
      });

      await asUser.mutation(api.apiKeys.core.update, {
        id: result.id,
        name: "Scoped",
        scope: null,
      });

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.scope).toBeUndefined();
        expect(apiKey?.keyHash).toBe(scopedKey?.keyHash);
        expect(apiKey?.keyPrefix).toBe(scopedKey?.keyPrefix);
        expect(apiKey?.expiresAt).toBe(scopedKey?.expiresAt);
        expect(apiKey?.lastUsedAt).toBe(scopedKey?.lastUsedAt);
      });
    });

    test("prevents updating another user's key scope", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();
      const { asUser: asUser2 } = await ctx.setupUser();
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Owned",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      await expect(
        asUser2.mutation(api.apiKeys.core.update, {
          id: result.id,
          name: "Owned",
          scope: { organizationId: org._id, projectIds: [] },
        })
      ).rejects.toThrow("not found");
    });

    test("updates name and scope together without rotating key metadata", async () => {
      const ctx = createTestContext();
      const { org, project, asUser, t } = await ctx.setupProject();
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Original",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const before = await t.run(async (runCtx) =>
        runCtx.db.get("apiKeys", result.id)
      );

      await asUser.mutation(api.apiKeys.core.update, {
        id: result.id,
        name: "Updated",
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.name).toBe("Updated");
        expect(apiKey?.scope).toEqual({
          kind: "organization",
          organizationId: org._id,
          projectIds: [project._id],
        });
        expect(apiKey?.keyHash).toBe(before?.keyHash);
        expect(apiKey?.keyPrefix).toBe(before?.keyPrefix);
        expect(apiKey?.expiresAt).toBe(before?.expiresAt);
        expect(apiKey?.lastUsedAt).toBe(before?.lastUsedAt);
      });
    });

    test("does not commit name when scope validation fails", async () => {
      const ctx = createTestContext();
      const { user, org, asUser, t } = await ctx.setupOrg();
      const otherOrg = await ctx.organization(user._id, {
        name: "Other Org",
      });
      const otherProject = await ctx.project(otherOrg._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Original",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      await expect(
        asUser.mutation(api.apiKeys.core.update, {
          id: result.id,
          name: "Should not commit",
          scope: {
            organizationId: org._id,
            projectIds: [otherProject._id],
          },
        })
      ).rejects.toThrow("Selected projects must belong");

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.name).toBe("Original");
        expect(apiKey?.scope).toBeUndefined();
      });
    });
  });

  describe("validateByHash", () => {
    test("should validate active key", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      // Hash the key and validate
      const keyHash = await hashApiKey(result.key);

      const validation = await t.query(internal.apiKeys.core.validateByHash, {
        keyHash,
      });

      expect(validation).not.toBeNull();
      expect(validation?.userId).toBe(user._id);
      expect(validation?.apiKeyId).toBe(result.id);
    });

    test("should reject expired key", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      // Create key that will be valid
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      // Manually set expiresAt to past
      await t.run(async (runCtx) => {
        await runCtx.db.patch("apiKeys", result.id, {
          expiresAt: Date.now() - 1000,
        });
      });

      const keyHash = await hashApiKey(result.key);

      const validation = await t.query(internal.apiKeys.core.validateByHash, {
        keyHash,
      });

      expect(validation).toBeNull();
    });

    test("should reject invalid hash", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      const validation = await t.query(internal.apiKeys.core.validateByHash, {
        keyHash: "invalid_hash_that_does_not_exist",
      });

      expect(validation).toBeNull();
    });
  });

  describe("scope enforcement", () => {
    test("validateByKey returns normalized scope", async () => {
      const ctx = createTestContext();
      const { org, project, asUser, t } = await ctx.setupProject();
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      const validation = await t.query(internal.apiKeys.core.validateByKey, {
        apiKey: result.key,
      });

      expect(validation?.apiKeyScope).toEqual({
        kind: "organization",
        organizationId: org._id,
        projectIds: [project._id],
      });
    });

    test("validateByKey returns lastUsedAt so HTTP callers can skip a fresh usage touch", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Usage", expiresAt: Date.now() + 86400000,
      });

      expect((await t.query(internal.apiKeys.core.validateByKey, { apiKey: result.key }))?.lastUsedAt).toBeUndefined();
      await t.mutation(internal.apiKeys.core.recordUsage, { apiKeyId: result.id });
      const stamped = await t.run(async (runCtx) => (await runCtx.db.get("apiKeys", result.id))?.lastUsedAt);
      expect(stamped).toBeDefined();
      expect((await t.query(internal.apiKeys.core.validateByKey, { apiKey: result.key }))?.lastUsedAt).toBe(stamped);
    });

    test("filters project discovery and project lookup by scoped allowlist", async () => {
      const ctx = createTestContext();
      const { org, project, user, asUser } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      const projects = await ctx.t.query(api.projects.core.listAccessible, {
        apiKey: result.key,
      });
      expect(projects.map((item) => item._id)).toEqual([project._id]);

      await expect(
        ctx.t.query(api.projects.core.getById, {
          id: otherProject._id,
          apiKey: result.key,
        })
      ).resolves.toBeNull();

      await expect(
        ctx.t.query(api.projects.core.getByAlias, {
          organizationId: org._id,
          alias: otherProject.alias,
          apiKey: result.key,
        })
      ).resolves.toBeNull();
    });

    test("denies raw task id lookup outside API key scope", async () => {
      const ctx = createTestContext();
      const { org, project, user, asUser } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const otherTask = await ctx.task(otherProject._id, user._id, {
        name: "Other task",
      });
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      await expect(
        ctx.t.query(api.tasks.core.getById, {
          id: otherTask._id,
          apiKey: result.key,
        })
      ).resolves.toBeNull();
    });

    test("rejects CLI registration outside current API key scope", async () => {
      const ctx = createTestContext();
      const { org, project, user, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      await expect(
        t.mutation(internal.cli.sessions.register, {
          instanceId: "instance-1",
          userId: user._id,
          apiKeyId: result.id,
          apiKeyScope: {
            kind: "organization",
            organizationId: org._id,
            projectIds: [project._id],
          },
          projectId: otherProject._id,
          hostname: "host",
          name: "CLI",
          paths: [],
          availableClis: [],
        })
      ).rejects.toThrow("Permission denied");
    });
  });

  describe("recordUsage", () => {
    test("should update lastUsedAt timestamp", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      // Verify lastUsedAt is initially undefined
      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.lastUsedAt).toBeUndefined();
      });

      // Record usage
      await tickPastLastCommit();
      const beforeUsage = Date.now();
      await t.mutation(internal.apiKeys.core.recordUsage, {
        apiKeyId: result.id,
      });
      const afterUsage = Date.now();

      // Verify lastUsedAt was updated
      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.lastUsedAt).toBeDefined();
        expect(apiKey?.lastUsedAt).toBeGreaterThanOrEqual(beforeUsage);
        expect(apiKey?.lastUsedAt).toBeLessThanOrEqual(afterUsage);
      });
    });
  });

  describe("recordUsageByKey", () => {
    test("should update lastUsedAt timestamp using raw key", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      // Verify lastUsedAt is initially undefined
      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.lastUsedAt).toBeUndefined();
      });

      // Record usage by raw key
      await tickPastLastCommit();
      const beforeUsage = Date.now();
      await t.mutation(internal.apiKeys.core.recordUsageByKey, {
        apiKey: result.key,
      });
      const afterUsage = Date.now();

      // Verify lastUsedAt was updated
      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.lastUsedAt).toBeDefined();
        expect(apiKey?.lastUsedAt).toBeGreaterThanOrEqual(beforeUsage);
        expect(apiKey?.lastUsedAt).toBeLessThanOrEqual(afterUsage);
      });
    });

    test("should not throw for invalid key", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      // Should not throw - just silently do nothing
      await t.mutation(internal.apiKeys.core.recordUsageByKey, {
        apiKey: "sk_user_invalid_key_12345",
      });
    });
  });

  test("isLastUsedAtStale is true when never used or the interval has passed", () => {
    const now = 1_000_000;
    expect(isLastUsedAtStale({}, 5000, now)).toBe(true);
    expect(isLastUsedAtStale({ lastUsedAt: now - 4999 }, 5000, now)).toBe(false);
    expect(isLastUsedAtStale({ lastUsedAt: now - 5000 }, 5000, now)).toBe(true);
    expect(isLastUsedAtStale({ lastUsedAt: now }, -1, now)).toBe(true);
  });

  describe("recordUsageIfStale", () => {
    test("should update lastUsedAt when missing", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      await tickPastLastCommit();
      const beforeUsage = Date.now();
      await t.mutation(internal.apiKeys.core.recordUsageIfStale, {
        apiKeyId: result.id,
        minIntervalMs: 5 * 60 * 1000,
      });
      const afterUsage = Date.now();

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.lastUsedAt).toBeDefined();
        expect(apiKey?.lastUsedAt).toBeGreaterThanOrEqual(beforeUsage);
        expect(apiKey?.lastUsedAt).toBeLessThanOrEqual(afterUsage);
      });
    });

    test("should not update lastUsedAt inside throttle window", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      const existingLastUsedAt = Date.now() - 60 * 1000;
      await t.run(async (runCtx) => {
        await runCtx.db.patch("apiKeys", result.id, {
          lastUsedAt: existingLastUsedAt,
        });
      });

      await t.mutation(internal.apiKeys.core.recordUsageIfStale, {
        apiKeyId: result.id,
        minIntervalMs: 5 * 60 * 1000,
      });

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.lastUsedAt).toBe(existingLastUsedAt);
      });
    });

    test("should update lastUsedAt after throttle window", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      const existingLastUsedAt = Date.now() - 10 * 60 * 1000;
      await t.run(async (runCtx) => {
        await runCtx.db.patch("apiKeys", result.id, {
          lastUsedAt: existingLastUsedAt,
        });
      });

      await tickPastLastCommit();
      const beforeUsage = Date.now();
      await t.mutation(internal.apiKeys.core.recordUsageIfStale, {
        apiKeyId: result.id,
        minIntervalMs: 5 * 60 * 1000,
      });
      const afterUsage = Date.now();

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.lastUsedAt).toBeDefined();
        expect(apiKey?.lastUsedAt).not.toBe(existingLastUsedAt);
        expect(apiKey?.lastUsedAt).toBeGreaterThanOrEqual(beforeUsage);
        expect(apiKey?.lastUsedAt).toBeLessThanOrEqual(afterUsage);
      });
    });
  });

  describe("recordUsageByKeyIfStale", () => {
    test("should update lastUsedAt when missing", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      await tickPastLastCommit();
      const beforeUsage = Date.now();
      await t.mutation(internal.apiKeys.core.recordUsageByKeyIfStale, {
        apiKey: result.key,
        minIntervalMs: 5 * 60 * 1000,
      });
      const afterUsage = Date.now();

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.lastUsedAt).toBeDefined();
        expect(apiKey?.lastUsedAt).toBeGreaterThanOrEqual(beforeUsage);
        expect(apiKey?.lastUsedAt).toBeLessThanOrEqual(afterUsage);
      });
    });

    test("should not update lastUsedAt inside throttle window", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      const existingLastUsedAt = Date.now() - 60 * 1000;
      await t.run(async (runCtx) => {
        await runCtx.db.patch("apiKeys", result.id, {
          lastUsedAt: existingLastUsedAt,
        });
      });

      await t.mutation(internal.apiKeys.core.recordUsageByKeyIfStale, {
        apiKey: result.key,
        minIntervalMs: 5 * 60 * 1000,
      });

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.lastUsedAt).toBe(existingLastUsedAt);
      });
    });

    test("should update lastUsedAt after throttle window", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const result = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test Key",
        expiresAt,
      });

      const existingLastUsedAt = Date.now() - 10 * 60 * 1000;
      await t.run(async (runCtx) => {
        await runCtx.db.patch("apiKeys", result.id, {
          lastUsedAt: existingLastUsedAt,
        });
      });

      await tickPastLastCommit();
      const beforeUsage = Date.now();
      await t.mutation(internal.apiKeys.core.recordUsageByKeyIfStale, {
        apiKey: result.key,
        minIntervalMs: 5 * 60 * 1000,
      });
      const afterUsage = Date.now();

      await t.run(async (runCtx) => {
        const apiKey = await runCtx.db.get("apiKeys", result.id);
        expect(apiKey?.lastUsedAt).toBeDefined();
        expect(apiKey?.lastUsedAt).not.toBe(existingLastUsedAt);
        expect(apiKey?.lastUsedAt).toBeGreaterThanOrEqual(beforeUsage);
        expect(apiKey?.lastUsedAt).toBeLessThanOrEqual(afterUsage);
      });
    });

    test("should not throw for invalid key", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      await t.mutation(internal.apiKeys.core.recordUsageByKeyIfStale, {
        apiKey: "sk_user_invalid_key_12345",
        minIntervalMs: 5 * 60 * 1000,
      });
    });
  });
});

describe("worker credentials", () => {
  describe("project worker keys", () => {
    test("issues only a project key with bounded expiry and leaves the source unchanged", async () => {
      const { org, project, asUser, t } = await createTestContext().setupProject();
      const expiresAt = Date.now() + 86400000;
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "setup", expiresAt });
      const issued = await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
      expect(await t.query(api.apiKeys.core.currentScope, { apiKey: issued.key })).toEqual({
        kind: "organization",
        organizationId: org._id,
        projectIds: [project._id],
      });
      await t.run(async (c) => {
        expect((await c.db.get("apiKeys", issued.id))?.expiresAt).toBe(expiresAt);
        expect((await c.db.get("apiKeys", source.id))?.scope).toBeUndefined();
      });
      await expect(t.mutation(api.apiKeys.core.createProjectKey, { apiKey: issued.key, projectId: project._id })).rejects.toThrow(
        "setup key"
      );
      await expect(asUser.mutation(api.apiKeys.core.createProjectKey, { apiKey: issued.key, projectId: project._id })).rejects.toThrow(
        "setup key"
      );
    });
  });

  test("caps a worker from a non-expiring source at one year", async () => {
    const { project, asUser, t } = await createTestContext().setupProject();
    const source = await asUser.mutation(api.apiKeys.core.create, { name: "setup" });
    await tickPastLastCommit();
    const before = Date.now();
    const issued = await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
    const expiresAt = await t.run(async (c) => (await c.db.get("apiKeys", issued.id))?.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 365 * 86400000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 365 * 86400000);
    expect(await t.query(internal.apiKeys.core.validateByKey, { apiKey: issued.key })).not.toBeNull();
  });

  test("worker-key issuance rejects wrong-org, missing membership, expired and invalid source keys", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const other = await ctx.organization(user._id, { name: "Other", slug: "worker-key-other" });
    const source = await asUser.mutation(api.apiKeys.core.create, {
      name: "other-org",
      expiresAt: Date.now() + 86400000,
      scope: { organizationId: other._id, projectIds: [] },
    });
    await expect(t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id })).rejects.toThrow();
    await expect(asUser.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id })).rejects.toThrow();
    const stranger = await ctx.user();
    await ctx.orgMember(org._id, stranger._id, "admin");
    const strangerKey = await ctx
      .asUser(stranger)
      .mutation(api.apiKeys.core.create, { name: "stranger", expiresAt: Date.now() + 86400000 });
    await expect(t.mutation(api.apiKeys.core.createProjectKey, { apiKey: strangerKey.key, projectId: project._id })).rejects.toThrow();
    await t.run((c) => c.db.patch("apiKeys", source.id, { expiresAt: Date.now() - 1 }));
    await expect(t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id })).rejects.toThrow(
      "Not authenticated"
    );
    await expect(t.mutation(api.apiKeys.core.createProjectKey, { apiKey: "invalid", projectId: project._id })).rejects.toThrow(
      "Not authenticated"
    );
  });

  describe("linked worker credential lifecycle", () => {
    test.each(["delete", "expire", "narrow"])("rejects every authentication path after source %s", async (change) => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const other = await ctx.project(org._id, user._id, { alias: "OTHER" });
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "source", expiresAt: Date.now() + 86400000 });
      const worker = await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
      await t.run(async (c) => {
        if (change === "delete") await c.db.delete("apiKeys", source.id);
        if (change === "expire") await c.db.patch("apiKeys", source.id, { expiresAt: Date.now() - 1 });
        if (change === "narrow")
          await c.db.patch("apiKeys", source.id, { scope: { kind: "organization", organizationId: org._id, projectIds: [other._id] } });
      });
      const results = await Promise.all([
        t.query(api.apiKeys.core.currentScope, { apiKey: worker.key }).then(
          () => true,
          () => false
        ),
        t.query(internal.apiKeys.core.validateByKey, { apiKey: worker.key }),
        t.query(internal.apiKeys.core.validateByHash, { keyHash: await hashApiKey(worker.key) }),
      ]);
      expect(results).toEqual([false, null, null]);
    });
    test("stores worker provenance, exposes it without secrets, and forbids scope edits", async () => {
      const { project, asUser, t } = await createTestContext().setupProject();
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "Setup source", expiresAt: Date.now() + 86400000 });
      const worker = await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
      const listed = await listKeys(asUser);
      expect(listed.find((k) => k._id === worker.id)).toMatchObject({
        kind: "project-worker",
        workerStatus: "active",
        sourceKeyName: "Setup source",
      });
      expect(JSON.stringify(listed)).not.toContain(worker.key);
      await expect(asUser.mutation(api.apiKeys.core.update, { id: worker.id, name: "Broaden", scope: null })).rejects.toThrow(
        "Worker keys"
      );
    });
  });

  test("MCP-only source keys cannot mint worker credentials even with JWT present", async () => {
    const { project, asUser, t } = await createTestContext().setupProject();
    const source = await asUser.mutation(api.apiKeys.core.create, { name: "oauth", expiresAt: Date.now() + 86400000 });
    await t.run((c) => c.db.patch("apiKeys", source.id, { kind: "mcp-oauth" }));
    await expect(asUser.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id })).rejects.toThrow(
      "setup key"
    );
  });

  test("reuses only a valid linked credential for the exact source and project", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser, t } = await ctx.setupProject();
    const other = await ctx.project(org._id, user._id, { alias: "OTHER" });
    const source = await asUser.mutation(api.apiKeys.core.create, { name: "source", expiresAt: Date.now() + 86400000 });
    const second = await asUser.mutation(api.apiKeys.core.create, { name: "second", expiresAt: Date.now() + 86400000 });
    const worker = await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
    const keyHash = await hashApiKey(worker.key);
    const args = { apiKey: source.key, projectId: project._id, keyHash };
    expect(await t.query(api.apiKeys.core.canReuseProjectKey, args)).toBe(true);
    expect(await t.query(api.apiKeys.core.canReuseProjectKey, { ...args, apiKey: second.key })).toBe(false);
    expect(await t.query(api.apiKeys.core.canReuseProjectKey, { ...args, projectId: other._id })).toBe(false);
    expect(await t.query(api.apiKeys.core.canReuseProjectKey, { ...args, keyHash: await hashApiKey(source.key) })).toBe(false);
    await t.run((c) => c.db.patch("apiKeys", worker.id, { expiresAt: Date.now() - 1 }));
    expect(await t.query(api.apiKeys.core.canReuseProjectKey, args)).toBe(false);
  });

  test.each(["missing-link", "foreign-source", "worker-source", "broad-worker"])(
    "fails closed for malformed worker provenance: %s",
    async (scenario) => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "source", expiresAt: Date.now() + 86400000 });
      const worker = await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
      const otherUser = await ctx.user();
      await t.run(async (c) => {
        if (scenario === "missing-link") await c.db.patch("apiKeys", worker.id, { sourceKeyId: undefined });
        if (scenario === "foreign-source") await c.db.patch("apiKeys", source.id, { userId: otherUser._id });
        if (scenario === "worker-source") await c.db.patch("apiKeys", source.id, { kind: "project-worker", sourceKeyId: worker.id });
        if (scenario === "broad-worker") await c.db.patch("apiKeys", worker.id, { scope: undefined });
      });
      expect(await t.query(internal.apiKeys.core.validateByKey, { apiKey: worker.key })).toBeNull();
    }
  );

  test("narrowing the source to include its worker project retains access", async () => {
    const { org, project, asUser, t } = await createTestContext().setupProject();
    const source = await asUser.mutation(api.apiKeys.core.create, { name: "source", expiresAt: Date.now() + 86400000 });
    const worker = await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
    await asUser.mutation(api.apiKeys.core.update, {
      id: source.id,
      name: "narrowed",
      scope: { organizationId: org._id, projectIds: [project._id] },
    });
    expect(await t.query(api.apiKeys.core.currentScope, { apiKey: worker.key })).toMatchObject({ projectIds: [project._id] });
  });

  describe("worker source eligibility", () => {
    test("never replaces a live worker, even one its source no longer covers", async () => {
      const ctx = createTestContext();
      const { project, org, user, asUser, t } = await ctx.setupProject();
      const other = await ctx.project(org._id, user._id, { alias: "OTHER" });
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "source", expiresAt: Date.now() + 86400000 });
      const replacement = await asUser.mutation(api.apiKeys.core.create, { name: "replacement", expiresAt: Date.now() + 86400000 });
      const workers = [];
      for (let i = 0; i < 3; i++)
        workers.push(await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id }));
      await asUser.mutation(api.apiKeys.core.update, {
        id: source.id,
        name: "source",
        scope: { organizationId: org._id, projectIds: [other._id] },
      });
      await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: replacement.key, projectId: project._id });
      await asUser.mutation(api.apiKeys.core.update, { id: source.id, name: "source", scope: null });
      for (const worker of workers) expect(await t.query(internal.apiKeys.core.validateByKey, { apiKey: worker.key })).not.toBeNull();
    });

    test.each([false, true])("rejects CLI-login sources with JWT=%s", async (jwt) => {
      const { project, asUser, t } = await createTestContext().setupProject();
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "login", expiresAt: Date.now() + 86400000 });
      await t.run((c) => c.db.patch("apiKeys", source.id, { kind: "cli-login" }));
      await expect(
        (jwt ? asUser : t).mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id })
      ).rejects.toThrow("manual setup key");
    });

    test.each(["deleted", "expired", "scope"])("lists a worker's invalid source reason: %s", async (reason) => {
      const ctx = createTestContext();
      const { project, org, user, asUser, t } = await ctx.setupProject();
      const other = await ctx.project(org._id, user._id, { alias: "OTHER" });
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "source", expiresAt: Date.now() + 86400000 });
      const worker = await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
      await t.run(async (c) => {
        if (reason === "deleted") await c.db.delete("apiKeys", source.id);
        if (reason === "expired") await c.db.patch("apiKeys", source.id, { expiresAt: Date.now() - 1 });
        if (reason === "scope")
          await c.db.patch("apiKeys", source.id, { scope: { kind: "organization", organizationId: org._id, projectIds: [other._id] } });
      });
      expect((await listKeys(asUser)).find((k) => k._id === worker.id)).toMatchObject({
        workerStatus: `source-${reason}`,
      });
    });
  });

  describe("cleanup", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const kinds = async (t: Harness["t"]) =>
      t.run(async (c) => (await c.db.query("apiKeys").collect()).map((k) => `${k.kind ?? "manual"}:${k.name}`).sort());

    test("the expiry sweep deletes expired automated keys and keeps manual and live ones", async () => {
      vi.useFakeTimers();
      const { user, t } = await createTestContext().setupUser();
      const past = Date.now() - 1;
      const future = Date.now() + 86400000;
      await t.run(async (c) => {
        for (const kind of ["cli-login", "mcp-oauth", "project-worker"] as const) {
          await mintApiKey(c, user._id, { name: "old", expiresAt: past, scope: undefined, kind });
          await mintApiKey(c, user._id, { name: "live", expiresAt: future, scope: undefined, kind });
        }
        await mintApiKey(c, user._id, { name: "old", expiresAt: past, scope: undefined });
        await mintApiKey(c, user._id, { name: "forever", expiresAt: undefined, scope: undefined });
      });
      await t.mutation(internal.apiKeys.core.sweepExpiredKeys, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await kinds(t)).toEqual([
        "cli-login:live", "manual:forever", "manual:old", "mcp-oauth:live", "project-worker:live",
      ]);
    });

    test("the expiry sweep drains more than one batch", async () => {
      vi.useFakeTimers();
      const { user, t } = await createTestContext().setupUser();
      await t.run(async (c) => {
        for (let i = 0; i < 250; i++)
          await mintApiKey(c, user._id, { name: `login ${i}`, expiresAt: Date.now() - 1, scope: undefined, kind: "cli-login" });
      });
      await t.mutation(internal.apiKeys.core.sweepExpiredKeys, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await kinds(t)).toEqual([]);
    });

    test("deleting a source deletes all its workers and nothing else", async () => {
      vi.useFakeTimers();
      const { project, asUser, t } = await createTestContext().setupProject();
      const expiresAt = Date.now() + 86400000;
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "source", expiresAt });
      const kept = await asUser.mutation(api.apiKeys.core.create, { name: "kept", expiresAt });
      await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: kept.key, projectId: project._id });
      await t.run(async (c) => {
        for (let i = 0; i < 250; i++)
          await mintApiKey(c, (await c.db.get("apiKeys", source.id))!.userId, {
            name: `worker ${i}`, expiresAt, scope: undefined, kind: "project-worker", sourceKeyId: source.id,
          });
      });
      await asUser.mutation(api.apiKeys.core.deleteKey, { id: source.id });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await kinds(t)).toEqual([`manual:kept`, `project-worker:Convoy worker ${project.alias}`]);
    });

    test("the expiry sweep deletes the workers of an expired source", async () => {
      vi.useFakeTimers();
      const { project, asUser, t } = await createTestContext().setupProject();
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "source", expiresAt: Date.now() + 3600000 });
      await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
      vi.setSystemTime(Date.now() + 2 * 3600000);
      await t.mutation(internal.apiKeys.core.sweepExpiredKeys, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await kinds(t)).toEqual(["manual:source"]);
    });
  });

  describe("worker setup preflight", () => {
    test.each([undefined, "cli-login", "mcp-oauth"] as const)("checks source kind %s before project creation", async (kind) => {
      const { asUser, t } = await createTestContext().setupProject();
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "source", expiresAt: Date.now() + 86400000 });
      if (kind) await t.run((c) => c.db.patch("apiKeys", source.id, { kind }));
      const check = t.query(api.apiKeys.core.validateWorkerSetupKey, { apiKey: source.key });
      if (kind) await expect(check).rejects.toThrow("manual setup key");
      else await expect(check).resolves.toBeNull();
    });

    test("does not let a JWT owner issue or reuse with another user's source", async () => {
      const ctx = createTestContext();
      const { asUser, t, project } = await ctx.setupProject();
      const source = await asUser.mutation(api.apiKeys.core.create, { name: "source", expiresAt: Date.now() + 86400000 });
      const worker = await t.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id });
      const other = ctx.asUser(await ctx.user());
      await expect(other.query(api.apiKeys.core.validateWorkerSetupKey, { apiKey: source.key })).rejects.toThrow("Not authenticated");
      await expect(other.mutation(api.apiKeys.core.createProjectKey, { apiKey: source.key, projectId: project._id })).rejects.toThrow(
        "Not authenticated"
      );
      await expect(
        other.query(api.apiKeys.core.canReuseProjectKey, {
          apiKey: source.key,
          projectId: project._id,
          keyHash: await hashApiKey(worker.key),
        })
      ).rejects.toThrow("Not authenticated");
    });
  });
});
