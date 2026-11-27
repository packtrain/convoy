import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import schema from "./schema";
import { insertHeartbeat } from "./cli/lib/cliSessionsRepo";
import { ONLINE_THRESHOLD_MS } from "./cli/lib/constants";

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

export const runAll = migrations.runner([internal.migrations.migrateLegacySessionHeartbeats]);
