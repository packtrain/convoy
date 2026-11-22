import { assertSectionInList } from "./lib/taskSectionsRepo";
import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v, ConvexError } from "convex/values";
import { EMPTY_PAGE } from "../lib/shared/pagination";
import { statusValidator, priorityValidator } from "../lib/contracts/validators";
import {
  getAuthenticatedAccess,
  getAuthenticatedUser,
  getOptionalAuthenticatedAccess,
  getOptionalAuthenticatedUser,
} from "../lib/access/auth";
import { authorizeProjectAccess, getAccessibleProjectsById, requireAuthorizedProject } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import type { Id, Doc } from "../_generated/dataModel";
import { Status } from "../../lib/tasks/status";
import { isClosedStatus } from "../../lib/tasks/status-policy";
import {
  BUILT_IN_TASK_TYPES,
  resolveTaskTypeKey,
} from "../../lib/tasks/task-types";
import { getDefaultListKey } from "./lib/lists/resolution";
import {
  resolveTaskTypeSummary,
  taskTypeSummaryValidator,
  validateTaskTypeKey,
} from "../lib/contracts/taskTypes";
import { resolveOptionalProjectTaskList } from "./lib/lists/resolution";
import { logTaskActivity } from "./lib/activity/logger";
import { emitEvent, emitEvents } from "../lib/events";
import type { AppEvent } from "../lib/contracts/appEvents";
import { REF_QUERY_REGEX, MAX_REFS_PER_CALL } from "./lib/constants";
import { DEFAULT_CLOSED_TASKS_LIMIT, MAX_CLOSED_TASKS_LIMIT } from "../lib/constants";
import {
  archiveTasksReturnValidator,
  taskReturnValidator,
  createTaskResultValidator,
  deleteTasksResultValidator,
  paginatedTaskResultValidator,
  getByRefsResultValidator,
  type GetByRefLookupResult,
  type TaskUpdateFields,
  assigneeIdInputValidator,
} from "./lib/validators";
import { buildTaskSearchText } from "./lib/searchText";
import { assertProjectAllowsStatus } from "./lib/invariants";
import { getAppendRankForList } from "./lib/ranking";
import { enrichTasksWithUserDetails } from "./lib/hydrate";
import {
  applyAutoSetOwner,
  resolveMeAssignee,
  assertAssignableProjectAgent,
  getTaskAssigneeSplit,
  hasAssigneeSplitUpdate,
  hydrateDelegatedAgent,
  hydrateTaskAssigneeUser,
  resolveAssigneeSplit,
  type TaskAssigneeSplit,
} from "./lib/assignees";
import { getDescendants } from "./lib/tree";
import { archiveTasksByIds, unarchiveTasksByIds } from "./lib/lifecycle";
import type { Priority } from "../../lib/tasks/priority";
import { ensure } from "../lib/shared/ensure";
import { buildPatch, clearable, mapDefined } from "../lib/shared/patch";
import { errors } from "./errors";
import {
  getTaskById,
  getActiveTaskById,
  listActiveTasksInList,
  listActiveTasksInListByStatus,
  listArchivedTasksByProject,
  listArchivedTasksByProjectAndStatus,
  listClosedTasks,
  paginateArchivedTasksByProject,
  listChildTasks,
  findTaskByRefNumber,
  getTasksByIds,
  deleteTask,
  insertTask,
  patchTask,
  softDeleteTask,
} from "./lib/tasksRepo";
import { reserveTaskRefNumbers } from "./lib/taskRefCountersRepo";
import { taskSummaryValidator, toTaskSummary } from "../lib/contracts/taskSummaries";
import { assertLabelInProject, getLabelById } from "./lib/taskLabelsRepo";
import { assertChecklistInProject, findTaskTypeDefault, listChecklistsByProject } from "../checks/lib/checklistsRepo";
import { listArtifactsByTaskNewestFirst, deleteArtifact } from "./lib/taskArtifactsRepo";
import { listTaskAttachmentsByTaskId, deleteTaskAttachment } from "./lib/taskAttachmentsRepo";
import { deleteCheckResultsByTask } from "../checks/lib/checkResultsRepo";
import { deleteStorageIfUnreferenced } from "../lib/storageRepo";
import { applyAndLogExternalLinkOp } from "./lib/externalLinks";
import { taskExternalLinkInputValidator, taskExternalLinkValidator } from "../lib/contracts/taskExternalLinks";

export const listTypes = query({
  args: {
    projectId: v.id("projects"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(taskTypeSummaryValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }

    const access = await authorizeProjectAccess(
      ctx,
      auth.principal,
      args.projectId,
      ProjectPermission.TASK_VIEW
    );
    if (!access) {
      return [];
    }

    return BUILT_IN_TASK_TYPES.map((taskType) =>
      resolveTaskTypeSummary(taskType.key)
    );
  },
});

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    archiveFilter: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    status: v.optional(statusValidator),
    listId: v.optional(v.string()),
    listRef: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(taskReturnValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }
    const { principal } = auth;

    // Check project access (handles org membership + project membership)
    const access = await authorizeProjectAccess(ctx, principal, args.projectId, ProjectPermission.TASK_VIEW);
    if (!access) {
      return [];
    }

    const project = access.project;

    const isArchived = args.archiveFilter === "archived";
    const listFilter = await resolveOptionalProjectTaskList(ctx, {
      ...args,
      activeOnly: false,
    });
    if ((args.listId || args.listRef) && !listFilter) {
      return [];
    }
    const filterListKey = listFilter?.listKey ?? null;
    if (filterListKey && isArchived) {
      return [];
    }
    const status = args.status as Status | undefined;

    let filteredTasks: Doc<"tasks">[];
    if (isArchived) {
      filteredTasks = status
        ? await listArchivedTasksByProjectAndStatus(ctx, args.projectId, status)
        : await listArchivedTasksByProject(ctx, args.projectId);
    } else {
      const effectiveListKey = filterListKey ?? getDefaultListKey(project);
      filteredTasks = status
        ? await listActiveTasksInListByStatus(ctx, args.projectId, effectiveListKey, status)
        : await listActiveTasksInList(ctx, args.projectId, effectiveListKey);
    }

    if (status && isClosedStatus(status)) {
      filteredTasks = filteredTasks.filter((task) => task.parentId === undefined);
    }

    return enrichTasksWithUserDetails(ctx, filteredTasks, project);
  },
});

/** Last closed tasks, newest first, optionally within `[since, until)` (docs/specs/task-closed-at.md). */
export const listClosed = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(v.union(v.literal(Status.DONE), v.literal(Status.CANCELED))),
    limit: v.optional(v.number()),
    since: v.optional(v.number()),
    until: v.optional(v.number()),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(taskReturnValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? DEFAULT_CLOSED_TASKS_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CLOSED_TASKS_LIMIT) {
      throw new ConvexError(`limit must be an integer from 1 to ${MAX_CLOSED_TASKS_LIMIT}`);
    }
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }
    const access = await authorizeProjectAccess(ctx, auth.principal, args.projectId, ProjectPermission.TASK_VIEW);
    if (!access) {
      return [];
    }
    const tasks = await listClosedTasks(ctx, {
      projectId: args.projectId,
      status: args.status ?? Status.DONE,
      limit,
      since: args.since,
      until: args.until,
    });
    return enrichTasksWithUserDetails(ctx, tasks, access.project);
  },
});

export const listArchivedByProject = query({
  args: {
    projectId: v.id("projects"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginatedTaskResultValidator,
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return EMPTY_PAGE;
    }

    const access = await authorizeProjectAccess(ctx, user._id, args.projectId, ProjectPermission.TASK_VIEW);
    if (!access) {
      return EMPTY_PAGE;
    }

    const project = access.project;

    const results = await paginateArchivedTasksByProject(ctx, args.projectId, args.paginationOpts);

    const enrichedPage = await enrichTasksWithUserDetails(ctx, results.page, project);

    return {
      ...results,
      page: enrichedPage,
    };
  },
});

export const listByParent = query({
  args: { parentId: v.id("tasks"), apiKey: v.optional(v.string()) },
  returns: v.array(taskReturnValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }
    const { principal } = auth;

    // Get the parent task to verify access and get project info
    const parentTask = await getActiveTaskById(ctx, args.parentId);
    if (!parentTask) {
      return [];
    }

    // Check project access (handles org membership + project membership)
    const access = await authorizeProjectAccess(ctx, principal, parentTask.projectId, ProjectPermission.TASK_VIEW);
    if (!access) {
      return [];
    }

    const project = access.project;

    // Query children using the parent index (sorted by rank via the index)
    const children = await listChildTasks(ctx, args.parentId);

    return enrichTasksWithUserDetails(ctx, children, project);
  },
});

/**
 * Batch-count direct children for multiple parent task IDs.
 * Skips per-parent permission checks — the caller must have already verified access.
 */
export const countChildrenBatch = internalQuery({
  args: { parentIds: v.array(v.id("tasks")) },
  returns: v.array(v.object({ parentId: v.id("tasks"), count: v.number() })),
  handler: async (ctx, args) => {
    return Promise.all(
      args.parentIds.map(async (parentId) => {
        const children = await listChildTasks(ctx, parentId);
        return { parentId, count: children.length };
      })
    );
  },
});

export const getById = query({
  args: {
    id: v.id("tasks"),
    apiKey: v.optional(v.string()),
  },
  returns: v.union(taskReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) return null;
    const { principal } = auth;

    const task = await getActiveTaskById(ctx, args.id);
    if (!task) return null;

    // Check project access
    const access = await authorizeProjectAccess(ctx, principal, task.projectId, ProjectPermission.TASK_VIEW);
    if (!access) return null;

    const project = access.project;

    const [enriched] = await enrichTasksWithUserDetails(ctx, [task], project);
    return enriched ?? null;
  },
});

/**
 * Task refs for surfaces that render them beside their own content — today the thread
 * group's tab strip (OS-1477). Keyed by task id on purpose: the strip's own
 * subscription re-runs on every child write, so resolving refs there would put task
 * reads on that hot path. Unviewable tasks are dropped, not rejected.
 */
export const getSummariesByIds = query({
  args: {
    taskIds: v.array(v.id("tasks")),
  },
  returns: v.array(taskSummaryValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const tasks = (await getTasksByIds(ctx, [...new Set(args.taskIds)])).filter(
      (task): task is Doc<"tasks"> => task !== null && !task.isDeleted
    );
    const accessibleProjects = await getAccessibleProjectsById(
      ctx,
      user._id,
      [...new Set(tasks.map((task) => task.projectId))],
      ProjectPermission.TASK_VIEW
    );

    return tasks.flatMap((task) => {
      const project = accessibleProjects.get(task.projectId);
      return project ? [toTaskSummary(task, project)] : [];
    });
  },
});

// getByRefs-only helpers (single consumer — kept module-local per the
// helper-placement rule).
function allRefsError(refs: string[], error: string) {
  return { results: refs.map((ref) => ({ ref, task: null, error })) };
}

function makeGetByRefLookupResult(ref: string, taskDoc: Doc<"tasks"> | null, error?: string): GetByRefLookupResult {
  if (error) {
    return { ref, taskDoc, error };
  }
  return { ref, taskDoc };
}

export const getByRefs = query({
  args: {
    refs: v.array(v.string()),
    projectId: v.id("projects"),
    apiKey: v.optional(v.string()),
  },
  returns: getByRefsResultValidator,
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return allRefsError(args.refs, "Not authenticated");
    }
    const { principal } = auth;

    if (args.refs.length > MAX_REFS_PER_CALL) {
      return allRefsError(args.refs, `Too many refs (max ${MAX_REFS_PER_CALL})`);
    }

    const access = await authorizeProjectAccess(ctx, principal, args.projectId, ProjectPermission.TASK_VIEW);
    if (!access) {
      return allRefsError(args.refs, "Project not found or no access");
    }

    const project = access.project;

    const projectAlias = project.alias.toUpperCase();

    const lookupResults = await Promise.all(
      args.refs.map(async (ref): Promise<GetByRefLookupResult> => {
        const match = ref.trim().toUpperCase().match(REF_QUERY_REGEX);
        if (!match) {
          return makeGetByRefLookupResult(ref, null, "Invalid ref format");
        }

        const alias = match[1];
        const refNumber = Number.parseInt(match[2], 10);
        if (Number.isNaN(refNumber)) {
          return makeGetByRefLookupResult(ref, null, "Invalid ref format");
        }

        if (alias !== projectAlias) {
          return makeGetByRefLookupResult(ref, null, "Alias does not match project");
        }

        // Look up active task first
        let task = await findTaskByRefNumber(ctx, args.projectId, false, refNumber);

        // Fall back to archived
        if (!task) {
          task = await findTaskByRefNumber(ctx, args.projectId, true, refNumber);
        }

        return makeGetByRefLookupResult(ref, task ?? null);
      })
    );

    const resolvedTasks = lookupResults.map((result) => result.taskDoc).filter((taskDoc): taskDoc is Doc<"tasks"> => taskDoc !== null);
    const enrichedTasks = await enrichTasksWithUserDetails(ctx, resolvedTasks, project);
    const enrichedTaskMap = new Map(enrichedTasks.map((task) => [task._id, task]));

    const results = lookupResults.map(
      (
        result
      ): {
        ref: string;
        task: (typeof taskReturnValidator)["type"] | null;
        error?: string;
      } => {
        if (!result.taskDoc) {
          if (result.error) {
            return { ref: result.ref, task: null, error: result.error };
          }
          return { ref: result.ref, task: null };
        }

        const enrichedTask = enrichedTaskMap.get(result.taskDoc._id) ?? null;
        return { ref: result.ref, task: enrichedTask };
      }
    );

    return { results };
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("tasks")), // Optional parent task for subtasks
    clientId: v.string(),
    name: v.string(),
    taskTypeKey: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: priorityValidator,
    dueDate: v.optional(v.number()),
    status: statusValidator,
    listId: v.optional(v.string()),
    listRef: v.optional(v.string()),
    assigneeId: v.optional(assigneeIdInputValidator),
    delegatedToAgentId: v.optional(v.union(v.id("projectAgents"), v.null())),
    tags: v.array(v.string()),
    labelId: v.optional(v.id("projectLabels")),
    sectionId: v.optional(v.id("taskSections")),
    rank: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: createTaskResultValidator,
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const { project } = await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.TASK_CREATE);
    const splitArgs = applyAutoSetOwner({
      splitArgs: { assigneeId: resolveMeAssignee(args.assigneeId, user._id), delegatedToAgentId: args.delegatedToAgentId },
      currentAssigneeId: undefined,
      actingUserId: user._id,
    });
    await assertAssignableProjectAgent(ctx, args.projectId, splitArgs.delegatedToAgentId);
    assertProjectAllowsStatus(project, args.status);
    const taskTypeKey = resolveTaskTypeKey(args.taskTypeKey);
    validateTaskTypeKey(taskTypeKey);
    if (args.labelId) {
      await assertLabelInProject(ctx, args.projectId, args.labelId);
    }
    const listFilter = await resolveOptionalProjectTaskList(ctx, args);
    if ((args.listId || args.listRef) && !listFilter) {
      throw new ConvexError(errors.LIST_NOT_FOUND);
    }
    let listKey: string | undefined = listFilter?.listKey;
    // Validate parent if provided
    let parentTask: Doc<"tasks"> | null = null;
    if (args.parentId) {
      parentTask = await getActiveTaskById(ctx, args.parentId);
      if (!parentTask) {
        throw new ConvexError(errors.PARENT_TASK_NOT_FOUND);
      }
      if (parentTask.projectId !== args.projectId) {
        throw new ConvexError(errors.PARENT_TASK_DIFFERENT_PROJECT);
      }
      if (parentTask.isArchived) {
        throw new ConvexError(errors.SUBTASK_UNDER_ARCHIVED);
      }
      if (listKey && parentTask.listKey !== listKey) {
        throw new ConvexError(errors.SUBTASK_LIST_MUST_MATCH_PARENT);
      }
      if (!listKey && parentTask.listKey) {
        listKey = parentTask.listKey;
      }
    }

    if (!listKey) {
      listKey = getDefaultListKey(project);
    }
    if (args.sectionId) {
      ensure(args.parentId).isNull(errors.SECTION_SUBTASK);
      await assertSectionInList(ctx, { projectId: args.projectId, listKey, sectionId: args.sectionId });
    }
    // Auto-generate rank if not provided: append to the end of the List
    let rank = args.rank;
    if (!rank) {
      rank = await getAppendRankForList(ctx, args.projectId, listKey);
    }

    // Reserve a single ref number from the project's dedicated counter (OS-934).
    const refNumber = await reserveTaskRefNumbers(ctx, project._id, 1);

    const searchText = buildTaskSearchText(project.alias, {
      refNumber,
      name: args.name,
      description: args.description,
      tags: args.tags,
    });
    const taskId = await insertTask(ctx, {
      projectId: args.projectId,
      parentId: args.parentId,
      taskTypeKey,
      clientId: args.clientId,
      refNumber: refNumber,
      name: args.name,
      description: args.description,
      searchText,
      priority: args.priority,
      dueDate: args.dueDate,
      status: args.status,
      listKey,
      ...(hasAssigneeSplitUpdate(splitArgs)
        ? resolveAssigneeSplit({ assigneeId: undefined, delegatedToAgentId: undefined }, splitArgs)
        : {}),
      tags: args.tags,
      labelId: args.labelId,
      sectionId: args.sectionId,
      rank,
      createdBy: user._id,
    });
    // Log activity
    await logTaskActivity.created(ctx, {
      taskId,
      userId: user._id,
    });
    await emitEvent(ctx, {
      type: "task.created",
      actorUserId: user._id,
      projectId: args.projectId,
      subject: { kind: "task", id: taskId },
      payload: {},
    });

    return {
      taskId,
      projectId: args.projectId,
      organizationId: project.organizationId,
      projectAlias: project.alias,
      refNumber,
      refId: `${project.alias}-${refNumber}`,
    };
  },
});

type TaskUpdateArgs = {
  id: Id<"tasks">;
  name?: string;
  taskTypeKey?: string | null;
  description?: string | null;
  priority?: Priority;
  dueDate?: number | null;
  status?: Status;
  assigneeId?: Id<"users"> | null;
  delegatedToAgentId?: Id<"projectAgents"> | null;
  tags?: string[];
  labelId?: Id<"projectLabels"> | null;
  sectionId?: Id<"taskSections"> | null;
  rank?: string;
  apiKey?: string;
};

/** Build the `tasks` patch for an update, validating task type + status policy and rebuilding searchText when name/description/tags change. */
function buildTaskUpdatePatch(
  args: TaskUpdateArgs,
  task: Doc<"tasks">,
  project: Doc<"projects">,
  resolvedSplit: TaskAssigneeSplit | null
): TaskUpdateFields {
  const patch = buildPatch<TaskUpdateFields>({
    name: args.name,
    taskTypeKey: mapDefined(args.taskTypeKey, (raw) => {
      const key = resolveTaskTypeKey(raw);
      validateTaskTypeKey(key);
      return key;
    }),
    description: clearable(args.description),
    priority: args.priority,
    dueDate: clearable(args.dueDate),
    status: mapDefined(args.status, (status) => {
      if (status !== task.status) {
        assertProjectAllowsStatus(project, status);
      }
      return status;
    }),
    tags: args.tags,
    labelId: clearable(args.labelId),
    sectionId: clearable(args.sectionId),
    rank: args.rank,
  });

  if (resolvedSplit) {
    Object.assign(patch, resolvedSplit);
  }

  if (args.name !== undefined || args.description !== undefined || args.tags !== undefined) {
    const nextName = args.name ?? task.name;
    const nextDescription = args.description !== undefined ? (args.description ?? undefined) : task.description;
    const nextTags = args.tags ?? task.tags;
    patch.searchText = buildTaskSearchText(project.alias, {
      refNumber: task.refNumber,
      name: nextName,
      description: nextDescription,
      tags: nextTags,
    });
  }
  return patch;
}

/** Set difference between the old and new tag arrays; a pure reorder yields two empty arrays. */
function diffTags(oldTags: string[] | undefined, newTags: string[]): { added: string[]; removed: string[] } {
  const before = new Set(oldTags ?? []);
  const after = new Set(newTags);
  return {
    added: [...after].filter((tag) => !before.has(tag)),
    removed: [...before].filter((tag) => !after.has(tag)),
  };
}

/** Emit field-level activity log entries and bus events by diffing the update args against the current task. */
async function logTaskUpdateChanges(
  ctx: MutationCtx,
  args: {
    task: Doc<"tasks">;
    updateArgs: TaskUpdateArgs;
    resolvedSplit: TaskAssigneeSplit | null;
    userId: Id<"users">;
  }
): Promise<void> {
  const { task, updateArgs, resolvedSplit, userId } = args;
  const events: AppEvent[] = [];

  if (updateArgs.status !== undefined && updateArgs.status !== task.status) {
    await logTaskActivity.statusChanged(ctx, {
      taskId: task._id,
      userId,
      oldValue: task.status,
      newValue: updateArgs.status,
    });
    events.push({
      type: "task.status_changed",
      actorUserId: userId,
      projectId: task.projectId,
      subject: { kind: "task", id: task._id },
      payload: { oldStatus: task.status, newStatus: updateArgs.status },
    });
  }

  if (updateArgs.priority !== undefined && updateArgs.priority !== task.priority) {
    await logTaskActivity.priorityChanged(ctx, {
      taskId: task._id,
      userId,
      oldValue: task.priority,
      newValue: updateArgs.priority,
    });
  }

  if (resolvedSplit) {
    const oldSplit = getTaskAssigneeSplit(task);
    if (oldSplit.assigneeId !== resolvedSplit.assigneeId) {
      const [oldAssignee, newAssignee] = await Promise.all([
        hydrateTaskAssigneeUser(ctx, oldSplit.assigneeId),
        hydrateTaskAssigneeUser(ctx, resolvedSplit.assigneeId),
      ]);
      await logTaskActivity.assigneeChanged(ctx, {
        taskId: task._id,
        userId,
        oldAssignee,
        newAssignee,
      });
      events.push({
        type: "task.assignee_changed",
        actorUserId: userId,
        projectId: task.projectId,
        subject: { kind: "task", id: task._id },
        payload: { oldAssigneeId: oldSplit.assigneeId, newAssigneeId: resolvedSplit.assigneeId },
      });
    }
    if (oldSplit.delegatedToAgentId !== resolvedSplit.delegatedToAgentId) {
      const [oldAgent, newAgent] = await Promise.all([
        hydrateDelegatedAgent(ctx, oldSplit.delegatedToAgentId),
        hydrateDelegatedAgent(ctx, resolvedSplit.delegatedToAgentId),
      ]);
      await logTaskActivity.delegationChanged(ctx, {
        taskId: task._id,
        userId,
        oldAgent,
        newAgent,
      });
    }
  }

  if (updateArgs.dueDate !== undefined) {
    const oldDueDate = task.dueDate;
    const newDueDate = updateArgs.dueDate;
    const oldNormalized = oldDueDate ?? null;
    const newNormalized = newDueDate ?? null;
    if (oldNormalized !== newNormalized) {
      await logTaskActivity.dueDateChanged(ctx, {
        taskId: task._id,
        userId,
        oldValue: oldDueDate,
        newValue: newDueDate ?? undefined,
      });
    }
  }

  if (updateArgs.labelId !== undefined) {
    const oldLabelId = task.labelId ?? null;
    const newLabelId = updateArgs.labelId;
    if (oldLabelId !== newLabelId) {
      const [oldLabel, newLabel] = await Promise.all([
        oldLabelId ? getLabelById(ctx, oldLabelId) : null,
        newLabelId ? getLabelById(ctx, newLabelId) : null,
      ]);
      await logTaskActivity.labelChanged(ctx, {
        taskId: task._id,
        userId,
        oldLabel: oldLabel ? { id: oldLabel._id, name: oldLabel.name, color: oldLabel.color } : undefined,
        newLabel: newLabel ? { id: newLabel._id, name: newLabel.name, color: newLabel.color } : undefined,
      });
    }
  }

  if (updateArgs.tags !== undefined) {
    const { added, removed } = diffTags(task.tags, updateArgs.tags);
    if (added.length > 0 || removed.length > 0) {
      await logTaskActivity.tagsChanged(ctx, { taskId: task._id, userId, added, removed });
    }
  }

  if (updateArgs.taskTypeKey !== undefined) {
    // Compare resolved keys on both sides: the patch normalizes the key, so a
    // raw `undefined -> "task"` would otherwise log a phantom change.
    const oldKey = resolveTaskTypeKey(task.taskTypeKey);
    const newKey = resolveTaskTypeKey(updateArgs.taskTypeKey);
    if (oldKey !== newKey) {
      await logTaskActivity.typeChanged(ctx, { taskId: task._id, userId, oldKey, newKey });
    }
  }

  if (updateArgs.name !== undefined && updateArgs.name !== task.name) {
    await logTaskActivity.nameEdited(ctx, {
      taskId: task._id,
      userId,
      oldValue: task.name,
      newValue: updateArgs.name,
    });
  }

  if (updateArgs.description !== undefined && updateArgs.description !== task.description) {
    await logTaskActivity.descriptionEdited(ctx, { taskId: task._id, userId });
  }

  await emitEvents(ctx, events);
}

export const update = mutation({
  args: {
    id: v.id("tasks"),
    name: v.optional(v.string()),
    taskTypeKey: v.optional(v.union(v.string(), v.null())),
    description: v.optional(v.union(v.string(), v.null())),
    priority: v.optional(priorityValidator),
    dueDate: v.optional(v.union(v.number(), v.null())),
    status: v.optional(statusValidator),
    assigneeId: v.optional(assigneeIdInputValidator),
    delegatedToAgentId: v.optional(v.union(v.id("projectAgents"), v.null())),
    tags: v.optional(v.array(v.string())),
    labelId: v.optional(v.union(v.id("projectLabels"), v.null())),
    sectionId: v.optional(v.union(v.id("taskSections"), v.null())),
    rank: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const task = await ensure(getActiveTaskById(ctx, args.id)).notNull(errors.TASK_NOT_FOUND);

    const { project } = await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.TASK_UPDATE);

    const updateArgs = { ...args, assigneeId: resolveMeAssignee(args.assigneeId, user._id) };
    const currentSplit = getTaskAssigneeSplit(task);
    const splitArgs = applyAutoSetOwner({
      splitArgs: { assigneeId: updateArgs.assigneeId, delegatedToAgentId: args.delegatedToAgentId },
      currentAssigneeId: currentSplit.assigneeId,
      actingUserId: user._id,
    });
    await assertAssignableProjectAgent(ctx, task.projectId, splitArgs.delegatedToAgentId);
    const resolvedSplit = hasAssigneeSplitUpdate(splitArgs) ? resolveAssigneeSplit(currentSplit, splitArgs) : null;

    if (args.labelId) {
      await assertLabelInProject(ctx, task.projectId, args.labelId);
    }
    if (args.sectionId) {
      ensure(task.parentId).isNull(errors.SECTION_SUBTASK);
      await assertSectionInList(ctx, { projectId: task.projectId, listKey: task.listKey, sectionId: args.sectionId });
    }

    const patch = buildTaskUpdatePatch(updateArgs, task, project, resolvedSplit);

    if (Object.keys(patch).length > 0) {
      await patchTask(ctx, args.id, patch);

      await logTaskUpdateChanges(ctx, {
        task,
        updateArgs,
        resolvedSplit,
        userId: user._id,
      });
    }

    return null;
  },
});

/** Picks the task's checklist, or none. Picking the type default stores unset, so the task follows the mapping. */
export const setChecklist = mutation({
  args: {
    taskId: v.id("tasks"),
    checklistId: v.union(v.id("checklists"), v.null()),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const task = await ensure(getActiveTaskById(ctx, args.taskId)).notNull(errors.TASK_NOT_FOUND);
    await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.TASK_UPDATE);

    let checklistId: Id<"checklists"> | null | undefined = null;
    if (args.checklistId !== null) {
      await assertChecklistInProject(ctx, task.projectId, args.checklistId);
      const typeDefault = findTaskTypeDefault(await listChecklistsByProject(ctx, task.projectId), resolveTaskTypeKey(task.taskTypeKey));
      checklistId = typeDefault?._id === args.checklistId ? undefined : args.checklistId;
    }
    if (checklistId !== task.checklistId) {
      await patchTask(ctx, task._id, { checklistId });
    }
    return null;
  },
});

/**
 * Canonical mutation for one embedded external link on a task. Links are an embedded
 * field, not a separate entity, so this lives on the core tasks module.
 *
 * Link ids are client-generated (making upserts idempotent) and timestamps are
 * server-stamped. `upsert` replaces in place or appends; `delete` is idempotent.
 */
export const updateExternalLink = mutation({
  args: {
    taskId: v.id("tasks"),
    op: v.union(v.literal("upsert"), v.literal("delete")),
    id: v.string(),
    link: v.optional(taskExternalLinkInputValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.object({
    taskId: v.id("tasks"),
    externalLinks: v.array(taskExternalLinkValidator),
  }),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const task = await ensure(getActiveTaskById(ctx, args.taskId)).notNull(errors.TASK_NOT_FOUND);
    await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.TASK_UPDATE);

    const externalLinks = await applyAndLogExternalLinkOp(ctx, task, args, user._id);
    return { taskId: task._id, externalLinks };
  },
});

/**
 * Upsert one external link on behalf of an automated producer (today: CLI
 * thread PR capture, OS-1455). Callers schedule this rather than calling it
 * inline, so a failure — a link cap, an oversized payload — fails only this
 * mutation, atomically, and never the run that produced the link.
 */
export const upsertExternalLink = internalMutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.id("users"),
    id: v.string(),
    link: taskExternalLinkInputValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await getActiveTaskById(ctx, args.taskId);
    if (!task) return null;

    await applyAndLogExternalLinkOp(ctx, task, { op: "upsert", id: args.id, link: args.link }, args.userId);
    return null;
  },
});

export const remove = mutation({
  args: {
    id: v.id("tasks"),
    // Optional cascade mode for tasks with children
    // "delete_all" = delete parent and all descendants
    // "keep_children" = delete parent, move children to grandparent (or top-level)
    // If not provided, defaults to "delete_all" for tasks with children
    cascadeMode: v.optional(v.union(v.literal("delete_all"), v.literal("keep_children"))),
    apiKey: v.optional(v.string()),
  },
  returns: deleteTasksResultValidator,
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const deletedIds = new Set<Id<"tasks">>();

    const task = await getActiveTaskById(ctx, args.id);
    // Already deleted or doesn't exist - return success (idempotent)
    if (!task) {
      return { deletedIds: [] };
    }

    await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.TASK_DELETE);

    // Get direct children
    const children = await listChildTasks(ctx, args.id);

    const hasChildren = children.length > 0;
    const cascadeMode = args.cascadeMode ?? "delete_all";

    if (hasChildren && cascadeMode === "keep_children") {
      // Move children to the grandparent (or top-level if no grandparent)
      const newParentId = task.parentId; // undefined if task was top-level
      for (const child of children) {
        // Promoted roots stay in the deleted root's section.
        await patchTask(ctx, child._id, {
          parentId: newParentId,
          sectionId: task.sectionId,
        });
      }
    } else if (hasChildren && cascadeMode === "delete_all") {
      // Recursively soft-delete all descendants
      const descendants = await getDescendants(ctx, args.id);

      for (const descendant of descendants) {
        if (deletedIds.has(descendant._id)) continue;
        await softDeleteTask(ctx, descendant._id, user._id);
        deletedIds.add(descendant._id);
      }
    }

    // Schedule permanent deletion of the task itself
    if (!deletedIds.has(args.id)) {
      await softDeleteTask(ctx, args.id, user._id);
      deletedIds.add(args.id);
    }

    // Log activity
    await logTaskActivity.deleted(ctx, {
      taskId: args.id,
      userId: user._id,
    });
    await emitEvent(ctx, {
      type: "task.deleted",
      actorUserId: user._id,
      projectId: task.projectId,
      subject: { kind: "task", id: args.id },
      payload: {},
    });

    return { deletedIds: Array.from(deletedIds) };
  },
});

export const restore = mutation({
  args: { id: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const task = await ensure(getTaskById(ctx, args.id)).notNull(errors.TASK_NOT_FOUND);

    if (!task.isDeleted) {
      return null; // Already restored
    }

    await requireAuthorizedProject(ctx, user._id, task.projectId, ProjectPermission.TASK_DELETE);

    // Cancel the scheduled permanent deletion
    if (task.scheduledDeletionId) {
      await ctx.scheduler.cancel(task.scheduledDeletionId);
    }

    await patchTask(ctx, args.id, {
      isDeleted: false,
      deletedAt: undefined,
      deletedBy: undefined,
      scheduledDeletionId: undefined,
    });

    // Log activity
    await logTaskActivity.restored(ctx, {
      taskId: args.id,
      userId: user._id,
    });

    return null;
  },
});

export const archive = mutation({
  args: { id: v.id("tasks") },
  returns: archiveTasksReturnValidator,
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    return await archiveTasksByIds(ctx, user._id, [args.id]);
  },
});

export const unarchive = mutation({
  args: { id: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    await ensure(getTaskById(ctx, args.id)).notNull(errors.TASK_NOT_FOUND);

    await unarchiveTasksByIds(ctx, user._id, [args.id]);

    return null;
  },
});

export const permanentlyDelete = internalMutation({
  args: { taskId: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await getTaskById(ctx, args.taskId);
    if (!task) {
      return null;
    }

    const artifacts = await listArtifactsByTaskNewestFirst(ctx, args.taskId);
    for (const artifact of artifacts) {
      await deleteArtifact(ctx, artifact._id);
    }

    // Delete all attachments and their storage files
    const attachments = await listTaskAttachmentsByTaskId(ctx, args.taskId);
    for (const attachment of attachments) {
      await deleteTaskAttachment(ctx, attachment._id);
      await deleteStorageIfUnreferenced(ctx, attachment.storageId);
    }

    for (const storageId of await deleteCheckResultsByTask(ctx, args.taskId)) {
      await deleteStorageIfUnreferenced(ctx, storageId);
    }

    await deleteTask(ctx, args.taskId);
  },
});

// Tree node for collecting tasks before duplication
type TaskNode = {
  task: Doc<"tasks">;
  children: TaskNode[];
};

export const duplicate = mutation({
  args: {
    id: v.id("tasks"),
    newClientId: v.string(), // Client-generated ID for the duplicated root task
    newRank: v.string(), // Rank for the duplicated root task
  },
  returns: v.id("tasks"),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const sourceTask = await ensure(getActiveTaskById(ctx, args.id)).notNull(errors.TASK_NOT_FOUND);

    const { project } = await requireAuthorizedProject(ctx, user._id, sourceTask.projectId, ProjectPermission.TASK_CREATE);

    // Step 1: Collect entire task tree in one pass (each task read once)
    async function collectTaskTree(taskId: Id<"tasks">): Promise<TaskNode> {
      const task = await getActiveTaskById(ctx, taskId);
      if (!task) {
        throw new Error("Task not found during collection");
      }

      const children = await listChildTasks(ctx, taskId);

      const childNodes: TaskNode[] = [];
      for (const child of children) {
        childNodes.push(await collectTaskTree(child._id));
      }

      return { task, children: childNodes };
    }

    // Step 2: Count nodes from in-memory tree (no DB reads)
    function countNodes(node: TaskNode): number {
      return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
    }

    // Step 3: Collect the tree and reserve the whole refNumber range in one
    // counter write (OS-935), then assign numbers in memory below.
    const tree = await collectTaskTree(args.id);
    const taskCount = countNodes(tree);
    const startRefNumber = await reserveTaskRefNumbers(ctx, project._id, taskCount);

    // Step 4: Duplicate from the already-loaded tree (no more counter writes)
    let currentRefNumber = startRefNumber;

    async function duplicateFromTree(
      node: TaskNode,
      newParentId: Id<"tasks"> | undefined,
      clientId: string,
      rank: string
    ): Promise<Id<"tasks">> {
      const refNumber = currentRefNumber++;
      const searchText = buildTaskSearchText(project.alias, {
        refNumber,
        name: node.task.name,
        description: node.task.description,
        tags: node.task.tags,
      });
      const split = getTaskAssigneeSplit(node.task);

      const newTaskId = await insertTask(ctx, {
        projectId: node.task.projectId,
        parentId: newParentId,
        taskTypeKey: resolveTaskTypeKey(node.task.taskTypeKey),
        clientId: clientId,
        refNumber: refNumber,
        name: node.task.name,
        description: node.task.description,
        searchText,
        priority: node.task.priority,
        dueDate: node.task.dueDate,
        status: node.task.status,
        listKey: node.task.listKey,
        ...split,
        tags: [...node.task.tags],
        labelId: node.task.labelId,
        checklistId: node.task.checklistId,
        sectionId: newParentId ? undefined : node.task.sectionId,
        rank: rank,
        createdBy: user._id,
      });

      for (const childNode of node.children) {
        const childClientId = crypto.randomUUID();
        await duplicateFromTree(childNode, newTaskId, childClientId, childNode.task.rank);
      }

      return newTaskId;
    }

    // Start the duplication from the collected tree
    const newTaskId = await duplicateFromTree(
      tree,
      sourceTask.parentId, // Keep same parent as the original
      args.newClientId,
      args.newRank
    );

    return newTaskId;
  },
});
