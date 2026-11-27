import { Migrations } from "@convex-dev/migrations";
import { internal, components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import schema from "./schema";
import {
  getAgentThreadWorkByThread,
  insertAgentThreadWork,
  replaceAgentThreadWork,
} from "./tasks/lib/agentThreadWorkRepo";
import { getThreadById } from "./cli/threads/lib/cliThreadsRepo";

/** Define data migrations here with `migrations.define` and list them in a `runAll` runner. */
export const migrations = new Migrations<DataModel, typeof schema>(components.migrations, {
  internalMutation,
  schema,
});

/**
 * OS-2579: move `tasks.agentThreadWork` arrays into the `agentThreadWork` table,
 * skipping threads deleted or moved since. A row synced after the deploy keeps its
 * fresher status; the legacy snapshots (source, createdAt, names) win, since the
 * sync could only guess them.
 */
export const moveAgentThreadWorkToTable = migrations.define({
  table: "tasks",
  migrateOne: async (ctx, task) => {
    if (task.agentThreadWork === undefined) {
      return;
    }
    for (const legacy of task.agentThreadWork) {
      // A thread deleted or moved since the deploy already dropped or moved its row.
      const thread = await getThreadById(ctx, legacy.threadId);
      if (!thread || thread.isDeleted || thread.associatedTaskId !== task._id) {
        continue;
      }
      const snapshot = { ...legacy, createdAt: legacy.createdAt ?? legacy.updatedAt };
      const row = await getAgentThreadWorkByThread(ctx, legacy.threadId);
      if (!row) {
        await insertAgentThreadWork(ctx, { ...snapshot, projectId: task.projectId, taskId: task._id });
      } else if (row.taskId === task._id) {
        const { _id, _creationTime, ...current } = row;
        void _creationTime;
        await replaceAgentThreadWork(ctx, _id, {
          ...current,
          source: snapshot.source,
          createdAt: snapshot.createdAt,
          userName: snapshot.userName,
          ...(snapshot.agentName !== undefined ? { agentName: snapshot.agentName } : {}),
        });
      }
    }
    return { agentThreadWork: undefined };
  },
});

export const runAll = migrations.runner([internal.migrations.moveAgentThreadWorkToTable]);
