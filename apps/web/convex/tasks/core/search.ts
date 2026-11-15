import { query } from "../../_generated/server";
import type { QueryCtx } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { EMPTY_PAGE } from "../../lib/shared/pagination";
import { statusValidator } from "../../lib/contracts/validators";
import { getOptionalAuthenticatedAccess, getOptionalAuthenticatedUser } from "../../lib/access/auth";
import { authorizeProjectAccess } from "../../lib/access/permissions";
import { ProjectPermission } from "@/lib/authz/permissions";
import { resolveOptionalProjectTaskList } from "../lib/lists/resolution";
import { paginatedTaskResultValidator, taskSearchResponseValidator } from "../lib/validators";
import type { TaskSearchFilters } from "../lib/validators";
import type { PaginationOptions } from "convex/server";
import { getTaskAssigneeSplit } from "../lib/assignees";
import { enrichTasksWithUserDetails } from "../lib/hydrate";
import { normalizeWhitespace } from "../lib/searchText";
import { MAX_SEARCH_TERMS, REF_QUERY_REGEX } from "../lib/constants";
import {
  searchTasks,
  findTaskByRefNumber,
  paginateRecentActiveTasksByProject,
} from "../lib/tasksRepo";

function normalizeSearchExpression(rawQuery: string): string {
  const trimmed = normalizeWhitespace(rawQuery);
  if (!trimmed) {
    return "";
  }

  const terms = trimmed.split(" ").slice(0, MAX_SEARCH_TERMS);
  return terms.join(" ").toLowerCase();
}

function parseRefQuery(query: string, projectAlias: string): number | null {
  const match = normalizeWhitespace(query).toUpperCase().match(REF_QUERY_REGEX);
  if (!match) {
    return null;
  }
  if (match[1] !== projectAlias.toUpperCase()) {
    return null;
  }

  const refNumber = Number.parseInt(match[2], 10);
  return Number.isNaN(refNumber) ? null : refNumber;
}

function matchesSearchFilters(
  task: Doc<"tasks">,
  filters: TaskSearchFilters | undefined
): boolean {
  if (!filters) {
    return true;
  }
  if (filters.status !== undefined && task.status !== filters.status) {
    return false;
  }
  const split = getTaskAssigneeSplit(task);
  if (filters.assigneeId !== undefined && split.assigneeId !== (filters.assigneeId ?? undefined)) {
    return false;
  }
  if (filters.delegatedToAgentId !== undefined && split.delegatedToAgentId !== (filters.delegatedToAgentId ?? undefined)) {
    return false;
  }
  return true;
}

/**
 * Enrich + project tasks down to the compact shape the task selector / search
 * results render. Used by both search queries below.
 */
async function toTaskSelectorResultsPage(
  ctx: QueryCtx,
  tasks: Doc<"tasks">[],
  project: Doc<"projects">
) {
  const enrichedTasks = await enrichTasksWithUserDetails(ctx, tasks, project);

  return enrichedTasks.map((task) => ({
    _id: task._id,
    parentId: task.parentId,
    refId: task.refId,
    name: task.name,
    list: task.list,
    taskType: task.taskType,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    delegatedToAgent: task.delegatedToAgent,
    createdByName: task.createdByName,
    isArchived: task.isArchived,
  }));
}

interface SearchMatchesArgs {
  projectId: Id<"projects">;
  query: string;
  archiveMode: "active" | "archived";
  paginationOpts: PaginationOptions;
  listId?: string;
  listRef?: string;
  filters?: TaskSearchFilters;
}

/** One page of search hits (exact ref pinned first) for an authorized project. */
async function findSearchMatches(
  ctx: QueryCtx,
  project: Doc<"projects">,
  args: SearchMatchesArgs
) {
  const normalizedQuery = normalizeSearchExpression(args.query);
  if (!normalizedQuery) {
    return EMPTY_PAGE;
  }

  const isArchived = args.archiveMode === "archived";
  const listFilter = await resolveOptionalProjectTaskList(ctx, args);
  if ((args.listId || args.listRef) && !listFilter) {
    return EMPTY_PAGE;
  }
  const filterListKey = listFilter?.listKey ?? null;
  if (filterListKey && isArchived) {
    return EMPTY_PAGE;
  }
  const shouldPinExactMatch = args.paginationOpts.cursor === null;

  const exactRefNumber = parseRefQuery(normalizedQuery, project.alias);
  let exactRefTask: Doc<"tasks"> | null = null;
  if (exactRefNumber !== null) {
    exactRefTask = await findTaskByRefNumber(
      ctx,
      args.projectId,
      isArchived,
      exactRefNumber
    );
  }

  const searchMatches = await searchTasks(ctx, {
    projectId: args.projectId,
    text: normalizedQuery,
    isArchived,
    filters: args.filters,
    listKey: filterListKey,
    paginationOpts: args.paginationOpts,
  });

  const uniqueTasks = new Map<Id<"tasks">, Doc<"tasks">>();
  const visibleTasks: Doc<"tasks">[] = [];

  if (
    shouldPinExactMatch &&
    exactRefTask &&
    (!filterListKey || exactRefTask.listKey === filterListKey) &&
    matchesSearchFilters(exactRefTask, args.filters)
  ) {
    uniqueTasks.set(exactRefTask._id, exactRefTask);
    visibleTasks.push(exactRefTask);
  }

  for (const match of searchMatches.page) {
    if (exactRefTask && match._id === exactRefTask._id) {
      continue;
    }
    if (!matchesSearchFilters(match, args.filters)) {
      continue;
    }
    if (uniqueTasks.has(match._id)) {
      continue;
    }
    uniqueTasks.set(match._id, match);
    visibleTasks.push(match);
  }

  return {
    page: visibleTasks,
    isDone: searchMatches.isDone,
    continueCursor: searchMatches.continueCursor,
  };
}

export const recentForSelector = query({
  args: {
    projectId: v.id("projects"),
    paginationOpts: paginationOptsValidator,
  },
  returns: taskSearchResponseValidator,
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return EMPTY_PAGE;
    }

    const access = await authorizeProjectAccess(
      ctx,
      user._id,
      args.projectId,
      ProjectPermission.TASK_VIEW
    );
    if (!access) {
      return EMPTY_PAGE;
    }

    const project = access.project;

    const page = await paginateRecentActiveTasksByProject(
      ctx,
      args.projectId,
      args.paginationOpts
    );

    return {
      ...page,
      page: await toTaskSelectorResultsPage(ctx, page.page, project),
    };
  },
});

export const byProject = query({
  args: {
    projectId: v.id("projects"),
    query: v.string(),
    archiveMode: v.union(v.literal("active"), v.literal("archived")),
    paginationOpts: paginationOptsValidator,
    listId: v.optional(v.string()),
    listRef: v.optional(v.string()),
    filters: v.optional(
      v.object({
        status: v.optional(statusValidator),
        assigneeId: v.optional(v.union(v.id("users"), v.null())),
        delegatedToAgentId: v.optional(v.union(v.id("projectAgents"), v.null())),
      })
    ),
    apiKey: v.optional(v.string()),
  },
  returns: taskSearchResponseValidator,
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return EMPTY_PAGE;
    }
    const { principal } = auth;

    const access = await authorizeProjectAccess(
      ctx,
      principal,
      args.projectId,
      ProjectPermission.TASK_VIEW
    );
    if (!access) {
      return EMPTY_PAGE;
    }

    const matches = await findSearchMatches(ctx, access.project, args);
    return {
      ...matches,
      page: await toTaskSelectorResultsPage(ctx, matches.page, access.project),
    };
  },
});

/** Search hits in the task-table row shape, for the thread Tasks panel (OS-2320). */
export const byProjectForTable = query({
  args: {
    projectId: v.id("projects"),
    query: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginatedTaskResultValidator,
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return EMPTY_PAGE;
    }

    const access = await authorizeProjectAccess(
      ctx,
      user._id,
      args.projectId,
      ProjectPermission.TASK_VIEW
    );
    if (!access) {
      return EMPTY_PAGE;
    }

    const matches = await findSearchMatches(ctx, access.project, {
      ...args,
      archiveMode: "active",
    });
    return {
      ...matches,
      page: await enrichTasksWithUserDetails(ctx, matches.page, access.project),
    };
  },
});
