import { describe, expect, test } from "vitest";
import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { createTestContext, setupFakeTimers } from "../../../convex-testing";
import { assertThreadClaimedBySession, isThreadClaimExpired } from "./claims";

setupFakeTimers();

/**
 * Pins the gate's branches for all its callers at once. The integration side
 * (a real container reaching `startRunResponse`) lives in `cli/messages.test.ts`.
 */
async function setup(overrides: Partial<Doc<"cliThreads">> = {}, leaseExpiresAt?: number) {
  const ctx = createTestContext();
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id);
  const apiKey = await asUser.mutation(api.apiKeys.core.create, { name: "CLI Key", expiresAt: Date.now() + 60 * 60_000 });
  const session = await ctx.cliSession(profile._id, apiKey.id);
  const { _id: threadId } = await ctx.cliThread(user._id, project._id, profile._id, { claimedBySessionId: session._id, ...overrides });
  if (leaseExpiresAt !== undefined) {
    await t.run((c) => c.db.insert("cliThreadClaimLeases", { threadId, expiresAt: leaseExpiresAt }));
  }
  /** Run `fn` against the stored thread doc. */
  const withThread = <T>(fn: (c: MutationCtx, thread: Doc<"cliThreads">) => Promise<T>) =>
    t.run(async (c) => fn(c, (await c.db.get("cliThreads", threadId))!));
  return { withThread, sessionId: session._id };
}

describe("assertThreadClaimedBySession", () => {
  test("accepts a live claim held by the session", async () => {
    const s = await setup({}, Date.now() + 60_000);
    await s.withThread((c, thread) => assertThreadClaimedBySession(c, thread, s.sessionId));
  });

  test("rejects a container even with a live claim (OS-1556)", async () => {
    const s = await setup({ kind: "group" }, Date.now() + 60_000);
    await expect(s.withThread((c, thread) => assertThreadClaimedBySession(c, thread, s.sessionId))).rejects.toThrow(
      "Groups and workflow runs cannot be processed by a CLI"
    );
  });

  test("rejects an expired lease, and another session's claim", async () => {
    const expired = await setup({}, Date.now() - 1);
    await expect(expired.withThread((c, thread) => assertThreadClaimedBySession(c, thread, expired.sessionId))).rejects.toThrow(
      "Chat not claimed by this session"
    );
    const unclaimed = await setup({ claimedBySessionId: undefined }, Date.now() + 60_000);
    await expect(unclaimed.withThread((c, thread) => assertThreadClaimedBySession(c, thread, unclaimed.sessionId))).rejects.toThrow(
      "Chat not claimed by this session"
    );
  });
});

describe("isThreadClaimExpired", () => {
  test("a missing or elapsed lease is expired; a future one is not", async () => {
    const now = Date.now();
    for (const [leaseExpiresAt, expired] of [[undefined, true], [now, true], [now + 1, false]] as const) {
      const s = await setup({}, leaseExpiresAt);
      expect(await s.withThread((c, thread) => isThreadClaimExpired(c, thread, now))).toBe(expired);
    }
  });

  test("falls back to a legacy lease on the thread row only when no lease row exists (OS-2550)", async () => {
    const now = Date.now();
    const legacy = await setup({ claimLeaseExpiresAt: now + 60_000 });
    expect(await legacy.withThread((c, thread) => isThreadClaimExpired(c, thread, now))).toBe(false);
    const moved = await setup({ claimLeaseExpiresAt: now + 60_000 }, now - 1);
    expect(await moved.withThread((c, thread) => isThreadClaimExpired(c, thread, now))).toBe(true);
  });
});
