import { ConvexError } from "convex/values";
import type { MutationCtx } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";
import { errors } from "../../errors";
import { CLI_LOGIN_TTL_MS, MAX_DEVICE_LOOKUP_FAILURES } from "./constants";

/**
 * Fail-closed guard against brute-forcing the short /device user code:
 * a user accumulating MAX_DEVICE_LOOKUP_FAILURES failed lookups within a
 * TTL window is rejected until the window rolls over.
 */

const WINDOW_MS = CLI_LOGIN_TTL_MS;

async function getAttemptsRow(ctx: MutationCtx, userId: Id<"users">) {
  return ctx.db
    .query("cliLoginDeviceAttempts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function assertDeviceLookupAllowed(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const row = await getAttemptsRow(ctx, userId);
  if (!row) return;

  const windowActive = Date.now() - row.windowStartedAt < WINDOW_MS;
  if (windowActive && row.failedCount >= MAX_DEVICE_LOOKUP_FAILURES) {
    throw new ConvexError(errors.DEVICE_LOOKUP_LOCKED);
  }
}

export async function recordDeviceLookupFailure(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const now = Date.now();
  const row = await getAttemptsRow(ctx, userId);

  if (!row) {
    await ctx.db.insert("cliLoginDeviceAttempts", { userId, windowStartedAt: now, failedCount: 1 });
    return;
  }

  if (now - row.windowStartedAt >= WINDOW_MS) {
    await ctx.db.patch("cliLoginDeviceAttempts", row._id, { windowStartedAt: now, failedCount: 1 });
    return;
  }

  await ctx.db.patch("cliLoginDeviceAttempts", row._id, { failedCount: row.failedCount + 1 });
}
