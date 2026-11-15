import { api, internal } from "../../../_generated/api";
import { should, throwInvalidParams } from "../../lib/should";
import { normalizeTaskDescription } from "../../../lib/contracts/taskDescription";
import { Priority as PriorityValues } from "@/lib/tasks/priority";
import {
  BUILT_IN_TASK_TYPES,
  resolveTaskTypeKey,
} from "@/lib/tasks/task-types";
import { ensureValidTaskTypeKey } from "../../lib/tasks/types/parsers";
import { isTaskRecordWithId } from "../../lib/tasks/resolution";
import {
  projectTaskListResult,
  projectDetailedTask,
  projectTaskSearchResult,
} from "../../lib/tasks/formatters";
import { getTaskUrlBase } from "../../lib/tasks/url";
import { appRoute } from "../../../../lib/navigation/routes";
import { href } from "../../../../lib/navigation/target";
import {
  parseExternalLinkInput,
  parseSearchTaskFilters,
  parseTaskAssigneeSplitArgs,
} from "../../lib/tasks/parsers";
import { ALL_TASK_STATUSES } from "@/lib/tasks/status-policy";
import {
  resolveTaskIdOrRef,
  resolveTasksByIdentifiers,
} from "../../lib/tasks/resolution";
import {
  enrichTaskWithResources,
  type McpTaskResources,
} from "../../lib/tasks/resources";
import { resolveProjectLabelId } from "./labels";
import { resolveChecklistId } from "../checks";
import type { ToolHandler } from "../context";

const VALID_PRIORITIES = Object.values(PriorityValues) as Array<
  (typeof PriorityValues)[keyof typeof PriorityValues]
>;

export const handleListTaskTypes: ToolHandler = async () => {
  return BUILT_IN_TASK_TYPES;
};

export const handleListTasks: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const projectId = await getProjectId();
  const includeArchived = args.includeArchived === true;
  const includeLinks = args.includeLinks === true;
  if (args.statuses !== undefined) {
    throwInvalidParams("Use status instead of statuses; list_tasks accepts one status.");
  }
  const status = should.beOptionalEnum(args, "status", ALL_TASK_STATUSES);
  const listIdentifier = should.beOptionalString(args, "listId")?.trim();
  const listId = listIdentifier || undefined;
  const result = await ctx.runQuery(api.tasks.core.listByProject, {
    projectId,
    archiveFilter: includeArchived ? "archived" : undefined,
    ...(status !== undefined && { status }),
    ...(listId ? { listId } : {}),
    apiKey,
  });
  return projectTaskListResult(result, { includeLinks });
};

export const handleSearchTasks: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const projectId = await getProjectId();
  const query = should.beTrimmedString(args, "query");
  const archiveMode =
    should.beOptionalEnum(args, "archiveMode", ["active", "archived"] as const) ??
    "active";
  const filters = parseSearchTaskFilters(args, "filters");
  const limit = should.beOptionalInteger(args, "limit", 1, 50) ?? 20;
  const cursor = should.beNullableString(args, "cursor") ?? null;
  const listIdentifier = should.beOptionalString(args, "listId")?.trim();
  const listId = listIdentifier || undefined;

  const searchResult = await ctx.runQuery(api.tasks.core.search.byProject, {
    projectId,
    query,
    archiveMode,
    ...(listId ? { listId } : {}),
    paginationOpts: {
      numItems: limit,
      cursor,
    },
    ...(filters !== undefined && { filters }),
    apiKey,
  });
  return projectTaskSearchResult(searchResult);
};

export const handleGetTask: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const taskIdentifier = should.beString(args, "taskId");
  const taskId = await resolveTaskIdOrRef(
    ctx,
    apiKey,
    taskIdentifier,
    "taskId",
    getProjectId
  );
  const task = await ctx.runQuery(api.tasks.core.getById, {
    id: taskId,
    apiKey,
  });
  return isTaskRecordWithId(task)
    ? projectDetailedTask(await enrichTaskWithResources(ctx, apiKey, task), {
        keepArchived: false,
      })
    : task;
};

export const handleGetTasks: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const identifiers = should.beStringArray(args, "identifiers", 25);
  const lookupResults = await resolveTasksByIdentifiers(
    ctx,
    apiKey,
    identifiers,
    getProjectId
  );

  const resourceByTaskId = new Map<
    string,
    Promise<Record<string, unknown> & McpTaskResources>
  >();
  const enrichedResults = await Promise.all(
    lookupResults.map(async (item) => {
      if (!isTaskRecordWithId(item.task)) {
        return item;
      }
      // Trade-off: this still performs up to 3 resource queries per unique task
      // (artifacts + files + comments), but refs are capped to 25 and duplicate task IDs are
      // de-duplicated through this map to avoid repeated fetches.
      const taskId = item.task._id;
      let enrichedTaskPromise = resourceByTaskId.get(taskId);
      if (!enrichedTaskPromise) {
        enrichedTaskPromise = enrichTaskWithResources(ctx, apiKey, item.task);
        resourceByTaskId.set(taskId, enrichedTaskPromise);
      }

      return {
        ...item,
        task: projectDetailedTask(await enrichedTaskPromise, {
          keepArchived: true,
        }),
      };
    })
  );

  return {
    results: enrichedResults,
  };
};

export const handleCreateTask: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const projectId = await getProjectId();
  const taskName = should.beString(args, "name");
  const taskTypeKey = resolveTaskTypeKey(should.beOptionalString(args, "taskTypeKey"));
  ensureValidTaskTypeKey(taskTypeKey);
  const description = normalizeTaskDescription(should.beOptionalString(args, "description"));
  const parentIdentifier = should.beOptionalString(args, "parentId");
  const parentId = parentIdentifier
    ? await resolveTaskIdOrRef(
        ctx,
        apiKey,
        parentIdentifier,
        "parentId",
        async () => projectId
      )
    : undefined;
  const priority = should.beOptionalEnum(args, "priority", VALID_PRIORITIES) ?? "None";
  const status = should.beOptionalEnum(args, "status", ALL_TASK_STATUSES) ?? "To Do";
  const dueDate = should.beOptionalNumber(args, "dueDate");
  const assigneeSplit = parseTaskAssigneeSplitArgs(args);
  const tags = should.beOptionalStringArray(args, "tags") ?? [];
  const listIdentifier = should.beOptionalString(args, "listId")?.trim();
  const listId = listIdentifier || undefined;
  const labelIdentifier = should.beOptionalString(args, "label");
  const labelId = await resolveProjectLabelId(
    ctx,
    apiKey,
    projectId,
    labelIdentifier,
    "label"
  );

  const {
    taskId,
    organizationId,
    projectAlias,
    refId,
  } = await ctx.runMutation(api.tasks.core.create, {
    projectId,
    parentId,
    clientId: crypto.randomUUID(),
    name: taskName,
    taskTypeKey,
    ...(description !== undefined && { description }),
    priority,
    status,
    dueDate,
    ...assigneeSplit,
    tags,
    ...(listId ? { listId } : {}),
    ...(labelId !== undefined ? { labelId } : {}),
    apiKey,
  });

  const organization = await ctx.runQuery(
    internal.organizations.core.getByIdInternal,
    {
      id: organizationId,
    }
  );
  const taskPath = href(appRoute.projectTask(organization!.slug, projectAlias, refId));
  return {
    taskId,
    refId,
    taskPath,
    taskUrl: `${getTaskUrlBase()}${taskPath}`,
  };
};

export const handleUpdateTask: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const taskIdentifier = should.beString(args, "taskId");
  const taskId = await resolveTaskIdOrRef(
    ctx,
    apiKey,
    taskIdentifier,
    "taskId",
    getProjectId
  );
  const task = await ctx.runQuery(api.tasks.core.getById, {
    id: taskId,
    apiKey,
  });
  if (!task) {
    throwInvalidParams("Task not found");
  }
  const taskName = should.beOptionalString(args, "name");
  const rawNullableKey = should.beNullableString(args, "taskTypeKey");
  // undefined → not provided (skip), null/string → resolve to valid key
  const taskTypeKey =
    rawNullableKey === undefined ? undefined : resolveTaskTypeKey(rawNullableKey);
  if (taskTypeKey !== undefined) ensureValidTaskTypeKey(taskTypeKey);
  const description = normalizeTaskDescription(
    should.beNullableString(args, "description")
  );
  const priority = should.beOptionalEnum(args, "priority", VALID_PRIORITIES);
  const status = should.beOptionalEnum(args, "status", ALL_TASK_STATUSES);
  const dueDate = should.beNullableNumber(args, "dueDate");
  const assigneeSplit = parseTaskAssigneeSplitArgs(args);
  const tags = should.beOptionalStringArray(args, "tags");
  const labelIdentifier = should.beNullableString(args, "label");
  const labelId = await resolveProjectLabelId(
    ctx,
    apiKey,
    task.projectId,
    labelIdentifier,
    "label"
  );
  // null means "no checks"; undefined leaves the checklist alone.
  const checklist = should.beNullableString(args, "checklist");
  const checklistId =
    typeof checklist === "string"
      ? await resolveChecklistId(ctx, apiKey, task.projectId, checklist, "checklist")
      : checklist;

  if (checklistId !== undefined) {
    await ctx.runMutation(api.tasks.core.setChecklist, { taskId, checklistId, apiKey });
  }
  return ctx.runMutation(api.tasks.core.update, {
    id: taskId,
    ...(taskName !== undefined && { name: taskName }),
    ...(taskTypeKey !== undefined && { taskTypeKey }),
    ...(description !== undefined && { description }),
    ...(priority !== undefined && { priority }),
    ...(status !== undefined && { status }),
    ...(dueDate !== undefined && { dueDate }),
    ...assigneeSplit,
    ...(tags !== undefined && { tags }),
    ...(labelId !== undefined ? { labelId } : {}),
    apiKey,
  });
};

export const handleUpdateTaskLink: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const taskIdentifier = should.beString(args, "taskId");
  const op = should.beOptionalEnum(args, "op", ["upsert", "delete"] as const);
  if (op === undefined) {
    throwInvalidParams("op is required and must be one of: upsert, delete");
  }
  const id = should.beString(args, "id");
  const link = parseExternalLinkInput(args, "link");

  const taskId = await resolveTaskIdOrRef(
    ctx,
    apiKey,
    taskIdentifier,
    "taskId",
    getProjectId
  );

  return ctx.runMutation(api.tasks.core.updateExternalLink, {
    taskId,
    op,
    id,
    ...(link !== undefined && { link }),
    apiKey,
  });
};

export const handleMoveTask: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const taskIdentifier = should.beString(args, "taskId");
  const parentIdentifier = should.beNullableString(args, "parentId");
  if (parentIdentifier === undefined) {
    throwInvalidParams("parentId is required and must be a string or null");
  }

  const taskId = await resolveTaskIdOrRef(
    ctx,
    apiKey,
    taskIdentifier,
    "taskId",
    getProjectId
  );
  const parentId =
    parentIdentifier === null
      ? null
      : await resolveTaskIdOrRef(
          ctx,
          apiKey,
          parentIdentifier,
          "parentId",
          getProjectId
        );

  await ctx.runMutation(api.tasks.core.move.toParent, {
    id: taskId,
    parentId,
    apiKey,
  });

  return {
    taskId,
    parentId,
  };
};

export const handleDeleteTask: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const taskIdentifier = should.beString(args, "taskId");
  const taskId = await resolveTaskIdOrRef(
    ctx,
    apiKey,
    taskIdentifier,
    "taskId",
    getProjectId
  );
  const cascadeMode = should.beOptionalEnum(
    args,
    "cascadeMode",
    ["delete_all", "keep_children"] as const
  );

  return ctx.runMutation(api.tasks.core.remove, {
    id: taskId,
    cascadeMode,
    apiKey,
  });
};
