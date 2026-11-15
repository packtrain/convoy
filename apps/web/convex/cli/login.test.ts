import { expect, test, describe } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { hashApiKey } from "../lib/access/apiKeys";
import { errors } from "./errors";
import { MAX_DEVICE_LOOKUP_FAILURES } from "./lib/login/constants";

const VERIFIER = "test-verifier-secret";

type TestT = ReturnType<typeof createTestContext>["t"];

async function startLogin(t: TestT, hostname?: string) {
  const verifierHash = await hashApiKey(VERIFIER);
  return t.mutation(internal.cli.login.start, { verifierHash, hostname });
}

describe("cli/login", () => {
  describe("start", () => {
    test("creates a pending request with challenge + user code", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      const result = await startLogin(t, "my-laptop");

      expect(result.challengeId).toBeTruthy();
      expect(result.userCode).toMatch(/^[BCDFGHJKMNPQRSTVWXZ2-9]{4}-[BCDFGHJKMNPQRSTVWXZ2-9]{4}$/);
      expect(result.expiresAt).toBeGreaterThan(Date.now());

      await t.run(async (runCtx) => {
        const rows = await runCtx.db.query("cliLoginRequests").collect();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe("pending");
        expect(rows[0].hostname).toBe("my-laptop");
      });
    });

    test("rejects a malformed verifierHash", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      await expect(
        t.mutation(internal.cli.login.start, { verifierHash: "not-hex" })
      ).rejects.toThrow(errors.LOGIN_VERIFIER_HASH_INVALID);
    });
  });

  describe("approve via challenge link → poll", () => {
    test("happy path mints a key for the approving user, single-use", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      const { challengeId } = await startLogin(t, "my-laptop");

      // Approve page sees the pending request
      const visible = await asUser.query(api.cli.login.getByChallenge, { challengeId });
      expect(visible).toMatchObject({ status: "pending", hostname: "my-laptop" });

      // Pending before approval
      const pending = await t.mutation(internal.cli.login.poll, { challengeId, verifier: VERIFIER });
      expect(pending).toEqual({ status: "pending" });

      await asUser.mutation(api.cli.login.approve, { challengeId });

      // Approve mints nothing
      await t.run(async (runCtx) => {
        const keys = await runCtx.db.query("apiKeys").collect();
        expect(keys).toHaveLength(0);
      });

      const result = await t.mutation(internal.cli.login.poll, { challengeId, verifier: VERIFIER });
      expect(result.status).toBe("approved");
      if (result.status !== "approved") throw new Error("unreachable");
      expect(result.apiKey).toMatch(/^sk_user_/);
      expect(result.email).toBe(user.email);

      // Poll minted exactly one key owned by the approving user, unscoped
      await t.run(async (runCtx) => {
        const keys = await runCtx.db.query("apiKeys").collect();
        expect(keys).toHaveLength(1);
        expect(keys[0].userId).toBe(user._id);
        expect(keys[0].scope).toBeUndefined();
        expect(keys[0].kind).toBe("cli-login");
        expect(keys[0].name).toContain("my-laptop");
        // Plaintext never stored
        expect(keys[0].keyHash).toBe(await hashApiKey(result.apiKey));

        // Row is gone → single-use structurally
        const rows = await runCtx.db.query("cliLoginRequests").collect();
        expect(rows).toHaveLength(0);
      });

      // Second poll fails (row gone)
      const again = await t.mutation(internal.cli.login.poll, { challengeId, verifier: VERIFIER });
      expect(again).toEqual({ status: "not_found" });
    });

    test("wrong verifier is reported as not_found even when approved", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { challengeId } = await startLogin(t);
      await asUser.mutation(api.cli.login.approve, { challengeId });

      const result = await t.mutation(internal.cli.login.poll, { challengeId, verifier: "wrong" });
      expect(result).toEqual({ status: "not_found" });

      // No key was minted
      await t.run(async (runCtx) => {
        expect(await runCtx.db.query("apiKeys").collect()).toHaveLength(0);
      });
    });
  });

  describe("approve via user code (device path)", () => {
    test("lookup + approve + poll happy path", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { challengeId, userCode } = await startLogin(t, "devcontainer");

      // Lookup is normalization-tolerant (lowercase, no dash)
      const found = await asUser.mutation(api.cli.login.lookupByUserCode, {
        userCode: userCode.toLowerCase().replace("-", " "),
      });
      expect(found).toMatchObject({ challengeId, hostname: "devcontainer" });

      await asUser.mutation(api.cli.login.approve, { challengeId });

      const result = await t.mutation(internal.cli.login.poll, { challengeId, verifier: VERIFIER });
      expect(result.status).toBe("approved");
    });

    test("unknown code returns null and repeated failures lock fail-closed", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      for (let i = 0; i < MAX_DEVICE_LOOKUP_FAILURES; i += 1) {
        const missed = await asUser.mutation(api.cli.login.lookupByUserCode, { userCode: "XXXX-XXXX" });
        expect(missed).toBeNull();
      }

      await expect(
        asUser.mutation(api.cli.login.lookupByUserCode, { userCode: "XXXX-XXXX" })
      ).rejects.toThrow(errors.DEVICE_LOOKUP_LOCKED);
    });
  });

  describe("deny", () => {
    test("denied request reports denied to poll and mints nothing", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { challengeId } = await startLogin(t);
      await asUser.mutation(api.cli.login.deny, { challengeId });

      const result = await t.mutation(internal.cli.login.poll, { challengeId, verifier: VERIFIER });
      expect(result).toEqual({ status: "denied" });

      await t.run(async (runCtx) => {
        expect(await runCtx.db.query("apiKeys").collect()).toHaveLength(0);
      });

      // A denied request can no longer be approved
      await expect(asUser.mutation(api.cli.login.approve, { challengeId })).rejects.toThrow(
        errors.LOGIN_REQUEST_NOT_PENDING
      );
    });
  });

  describe("expiry", () => {
    test("expired request rejects approve and reports expired to poll", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { challengeId } = await startLogin(t);

      await t.run(async (runCtx) => {
        const row = await runCtx.db
          .query("cliLoginRequests")
          .withIndex("by_challengeId", (q) => q.eq("challengeId", challengeId))
          .unique();
        await runCtx.db.patch("cliLoginRequests", row!._id, { expiresAt: Date.now() - 1000 });
      });

      await expect(asUser.mutation(api.cli.login.approve, { challengeId })).rejects.toThrow(
        errors.LOGIN_REQUEST_EXPIRED
      );

      const result = await t.mutation(internal.cli.login.poll, { challengeId, verifier: VERIFIER });
      expect(result).toEqual({ status: "expired" });

      // Approve page treats it as gone
      const visible = await asUser.query(api.cli.login.getByChallenge, { challengeId });
      expect(visible).toBeNull();
    });
  });

  describe("key pooling and re-login", () => {
    test("re-login from the same hostname replaces the previous auto-minted key", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const first = await startLogin(t, "my-laptop");
      await asUser.mutation(api.cli.login.approve, { challengeId: first.challengeId });
      const firstPoll = await t.mutation(internal.cli.login.poll, { challengeId: first.challengeId, verifier: VERIFIER });
      if (firstPoll.status !== "approved") throw new Error("first login failed");

      const second = await startLogin(t, "my-laptop");
      await asUser.mutation(api.cli.login.approve, { challengeId: second.challengeId });
      const secondPoll = await t.mutation(internal.cli.login.poll, { challengeId: second.challengeId, verifier: VERIFIER });
      if (secondPoll.status !== "approved") throw new Error("second login failed");

      // One key remains, and it is the new one — the old key is retired.
      await t.run(async (runCtx) => {
        const keys = await runCtx.db.query("apiKeys").collect();
        expect(keys).toHaveLength(1);
        expect(keys[0].keyHash).toBe(await hashApiKey(secondPoll.apiKey));
      });
    });

    test("cli-login mints past 100 existing keys", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      for (let i = 0; i < 100; i += 1) {
        await asUser.mutation(api.apiKeys.core.create, {
          name: `Manual ${i}`,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        });
      }

      const { challengeId } = await startLogin(t, "my-laptop");
      await asUser.mutation(api.cli.login.approve, { challengeId });
      await expect(t.mutation(internal.cli.login.poll, { challengeId, verifier: VERIFIER })).resolves.toMatchObject({ status: "approved" });
    });
  });

  describe("cleanup", () => {
    test("janitor deletes the row and tolerates already-deleted rows", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      await startLogin(t);

      const requestId = await t.run(async (runCtx) => {
        const rows = await runCtx.db.query("cliLoginRequests").collect();
        expect(rows).toHaveLength(1);
        return rows[0]._id;
      });

      await t.mutation(internal.cli.login.cleanup, { requestId });

      await t.run(async (runCtx) => {
        expect(await runCtx.db.query("cliLoginRequests").collect()).toHaveLength(0);
      });

      // Idempotent: the janitor fires even after a successful poll deleted the row
      await t.mutation(internal.cli.login.cleanup, { requestId });
    });
  });
});
