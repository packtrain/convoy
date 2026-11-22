import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { LexoRank } from "lexorank";
import { internal, components } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import schema from "./schema";
import { Status as StatusValues } from "@/lib/tasks/status";
import { ProjectRole } from "../lib/authz/roles";
import { getProjectById } from "./projects/lib/projectsRepo";
import { getMembership, insertMembership } from "./projects/lib/membersRepo";
import { listLeaderMembershipsForOrganization } from "./organizations/lib/membersRepo";
import { createInboxList } from "./tasks/lib/taskListsRepo";
import { INBOX_LIST_REF } from "./tasks/lib/lists/resolution";
import { createPersistedTaskListKey } from "./lib/contracts/taskListKeys";
import { BACKLOG_SYSTEM_LIST_KEY } from "@/lib/task-lists/system-lists";
import { findTaskListByRefForProject } from "./tasks/lib/taskListsRepo";
import { isEphemeralCliChunk } from "./cli/lib/runtimes/registry";
import { mergeLastUsedCli } from "./cli/lib/lastUsedCli";
import { getMessageById } from "./cli/lib/cliMessagesRepo";

const currentWorkflowStatuses = Object.values(StatusValues);

export const migrations = new Migrations<DataModel, typeof schema>(components.migrations, {
  internalMutation,
  schema,
});

export const ensureProjectInbox = migrations.define({
  table: "projects",
  customRange: (query) => query.withIndex("by_defaultListId", (q) => q.eq("defaultListId", undefined)),
  migrateOne: async (ctx, project) => {
    if (project.defaultListId) {
      return;
    }

    const existingInbox = await findTaskListByRefForProject(ctx, project._id, INBOX_LIST_REF);
    const defaultListId =
      existingInbox?._id ??
      (await createInboxList(ctx, {
        projectId: project._id,
        userId: project.createdBy,
      }));

    if (existingInbox?.isArchived) {
      await ctx.db.patch("taskLists", existingInbox._id, {
        isArchived: false,
        archivedAt: undefined,
        archivedBy: undefined,
        updatedBy: project.createdBy,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.patch("projects", project._id, { defaultListId });
  },
});

export const backfillDefaultListTasks = migrations.define({
  table: "tasks",
  customRange: (query) =>
    query.withIndex("by_isDeleted_and_isArchived_and_listKey_and_status", (q) =>
      q.eq("isDeleted", false).eq("isArchived", false).eq("listKey", undefined)
    ),
  migrateOne: async (ctx, task) => {
    if (task.listKey !== undefined) {
      return;
    }

    const project = await ctx.db.get("projects", task.projectId);
    if (!project) {
      throw new Error(`Task ${task._id} references missing project ${task.projectId}`);
    }
    if (!project.defaultListId) {
      throw new Error(`Project ${project._id} has no defaultListId; run ensureProjectInbox first`);
    }

    await ctx.db.patch("tasks", task._id, {
      listKey: createPersistedTaskListKey(project.defaultListId),
    });
  },
});

export const backfillTaskResourceCounts = migrations.define({
  table: "tasks",
  migrateOne: async (ctx, task) => {
    const [attachments, artifacts] = await Promise.all([
      ctx.db
        .query("taskAttachments")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect(),
      ctx.db
        .query("taskArtifacts")
        .withIndex("by_task_and_updatedAt", (q) => q.eq("taskId", task._id))
        .collect(),
    ]);
    const attachmentCount = attachments.length;
    const artifactCount = artifacts.length;
    if (task.attachmentCount === attachmentCount && task.artifactCount === artifactCount) {
      return;
    }
    await ctx.db.patch("tasks", task._id, { attachmentCount, artifactCount });
  },
});

export const deleteTelemetryCliMessageChunks = migrations.define({
  table: "cliMessageChunks",
  migrateOne: async (ctx, chunk) => {
    // Rows already flagged ephemeral are owned by the completion cleanup path
    // (and intentionally kept for failed messages). This only removes stored
    // pure-telemetry rows that predate the widened isEphemeralChunk predicate.
    if (chunk.ephemeral === true) {
      return;
    }

    const message = await ctx.db.get("cliMessages", chunk.messageId);
    if (!message || message.role !== "assistant") {
      return;
    }

    if (
      isEphemeralCliChunk({
        cliType: message.cliType,
        chunk: { type: chunk.type, data: chunk.data },
      })
    ) {
      await ctx.db.delete("cliMessageChunks", chunk._id);
    }
  },
});

export const clearLegacyCostRollupThreadIds = migrations.define({
  table: "costRollups",
  migrateOne: async (ctx, rollup) => {
    if (rollup.threadId === undefined) {
      return;
    }

    await ctx.db.patch("costRollups", rollup._id, { threadId: undefined });
  },
});

export const clearLegacySlashCommandTitles = migrations.define({
  table: "slashCommands",
  migrateOne: async (ctx, slashCommand) => {
    if (slashCommand.title === undefined) {
      return;
    }

    await ctx.db.patch("slashCommands", slashCommand._id, { title: undefined });
  },
});

export const backfillSlashCommandAutoSubmit = migrations.define({
  table: "slashCommands",
  migrateOne: async (ctx, slashCommand) => {
    if (slashCommand.autoSubmit !== undefined) {
      return;
    }

    await ctx.db.patch("slashCommands", slashCommand._id, {
      autoSubmit: false,
    });
  },
});

function seedMigrationRanks(lists: Doc<"taskLists">[]): Map<Id<"taskLists">, string> {
  // Lists ranked before the backfill runs (created post-deploy) keep their
  // rank; unranked ones are seeded after the bucket's highest existing rank so
  // seeded ranks never collide with pre-assigned ones.
  const maxExistingRank = lists.reduce<LexoRank | null>((max, list) => {
    if (list.rank === undefined) {
      return max;
    }
    const rank = LexoRank.parse(list.rank);
    return max === null || rank.compareTo(max) > 0 ? rank : max;
  }, null);

  const ranks = new Map<Id<"taskLists">, string>();
  let rank = maxExistingRank ? maxExistingRank.genNext() : LexoRank.middle();
  for (const list of lists) {
    if (list.rank !== undefined) {
      continue;
    }
    ranks.set(list._id, rank.toString());
    rank = rank.genNext();
  }
  return ranks;
}

async function listTaskListMigrationBucket(ctx: MutationCtx, list: Doc<"taskLists">): Promise<Doc<"taskLists">[]> {
  const bucket = await ctx.db
    .query("taskLists")
    .withIndex("by_project_and_isArchived_and_normalizedName", (q) => q.eq("projectId", list.projectId).eq("isArchived", list.isArchived))
    .collect();

  if (list.isArchived) {
    return bucket;
  }

  const project = await ctx.db.get("projects", list.projectId);
  const defaultList = project?.defaultListId ? bucket.find((candidate) => candidate._id === project.defaultListId) : undefined;
  if (!defaultList) {
    return bucket;
  }

  return [defaultList, ...bucket.filter((candidate) => candidate._id !== defaultList._id)];
}

export const backfillTaskListRanks = migrations.define({
  table: "taskLists",
  migrateOne: async (ctx, list) => {
    if (list.rank !== undefined) {
      return;
    }

    const ordered = await listTaskListMigrationBucket(ctx, list);
    const ranks = seedMigrationRanks(ordered);
    for (const candidate of ordered) {
      if (candidate.rank !== undefined) {
        continue;
      }
      const rank = ranks.get(candidate._id);
      if (!rank) {
        throw new Error(`Could not allocate List rank for ${candidate._id}`);
      }
      await ctx.db.patch("taskLists", candidate._id, { rank });
    }
  },
});

/**
 * Stamp the owning organization on notifications predating the org-scoped
 * inbox (OS-1398). Rows are read per organization, so an un-backfilled row is
 * invisible until this runs — including one whose project is hard-gone, which
 * stays unstamped and is reaped by the retention sweep.
 */
export const backfillNotificationOrganizationId = migrations.define({
  table: "notifications",
  migrateOne: async (ctx, notification) => {
    if (notification.organizationId !== undefined) {
      return;
    }
    const project = await getProjectById(ctx, notification.projectId);
    if (!project) {
      return;
    }
    await ctx.db.patch("notifications", notification._id, {
      organizationId: project.organizationId,
    });
  },
});

/**
 * How many of a thread's newest user messages the backfill folds. Bounds the
 * read set per thread; a thread whose only selection sits further back than
 * this keeps whatever the shallower window yields (possibly nothing, in which
 * case its composer opens on the runtime default like any un-backfilled
 * thread). 200 is far past any real thread.
 */
const LAST_USED_CLI_SCAN_LIMIT = 200;

type StoredLastUsedCli = NonNullable<Doc<"cliThreads">["metadata"]>["cli"];

/**
 * Reproduce the write-path fold (OS-1454) for a pre-existing thread by replaying its
 * user messages through the same `mergeLastUsedCli` the write path uses — a backfill
 * with its own copy of the merge rules would silently diverge.
 *
 * Only the newest `LAST_USED_CLI_SCAN_LIMIT` messages are read: replaying a long
 * thread from its true start would be unbounded, and only the tail can affect the
 * result.
 */
async function findThreadLastUsedCli(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"cliThreads">
): Promise<StoredLastUsedCli> {
  const newestFirst = await ctx.db
    .query("cliMessages")
    .withIndex("by_thread_and_role_and_createdAt", (q) => q.eq("threadId", threadId).eq("role", "user"))
    .order("desc")
    .take(LAST_USED_CLI_SCAN_LIMIT);

  let cli: StoredLastUsedCli;
  for (const message of newestFirst.reverse()) {
    cli = mergeLastUsedCli(cli, {
      cliModel: message.cliModel,
      cliEffort: message.cliEffort,
      cliMode: message.cliMode,
    });
  }
  return cli;
}

/**
 * Denormalize the last-used CLI selection onto threads created before it was
 * stamped at write time (OS-1454). Until this runs, those threads open their
 * composer on the runtime defaults instead of the user's last selection.
 */
export const backfillCliThreadLastUsedCli = migrations.define({
  table: "cliThreads",
  migrateOne: async (ctx, thread) => {
    // `cliThreads` has no `by_isDeleted` index, so the cheap guards live here
    // rather than in a `customRange`.
    if (thread.isDeleted || thread.metadata?.cli !== undefined) {
      return;
    }

    const cli = await findThreadLastUsedCli(ctx, thread._id);
    if (!cli) {
      return;
    }

    await ctx.db.patch("cliThreads", thread._id, {
      metadata: { ...thread.metadata, cli },
    });
  },
});

/** Stamp `role` on attachment refs written before OS-2289, so the Evidence tab finds older agent files. */
export const backfillCliMessageAttachmentRefRole = migrations.define({
  table: "cliMessageAttachmentRefs",
  migrateOne: async (ctx, ref) => {
    if (ref.role !== undefined) {
      return;
    }
    const message = await getMessageById(ctx, ref.messageId);
    if (message) {
      await ctx.db.patch("cliMessageAttachmentRefs", ref._id, { role: message.role });
    }
  },
});

/**
 * Turn today's *derived* org-owner/admin project access into explicit
 * `projectMembers` rows so OS-1536 can delete the implicit bypass without
 * revoking anyone (OS-1535). The grant outlives an org demotion, exactly like
 * any other explicit member — that is the explicit-ACL model, not a leak.
 * Spec: docs/specs/permissions-system.md
 */
export const backfillOrgLeaderProjectMemberships = migrations.define({
  table: "projects",
  customRange: (query) => query.withIndex("by_isDeleted_and_defaultListId", (q) => q.eq("isDeleted", false)),
  migrateOne: async (ctx, project) => {
    // Archived projects are included: unarchiving must not resurrect a project
    // whose leaders lost access.
    for (const leader of await listLeaderMembershipsForOrganization(ctx, project.organizationId)) {
      if (await getMembership(ctx, project._id, leader.userId)) {
        continue;
      }
      await insertMembership(ctx, project._id, leader.userId, ProjectRole.PROJECT_ADMIN);
    }
  },
});

/** Mark Guide and checks runs created before OS-2513 as background threads. A retried Guide's old thread lost its marker and stays. */
export const backfillCliThreadIsBackground = migrations.define({
  table: "cliThreads",
  migrateOne: async (ctx, thread) => {
    if (thread.isBackground || !(thread.pullRequestGuide || thread.pullRequestChecks)) {
      return;
    }
    await ctx.db.patch("cliThreads", thread._id, { isBackground: true });
  },
});

export const runAll = migrations.runner([
  internal.migrations.ensureProjectInbox,
  internal.migrations.backfillDefaultListTasks,
  internal.migrations.backfillTaskListRanks,
  internal.migrations.backfillTaskResourceCounts,
  internal.migrations.deleteTelemetryCliMessageChunks,
  internal.migrations.clearLegacyCostRollupThreadIds,
  internal.migrations.clearLegacySlashCommandTitles,
  internal.migrations.backfillSlashCommandAutoSubmit,
  internal.migrations.backfillNotificationOrganizationId,
  internal.migrations.backfillCliThreadLastUsedCli,
  internal.migrations.backfillOrgLeaderProjectMemberships,
  internal.migrations.backfillCliMessageAttachmentRefRole,
  internal.migrations.backfillCliThreadIsBackground,
]);

const MAX_ORG_LEADER_GRANT_VERIFY_REPORT_ROWS = 10;

/**
 * Reports the first missing (project, org leader) grants. Bounded by the report
 * cap rather than a scan limit: the healthy case is all-clear, and the read set
 * is the same cross-product the migration already walks.
 */
export const verifyOrgLeaderProjectMembershipBackfill = internalQuery({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    missingGrants: v.array(v.object({ projectId: v.id("projects"), userId: v.id("users") })),
  }),
  handler: async (ctx) => {
    const missingGrants: Array<{ projectId: Id<"projects">; userId: Id<"users"> }> = [];

    for await (const project of ctx.db
      .query("projects")
      .withIndex("by_isDeleted_and_defaultListId", (q) => q.eq("isDeleted", false))) {
      for (const leader of await listLeaderMembershipsForOrganization(ctx, project.organizationId)) {
        if (await getMembership(ctx, project._id, leader.userId)) {
          continue;
        }
        missingGrants.push({ projectId: project._id, userId: leader.userId });
        if (missingGrants.length >= MAX_ORG_LEADER_GRANT_VERIFY_REPORT_ROWS) {
          return { ok: false, missingGrants };
        }
      }
    }

    return { ok: missingGrants.length === 0, missingGrants };
  },
});

export const verifyLegacyCostRollupThreadIdsCleared = internalQuery({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    costRollupIdsWithLegacyThreadId: v.array(v.id("costRollups")),
  }),
  handler: async (ctx) => {
    const costRollupIdsWithLegacyThreadId: Array<Id<"costRollups">> = [];

    for await (const rollup of ctx.db.query("costRollups")) {
      if (rollup.threadId !== undefined) {
        costRollupIdsWithLegacyThreadId.push(rollup._id);
      }
      if (costRollupIdsWithLegacyThreadId.length >= 10) {
        break;
      }
    }

    return {
      ok: costRollupIdsWithLegacyThreadId.length === 0,
      costRollupIdsWithLegacyThreadId,
    };
  },
});

export const verifyLegacySlashCommandTitlesCleared = internalQuery({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    slashCommandIdsWithLegacyTitle: v.array(v.id("slashCommands")),
  }),
  handler: async (ctx) => {
    const slashCommandIdsWithLegacyTitle: Array<Id<"slashCommands">> = [];

    for await (const slashCommand of ctx.db.query("slashCommands")) {
      if (slashCommand.title !== undefined) {
        slashCommandIdsWithLegacyTitle.push(slashCommand._id);
      }
      if (slashCommandIdsWithLegacyTitle.length >= 10) {
        break;
      }
    }

    return {
      ok: slashCommandIdsWithLegacyTitle.length === 0,
      slashCommandIdsWithLegacyTitle,
    };
  },
});

export const verifySlashCommandAutoSubmitBackfill = internalQuery({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    slashCommandIdsWithoutAutoSubmit: v.array(v.id("slashCommands")),
  }),
  handler: async (ctx) => {
    const slashCommandIdsWithoutAutoSubmit: Array<Id<"slashCommands">> = [];

    for await (const slashCommand of ctx.db.query("slashCommands")) {
      if (slashCommand.autoSubmit === undefined) {
        slashCommandIdsWithoutAutoSubmit.push(slashCommand._id);
      }
      if (slashCommandIdsWithoutAutoSubmit.length >= 10) {
        break;
      }
    }

    return {
      ok: slashCommandIdsWithoutAutoSubmit.length === 0,
      slashCommandIdsWithoutAutoSubmit,
    };
  },
});

const DEFAULT_LAST_USED_CLI_VERIFY_SCAN_LIMIT = 500;
const MAX_LAST_USED_CLI_VERIFY_SCAN_LIMIT = 2000;
const MAX_LAST_USED_CLI_VERIFY_REPORT_IDS = 10;

/**
 * Bounded because confirming a miss costs a per-thread message read: unlike the
 * single-table verifiers, this one cannot tell "nothing to backfill" from "not
 * backfilled" off the thread doc alone. The healthy case is all-clear, so the
 * report cap never fires and only `scanLimit` keeps the read set finite. Page
 * through with a higher `scanLimit` while `truncated` is set.
 */
export const verifyCliThreadLastUsedCliBackfill = internalQuery({
  args: {
    scanLimit: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.boolean(),
    checkedThreadCount: v.number(),
    threadIdsWithoutLastUsedCli: v.array(v.id("cliThreads")),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const requestedScanLimit = args.scanLimit ?? DEFAULT_LAST_USED_CLI_VERIFY_SCAN_LIMIT;
    const scanLimit = Math.max(1, Math.min(MAX_LAST_USED_CLI_VERIFY_SCAN_LIMIT, Math.floor(requestedScanLimit)));
    const threads = await ctx.db.query("cliThreads").take(scanLimit + 1);
    const truncated = threads.length > scanLimit;
    const threadsToCheck = threads.slice(0, scanLimit);
    const threadIdsWithoutLastUsedCli: Array<Id<"cliThreads">> = [];

    for (const thread of threadsToCheck) {
      if (thread.isDeleted || thread.metadata?.cli !== undefined) {
        continue;
      }
      // Only threads the backfill would actually have stamped count as misses.
      if (!(await findThreadLastUsedCli(ctx, thread._id))) {
        continue;
      }
      threadIdsWithoutLastUsedCli.push(thread._id);
      if (threadIdsWithoutLastUsedCli.length >= MAX_LAST_USED_CLI_VERIFY_REPORT_IDS) {
        break;
      }
    }

    return {
      ok: threadIdsWithoutLastUsedCli.length === 0 && !truncated,
      checkedThreadCount: threadsToCheck.length,
      threadIdsWithoutLastUsedCli,
      truncated,
    };
  },
});

export const verifyDefaultListBackfill = internalQuery({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    missingDefaultProjectIds: v.array(v.id("projects")),
    inactiveDefaultProjectIds: v.array(v.id("projects")),
    eligibleTaskIdsWithoutList: v.array(v.id("tasks")),
  }),
  handler: async (ctx) => {
    const missingDefaultProjects = await ctx.db
      .query("projects")
      .withIndex("by_isDeleted_and_defaultListId", (q) => q.eq("isDeleted", false).eq("defaultListId", undefined))
      .take(10);

    const projectsWithDefaults = await ctx.db
      .query("projects")
      .withIndex("by_isDeleted_and_defaultListId", (q) => q.eq("isDeleted", false))
      .collect();
    const inactiveDefaultProjectIds: Array<Id<"projects">> = [];
    for (const project of projectsWithDefaults) {
      if (!project.defaultListId) {
        continue;
      }
      const defaultList = await ctx.db.get("taskLists", project.defaultListId);
      if (!defaultList || defaultList.isArchived) {
        inactiveDefaultProjectIds.push(project._id);
      }
      if (inactiveDefaultProjectIds.length >= 10) {
        break;
      }
    }

    const eligibleTaskIdsWithoutList: Array<Id<"tasks">> = [];
    for (const status of currentWorkflowStatuses) {
      const task = await ctx.db
        .query("tasks")
        .withIndex("by_isDeleted_and_isArchived_and_listKey_and_status", (q) =>
          q.eq("isDeleted", false).eq("isArchived", false).eq("listKey", undefined).eq("status", status)
        )
        .first();
      if (task) {
        eligibleTaskIdsWithoutList.push(task._id);
      }
      if (eligibleTaskIdsWithoutList.length >= 10) {
        break;
      }
    }

    return {
      ok: missingDefaultProjects.length === 0 && inactiveDefaultProjectIds.length === 0 && eligibleTaskIdsWithoutList.length === 0,
      missingDefaultProjectIds: missingDefaultProjects.map((project) => project._id),
      inactiveDefaultProjectIds,
      eligibleTaskIdsWithoutList,
    };
  },
});

export const verifyTaskListRankBackfill = internalQuery({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    taskListIdsWithoutRank: v.array(v.id("taskLists")),
  }),
  handler: async (ctx) => {
    const taskListIdsWithoutRank: Array<Id<"taskLists">> = [];

    for await (const list of ctx.db.query("taskLists")) {
      if (list.rank === undefined) {
        taskListIdsWithoutRank.push(list._id);
      }
      if (taskListIdsWithoutRank.length >= 10) {
        break;
      }
    }

    return {
      ok: taskListIdsWithoutRank.length === 0,
      taskListIdsWithoutRank,
    };
  },
});

const DEFAULT_BACKLOG_PARENT_CONSISTENCY_SCAN_LIMIT = 1000;
const MAX_BACKLOG_PARENT_CONSISTENCY_SCAN_LIMIT = 5000;
const MAX_BACKLOG_PARENT_CONSISTENCY_REPORT_IDS = 10;

export const verifyBacklogSystemListParentConsistency = internalQuery({
  args: {
    scanLimit: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.boolean(),
    checkedBacklogTaskCount: v.number(),
    splitBacklogSubtaskIds: v.array(v.id("tasks")),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const requestedScanLimit = args.scanLimit ?? DEFAULT_BACKLOG_PARENT_CONSISTENCY_SCAN_LIMIT;
    const scanLimit = Math.max(1, Math.min(MAX_BACKLOG_PARENT_CONSISTENCY_SCAN_LIMIT, Math.floor(requestedScanLimit)));
    const backlogTasks = await ctx.db
      .query("tasks")
      .withIndex("by_isDeleted_and_isArchived_and_listKey_and_status", (q) =>
        q.eq("isDeleted", false).eq("isArchived", false).eq("listKey", BACKLOG_SYSTEM_LIST_KEY)
      )
      .take(scanLimit + 1);
    const truncated = backlogTasks.length > scanLimit;
    const tasksToCheck = backlogTasks.slice(0, scanLimit);
    const splitBacklogSubtaskIds: Array<Id<"tasks">> = [];

    for (const task of tasksToCheck) {
      if (!task.parentId) {
        continue;
      }
      const parent = await ctx.db.get("tasks", task.parentId);
      if (!parent || parent.isDeleted || parent.isArchived || parent.listKey !== BACKLOG_SYSTEM_LIST_KEY) {
        splitBacklogSubtaskIds.push(task._id);
        if (splitBacklogSubtaskIds.length >= MAX_BACKLOG_PARENT_CONSISTENCY_REPORT_IDS) {
          break;
        }
      }
    }

    return {
      ok: splitBacklogSubtaskIds.length === 0 && !truncated,
      checkedBacklogTaskCount: tasksToCheck.length,
      splitBacklogSubtaskIds,
      truncated,
    };
  },
});
