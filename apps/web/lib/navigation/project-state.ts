import { BOARD_GROUP_BY_VALUES } from "./constants";
import type { BoardGroupBy, BoardRowGroupBy, ListGroupBy } from "@/convex/lib/contracts/validators";
export type { BoardGroupBy, BoardRowGroupBy, ListGroupBy } from "@/convex/lib/contracts/validators";
export { BOARD_GROUP_BY_OPTIONS } from "./constants";
import {
  isValidStatusFilter,
  type ArchiveFilter,
  type AssigneeFilter,
  type StatusFilterKey,
} from "@/lib/tasks/types";
import {
  parseAssigneeFilter,
  serializeAssigneeFilter,
} from "@/lib/tasks/assignee-filters";
import { href, routeTarget, type RouteTarget } from "./target";

export type ProjectViewMode = "list" | "board";
export type ProjectViewPreference = Extract<ProjectViewMode, "board">;

export const DEFAULT_BOARD_GROUP_BY: BoardGroupBy = "status";

export interface ProjectViewPaths {
  listPath: string;
  boardPath: string;
  currentView: ProjectViewMode;
}

export interface ProjectQueryParams {
  task?: string | null;
  attachedTask?: string | null;
  artifact?: string | null;
  filter?: StatusFilterKey | null;
  assignee?: AssigneeFilter;
  archived?: boolean | null;
  list?: string | null;
  view?: ProjectViewPreference | null;
  groupBy?: BoardGroupBy | null;
  listGroupBy?: ListGroupBy | null;
  rowGroupBy?: BoardRowGroupBy | null;
}

export interface NormalizedProjectQueryParams {
  task?: string;
  attachedTask?: string;
  artifact?: string;
  filter?: StatusFilterKey;
  assignee?: string;
  archived?: "true";
  list?: string;
  view?: ProjectViewPreference;
  groupBy?: BoardGroupBy;
  listGroupBy?: ListGroupBy;
  rowGroupBy?: BoardRowGroupBy;
}

const KANBAN_SEGMENT = "/kanban";
const DEFAULT_FILTER: StatusFilterKey = "all";

function normalizeListParam(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized || undefined;
}

function isValidProjectViewPreference(
  value: string | null
): value is ProjectViewPreference {
  return value === "board";
}

function isValidBoardGroupBy(value: string | null): value is BoardGroupBy {
  return value !== null && BOARD_GROUP_BY_VALUES.some(option => option === value);
}

/** List grouping and rows also accept an explicit `none`. */
function isValidListGroupBy(value: string | null): value is ListGroupBy {
  return value === "none" || isValidBoardGroupBy(value);
}

export function isBoardViewCompatible(archiveFilter: ArchiveFilter): boolean {
  return archiveFilter !== "archived";
}

/** Default-view fields as stored on a project OR on a List document. */
export interface DefaultViewSettings {
  defaultViewMode?: ProjectViewMode | null;
  defaultBoardGroupBy?: BoardGroupBy | null;
  defaultListGroupBy?: ListGroupBy | null;
  defaultBoardRowGroupBy?: BoardRowGroupBy | null;
}

export interface ResolvedDefaultView {
  viewMode: ProjectViewMode;
  boardGroupBy: BoardGroupBy;
  listGroupBy: ListGroupBy;
  boardRowGroupBy: BoardRowGroupBy;
  /** True when the List overrode; false means the project default answered. */
  fromList: boolean;
}

/**
 * Two-level default view (OS-1566): an explicit List override wins over the
 * project default. A List with no `defaultViewMode` inherits; an explicit
 * "list" is an override that stops inheriting a project-level Board default.
 * The override answers for its own mode's grouping; the project for the other.
 */
export function resolveDefaultView(
  project: DefaultViewSettings | null | undefined,
  list?: DefaultViewSettings | null
): ResolvedDefaultView {
  const fromList = list?.defaultViewMode != null;
  const viewMode = (fromList ? list?.defaultViewMode : project?.defaultViewMode) ?? "list";
  const boardSource = fromList && viewMode === "board" ? list : project;
  const listSource = fromList && viewMode === "list" ? list : project;
  const boardGroupBy = boardSource?.defaultBoardGroupBy ?? DEFAULT_BOARD_GROUP_BY;
  return {
    viewMode,
    boardGroupBy,
    listGroupBy: listSource?.defaultListGroupBy ?? "none",
    boardRowGroupBy: toBoardRowGroupBy(boardGroupBy, boardSource?.defaultBoardRowGroupBy),
    fromList,
  };
}

/** Rows never repeat the column dimension; missing or equal means None. */
function toBoardRowGroupBy(
  columns: BoardGroupBy | null | undefined,
  rows: BoardRowGroupBy | null | undefined
): BoardRowGroupBy {
  return !rows || rows === (columns ?? DEFAULT_BOARD_GROUP_BY) ? "none" : rows;
}

/**
 * Entry target for links INTO a project (sidebar, project switcher). Resolves
 * the stored default view — the target List's own override when it has one,
 * otherwise the project default: List stays on the table route; Board targets
 * the kanban route with its grouping. Explicit URLs and in-project navigation
 * are never rewritten — this only shapes entry links.
 */
export function projectEntryTarget(
  projectListPath: string,
  defaultView: DefaultViewSettings | null | undefined,
  options: { listRef?: string | null; list?: DefaultViewSettings | null } = {}
): RouteTarget {
  const { viewMode, boardGroupBy, listGroupBy, boardRowGroupBy } = resolveDefaultView(
    defaultView,
    options.list
  );
  const useBoard = viewMode === "board";
  const pathname = useBoard
    ? `${projectListPath}${KANBAN_SEGMENT}`
    : projectListPath;

  const params: NormalizedProjectQueryParams = {};
  const listRef = normalizeListParam(options.listRef);
  if (listRef) {
    params.list = listRef;
  }
  // Missing groupBy already normalizes to status; keep entry URLs clean.
  if (useBoard && boardGroupBy !== DEFAULT_BOARD_GROUP_BY) {
    params.groupBy = boardGroupBy;
  }
  if (useBoard && boardRowGroupBy !== "none") params.rowGroupBy = boardRowGroupBy;

  if (!useBoard && listGroupBy && listGroupBy !== "none") params.listGroupBy = listGroupBy;
  return buildProjectRouteTarget(pathname, params);
}

export function resolveProjectViewPaths(pathname: string): ProjectViewPaths {
  const normalizedPathname = pathname.replace(/\/$/, "");

  if (normalizedPathname.endsWith(KANBAN_SEGMENT)) {
    const listPath = normalizedPathname.slice(0, -KANBAN_SEGMENT.length) || "/";
    return {
      listPath,
      boardPath: normalizedPathname,
      currentView: "board",
    };
  }

  return {
    listPath: normalizedPathname || "/",
    boardPath: `${normalizedPathname || "/"}${KANBAN_SEGMENT}`,
    currentView: "list",
  };
}

export function normalizeProjectParams(
  params: ProjectQueryParams
): NormalizedProjectQueryParams {
  const result: NormalizedProjectQueryParams = {};

  if (params.task) {
    result.task = params.task;
  }
  if (params.attachedTask) {
    result.attachedTask = params.attachedTask;
  }
  if (params.artifact) {
    result.artifact = params.artifact;
  }

  if (params.archived === true) {
    result.archived = "true";
  } else {
    if (params.filter && params.filter !== DEFAULT_FILTER) {
      result.filter = params.filter;
    }
    const assignee = serializeAssigneeFilter(params.assignee ?? null);
    if (assignee) {
      result.assignee = assignee;
    }
    const list = normalizeListParam(params.list);
    if (list) {
      result.list = list;
    }
  }

  // An explicit `none` stays so view switches don't refill the default.
  if (params.listGroupBy) result.listGroupBy = params.listGroupBy;
  if (params.view) {
    result.view = params.view;
  }
  if (params.archived !== true && params.groupBy) {
    result.groupBy = params.groupBy;
  }
  if (params.archived !== true && params.rowGroupBy) {
    result.rowGroupBy = toBoardRowGroupBy(params.groupBy, params.rowGroupBy);
  }

  return result;
}

export function parseProjectParams(
  searchParams: URLSearchParams
): ProjectQueryParams {
  const task = searchParams.get("task");
  const attachedTask = searchParams.get("attachedTask");
  const artifact = searchParams.get("artifact");
  const rawFilter = searchParams.get("filter");
  const filter = isValidStatusFilter(rawFilter) ? rawFilter : undefined;
  const assignee = parseAssigneeFilter(searchParams.get("assignee"));
  const archived = searchParams.get("archived");
  const list = searchParams.get("list");
  const rawView = searchParams.get("view");
  const rawGroupBy = searchParams.get("groupBy");
  const rawListGroupBy = searchParams.get("listGroupBy");
  const rawRowGroupBy = searchParams.get("rowGroupBy");

  return {
    task: task ?? undefined,
    attachedTask: attachedTask ?? undefined,
    artifact: artifact ?? undefined,
    filter,
    assignee: assignee ?? undefined,
    archived: archived === "true" ? true : undefined,
    list: normalizeListParam(list),
    view: isValidProjectViewPreference(rawView) ? rawView : undefined,
    groupBy: isValidBoardGroupBy(rawGroupBy) ? rawGroupBy : undefined,
    listGroupBy: isValidListGroupBy(rawListGroupBy) ? rawListGroupBy : undefined,
    rowGroupBy: isValidListGroupBy(rawRowGroupBy) ? rawRowGroupBy : undefined,
  };
}

export function toProjectSearchParams(
  params: NormalizedProjectQueryParams
): URLSearchParams {
  const urlParams = new URLSearchParams();

  if (params.task) urlParams.set("task", params.task);
  if (params.attachedTask) urlParams.set("attachedTask", params.attachedTask);
  if (params.artifact) urlParams.set("artifact", params.artifact);
  if (params.filter) urlParams.set("filter", params.filter);
  if (params.assignee) urlParams.set("assignee", params.assignee);
  if (params.archived) urlParams.set("archived", params.archived);
  if (params.list) urlParams.set("list", params.list);
  if (params.view) urlParams.set("view", params.view);
  if (params.listGroupBy) urlParams.set("listGroupBy", params.listGroupBy);
  if (params.groupBy) urlParams.set("groupBy", params.groupBy);
  if (params.rowGroupBy) urlParams.set("rowGroupBy", params.rowGroupBy);

  return urlParams;
}

export function buildProjectRouteTarget(
  pathname: string,
  params: NormalizedProjectQueryParams,
  scroll = false
): RouteTarget {
  return routeTarget(pathname, {
    query: toProjectSearchParams(params),
    scroll,
  });
}

export function buildProjectHref(
  pathname: string,
  params: NormalizedProjectQueryParams
): string {
  return href(buildProjectRouteTarget(pathname, params));
}

export function updateProjectParams(
  current: ProjectQueryParams,
  updates: Partial<ProjectQueryParams>
): NormalizedProjectQueryParams {
  const nextTask = updates.task !== undefined ? updates.task : current.task;
  const nextAttachedTask =
    updates.attachedTask !== undefined ? updates.attachedTask : current.attachedTask;
  const taskWasCleared = updates.task === null;
  const taskWasChanged =
    updates.task !== undefined && updates.task !== null && updates.task !== current.task;
  const nextArtifact =
    updates.artifact !== undefined
      ? updates.artifact
      : taskWasCleared || taskWasChanged
        ? null
        : current.artifact;

  const switchingToArchived = updates.archived === true;
  const updatingFilters = updates.filter !== undefined || updates.assignee !== undefined;

  if (switchingToArchived) {
    return normalizeProjectParams({
      task: nextTask,
      attachedTask: nextAttachedTask,
      artifact: nextArtifact,
      archived: true,
      list: null,
      view: updates.view !== undefined ? updates.view : current.view,
      listGroupBy: updates.listGroupBy !== undefined ? updates.listGroupBy : current.listGroupBy,
      groupBy: updates.groupBy !== undefined ? updates.groupBy : current.groupBy,
    });
  }

  if (updatingFilters) {
    return normalizeProjectParams({
      task: nextTask,
      attachedTask: nextAttachedTask,
      artifact: nextArtifact,
      filter: updates.filter !== undefined ? updates.filter : current.filter,
      assignee: updates.assignee !== undefined ? updates.assignee : current.assignee,
      archived: false,
      list: updates.list !== undefined ? updates.list : current.list,
      view: updates.view !== undefined ? updates.view : current.view,
      listGroupBy: updates.listGroupBy !== undefined ? updates.listGroupBy : current.listGroupBy,
      groupBy: updates.groupBy !== undefined ? updates.groupBy : current.groupBy,
      rowGroupBy: updates.rowGroupBy !== undefined ? updates.rowGroupBy : current.rowGroupBy,
    });
  }

  return normalizeProjectParams({
    ...current,
    ...updates,
    artifact: nextArtifact,
  });
}

export function withProjectTask(
  pathname: string,
  currentParams: ProjectQueryParams,
  taskRefId: string | null
): RouteTarget {
  return buildProjectRouteTarget(
    pathname,
    updateProjectParams(currentParams, { task: taskRefId })
  );
}

export function withProjectArtifact(
  pathname: string,
  currentParams: ProjectQueryParams,
  artifactId: string | null
): RouteTarget {
  return buildProjectRouteTarget(
    pathname,
    updateProjectParams(currentParams, { artifact: artifactId })
  );
}

export function withProjectList(
  pathname: string,
  currentParams: ProjectQueryParams,
  listRef: string | null
): RouteTarget {
  return buildProjectRouteTarget(
    pathname,
    updateProjectParams(currentParams, {
      task: null,
      artifact: null,
      list: listRef,
      archived: false,
    })
  );
}

export function withProjectTaskAndArchive(
  pathname: string,
  currentParams: ProjectQueryParams,
  taskRefId: string | null,
  archived: boolean,
  listRef?: string | null
): RouteTarget {
  return buildProjectRouteTarget(
    pathname,
    updateProjectParams(currentParams, {
      task: taskRefId,
      archived,
      ...(listRef !== undefined && { list: listRef }),
    })
  );
}

export function withProjectTaskArtifact(
  pathname: string,
  currentParams: ProjectQueryParams,
  taskRefId: string | null,
  artifactId: string | null,
  archived?: boolean
): RouteTarget {
  return buildProjectRouteTarget(
    pathname,
    updateProjectParams(currentParams, {
      task: taskRefId,
      artifact: artifactId,
      ...(archived !== undefined && { archived }),
    })
  );
}
