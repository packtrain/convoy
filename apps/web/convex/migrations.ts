import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import schema from "./schema";
import { insertHeartbeat } from "./cli/lib/cliSessionsRepo";
import { ONLINE_THRESHOLD_MS } from "./cli/lib/constants";
import {
  extendThreadClaimLease,
  getThreadClaimLeaseExpiresAt,
  getThreadCodexUsageCursor,
  setThreadCodexUsageCursor,
} from "./cli/threads/lib/cliThreadsRepo";

/** Define data migrations here with `migrations.define` and list them in a `runAll` runner. */
export const migrations = new Migrations<DataModel, typeof schema>(components.migrations, {
  internalMutation,
  schema,
});

/**
 * OS-2549: legacy sessions predate stored online state. A fresh one moves its heartbeat into
 * `cliSessionHeartbeats` and goes online; a stale one goes offline as of its last heartbeat, so
 * the sweep deletes it. Clears the legacy `lastHeartbeatAt` so a follow-up can drop the field.
 */
export const migrateLegacySessionHeartbeats = migrations.define({
  table: "cliSessions",
  migrateOne: async (ctx, session) => {
    if (session.isOnline !== undefined) {
      return session.lastHeartbeatAt === undefined ? undefined : { lastHeartbeatAt: undefined };
    }
    const lastHeartbeatAt = session.lastHeartbeatAt ?? session.startedAt;
    if (lastHeartbeatAt > Date.now() - ONLINE_THRESHOLD_MS) {
      await insertHeartbeat(ctx, session._id, lastHeartbeatAt);
      return { isOnline: true, lastHeartbeatAt: undefined };
    }
    return { isOnline: false, offlineAt: lastHeartbeatAt, lastHeartbeatAt: undefined };
  },
});

/**
 * OS-2550: move a live claim's lease and the Codex usage cursor off `cliThreads` into their own
 * rows, and clear the legacy fields so a follow-up can drop them. An unclaimed thread's lease is dropped.
 */
export const moveThreadClaimLeases = migrations.define({
  table: "cliThreads",
  migrateOne: async (ctx, thread) => {
    if (thread.claimedAt === undefined && thread.claimLeaseExpiresAt === undefined && thread.codexUsageCursor === undefined) {
      return undefined;
    }
    // Both getters prefer an existing row, so a renewal made since the deploy is kept.
    const expiresAt = await getThreadClaimLeaseExpiresAt(ctx, thread);
    if (thread.claimedBySessionId && expiresAt !== undefined) {
      await extendThreadClaimLease(ctx, thread._id, expiresAt);
    }
    const cursor = await getThreadCodexUsageCursor(ctx, thread);
    if (cursor) {
      await setThreadCodexUsageCursor(ctx, thread._id, cursor);
    }
    return { claimedAt: undefined, claimLeaseExpiresAt: undefined, codexUsageCursor: undefined };
  },
});

export const runAll = migrations.runner([
  internal.migrations.migrateLegacySessionHeartbeats,
  internal.migrations.moveThreadClaimLeases,
]);
