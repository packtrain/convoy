import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import {
  getAuthenticatedAccess,
  getAuthenticatedUser,
  getOptionalAuthenticatedAccess,
  getOptionalAuthenticatedUser,
} from "../lib/access/auth";
import {
  authorizeProjectAccess,
  filterProjectsByAccess,
  requireAuthorizedProject,
} from "../lib/access/permissions";
import { getOrgMembership } from "../lib/accessRepo";
import { ProjectPermission } from "../../lib/authz/permissions";
import {
  boardGroupByValidator,
  listGroupByValidator,
  boardRowGroupByValidator,
  projectViewModeValidator,
  type ProjectViewMode,
  type ListGroupBy,
  type BoardGroupBy,
  type BoardRowGroupBy,
} from "../lib/contracts/validators";
import { buildPatch, clearable, mapClearable } from "../lib/shared/patch";
import { ensure } from "../lib/shared/ensure";
import { errors } from "./errors";
import {
  pinnedSidebarListValidator,
  taskListPublicValidator,
  toPersistedPinnedSidebarList,
  toSystemPinnedSidebarList,
  toTaskListPublic,
} from "./lib/lists/validators";
import {
  systemTaskListKeyValidator,
  type SystemTaskListKey,
} from "@/lib/task-lists/system-lists";
import {
  createTaskListSearchText,
  normalizeListName,
  validateOrSuggestTaskListRef,
  validateTaskListColor,
  validateTaskListName,
  validateTaskListRef,
} from "./lib/lists/naming";
import {
  assertNotDefaultList,
  assertActiveTaskListLimit,
  assertNotLastActiveList,
  assertPinnedTaskListLimit,
  assertTaskListHasNoActiveTasks,
  assertUniqueTaskListName,
  assertUniqueTaskListRef,
  requireTaskListExists,
} from "./lib/lists/invariants";
import { resolvePersistedProjectTaskList } from "./lib/lists/resolution";
import { listSectionsByList } from "./lib/taskSectionsRepo";
import { removeSection } from "./lib/lifecycle";
import { createPersistedTaskListKey } from "../lib/contracts/taskListKeys";
import {
  deleteTaskList,
  findTaskListByRefForProject,
  getLastActiveTaskListByRank,
  getTaskListById,
  insertTaskList,
  listPinnedTaskListsByProject,
  paginateTaskLists,
  updateTaskList,
  type TaskListUpdatePatch,
} from "./lib/taskListsRepo";
import { appendRank, validateRank } from "./lib/ranking";
import {
  listUnarchivedProjectsByOrganization,
  updateProject,
} from "../projects/lib/projectsRepo";

function assertDefaultViewGrouping(args: {
  defaultViewMode?: ProjectViewMode | null;
  defaultListGroupBy?: ListGroupBy;
  defaultBoardGroupBy?: BoardGroupBy;
  defaultBoardRowGroupBy?: BoardRowGroupBy;
}) {
  if (args.defaultListGroupBy !== undefined) {
    ensure(args.defaultViewMode).eq("list", errors.LIST_GROUPING_REQUIRES_LIST_MODE);
  }
  if (args.defaultBoardGroupBy !== undefined) {
    ensure(args.defaultViewMode).eq("board", errors.LIST_GROUPING_REQUIRES_BOARD_MODE);
  }
  if (args.defaultBoardRowGroupBy !== undefined) {
    ensure(args.defaultViewMode).eq("board", errors.BOARD_ROWS_REQUIRE_BOARD_MODE);
  }
}

const EMPTY_TASK_LIST_PAGE = {
  page: [],
  isDone: true,
  continueCursor: "",
};

export const list = query({
  args: {
    projectId: v.id("projects"),
    archived: v.optional(v.boolean()),
    query: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
    apiKey: v.optional(v.string()),
  },
  returns: paginationResultValidator(taskListPublicValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return EMPTY_TASK_LIST_PAGE;
    }
    const { principal } = auth;

    const access = await authorizeProjectAccess(
      ctx,
      principal,
      args.projectId,
      ProjectPermission.PROJECT_VIEW
    );
    if (!access) {
      return EMPTY_TASK_LIST_PAGE;
    }
    const { project } = access;

    const queryText = args.query?.trim();
    const results = await paginateTaskLists(ctx, {
      projectId: args.projectId,
      isArchived: args.archived ?? false,
      queryText: queryText || undefined,
      paginationOpts: args.paginationOpts,
    });

    return {
      ...results,
      page: results.page.map((list) =>
        toTaskListPublic(list, project.defaultListId)
      ),
    };
  },
});

export const getByRef = query({
  args: {
    projectId: v.id("projects"),
    ref: v.string(),
  },
  returns: v.union(taskListPublicValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const access = await authorizeProjectAccess(
      ctx,
      user._id,
      args.projectId,
      ProjectPermission.PROJECT_VIEW
    );
    if (!access) {
      return null;
    }

    const list = await findTaskListByRefForProject(
      ctx,
      args.projectId,
      args.ref
    );
    if (!list) {
      return null;
    }

    return toTaskListPublic(list, access.project.defaultListId);
  },
});

// Resolve a persisted List by raw ID or bare project-scoped ref for MCP/CLI
// callers. System Lists (Backlog) and scoped refs containing "/" resolve to
// null — management tools only target persisted Lists in the project.
export const resolve = query({
  args: {
    projectId: v.id("projects"),
    identifier: v.string(),
    apiKey: v.optional(v.string()),
  },
  returns: v.union(taskListPublicValidator, v.null()),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return null;
    }

    const access = await authorizeProjectAccess(
      ctx,
      auth.principal,
      args.projectId,
      ProjectPermission.PROJECT_VIEW
    );
    if (!access) {
      return null;
    }

    const resolved = await resolvePersistedProjectTaskList(ctx, {
      projectId: args.projectId,
      identifier: args.identifier,
      rejectScoped: true,
    });
    if (!resolved) {
      return null;
    }

    return toTaskListPublic(resolved.list, access.project.defaultListId);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    ref: v.optional(v.string()),
    color: v.optional(v.union(v.string(), v.null())),
    isPinned: v.optional(v.boolean()),
    // Optional per-List default view override; omitted means "inherit the
    // project default". `defaultBoardGroupBy` only applies to "board".
    defaultViewMode: v.optional(projectViewModeValidator),
    defaultBoardGroupBy: v.optional(boardGroupByValidator),
    defaultListGroupBy: v.optional(listGroupByValidator),
    defaultBoardRowGroupBy: v.optional(boardRowGroupByValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("taskLists"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(
      ctx,
      principal,
      args.projectId,
      ProjectPermission.LIST_MANAGE
    );

    assertDefaultViewGrouping(args);

    const name = validateTaskListName(args.name);
    const normalizedName = normalizeListName(name);
    const ref = validateOrSuggestTaskListRef(name, args.ref);
    await assertActiveTaskListLimit(ctx, args.projectId);
    await assertUniqueTaskListName(ctx, args.projectId, normalizedName);
    await assertUniqueTaskListRef(ctx, args.projectId, ref);

    const shouldPin = args.isPinned === true;
    if (shouldPin) {
      await requireAuthorizedProject(
        ctx,
        principal,
        args.projectId,
        ProjectPermission.LIST_PIN
      );
      await assertPinnedTaskListLimit(ctx, args.projectId);
    }

    const color =
      args.color === undefined || args.color === null
        ? undefined
        : validateTaskListColor(args.color);
    const pinnedAt = shouldPin ? Date.now() : undefined;
    const lastList = await getLastActiveTaskListByRank(ctx, args.projectId);
    const rank = appendRank(lastList?.rank);

    return insertTaskList(
      ctx,
      {
        projectId: args.projectId,
        name,
        ref,
        color,
        rank,
        ...(shouldPin
          ? { isPinned: true, pinnedAt, pinnedBy: user._id }
          : {}),
        ...(args.defaultViewMode === undefined
          ? {}
          : {
              defaultViewMode: args.defaultViewMode,
              ...(args.defaultViewMode === "list"
                ? { defaultListGroupBy: args.defaultListGroupBy ?? "none" }
                : {}),
              ...(args.defaultViewMode === "board" && args.defaultBoardGroupBy !== undefined
                ? { defaultBoardGroupBy: args.defaultBoardGroupBy }
                : {}),
              ...(args.defaultViewMode === "board" && args.defaultBoardRowGroupBy !== undefined
                ? { defaultBoardRowGroupBy: args.defaultBoardRowGroupBy }
                : {}),
            }),
      },
      user._id
    );
  },
});

export const update = mutation({
  args: {
    id: v.id("taskLists"),
    // Optional so partial updates (ref/color only) don't need to resend the
    // current name — omitting it keeps the stored name unchanged.
    name: v.optional(v.string()),
    ref: v.optional(v.string()),
    color: v.optional(v.union(v.string(), v.null())),
    isPinned: v.optional(v.boolean()),
    // Per-List default view override (OS-1566). `null` clears the override so
    // the List inherits the project default again — distinct from an explicit
    // "list", which stops inheriting a project-level Board default. Archived
    // Lists may carry an override; it simply survives unarchive.
    defaultViewMode: v.optional(v.union(projectViewModeValidator, v.null())),
    // Grouping arguments require their matching mode in the same call.
    defaultBoardGroupBy: v.optional(boardGroupByValidator),
    defaultListGroupBy: v.optional(listGroupByValidator),
    defaultBoardRowGroupBy: v.optional(boardRowGroupByValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const list = await requireTaskListExists(ctx, args.id);
    await requireAuthorizedProject(
      ctx,
      principal,
      list.projectId,
      ProjectPermission.LIST_MANAGE
    );

    assertDefaultViewGrouping(args);

    const name =
      args.name === undefined ? list.name : validateTaskListName(args.name);
    const normalizedName = normalizeListName(name);
    const ref = args.ref === undefined ? list.ref : validateTaskListRef(args.ref);
    await assertUniqueTaskListName(ctx, list.projectId, normalizedName, list._id);
    await assertUniqueTaskListRef(ctx, list.projectId, ref, list._id);

    const currentPinned = list.isPinned ?? false;
    const isPinChanging =
      args.isPinned !== undefined && args.isPinned !== currentPinned;
    if (isPinChanging) {
      await requireAuthorizedProject(
        ctx,
        principal,
        list.projectId,
        ProjectPermission.LIST_PIN
      );

      if (args.isPinned) {
        ensure(list.isArchived).isFalse(errors.LIST_ARCHIVED_CANNOT_BE_PINNED);
        await assertPinnedTaskListLimit(ctx, list.projectId);
      }
    }

    const patch = buildPatch<TaskListUpdatePatch>({
      name,
      normalizedName,
      ref,
      searchText: createTaskListSearchText(name, ref),
      color: clearable(args.color, validateTaskListColor),
      defaultViewMode: clearable(args.defaultViewMode),
      defaultListGroupBy: mapClearable(args.defaultViewMode, (mode) =>
        mode === "list" ? (args.defaultListGroupBy ?? "none") : null
      ),
      // Board keeps its grouping; List and inherit clear it.
      defaultBoardGroupBy: mapClearable(args.defaultViewMode, (mode) =>
        mode === "board" ? args.defaultBoardGroupBy : null
      ),
      defaultBoardRowGroupBy: mapClearable(args.defaultViewMode, (mode) =>
        mode === "board" ? args.defaultBoardRowGroupBy : null
      ),
      ...(isPinChanging && args.isPinned
        ? { isPinned: true, pinnedAt: Date.now(), pinnedBy: user._id }
        : {}),
    });
    if (isPinChanging && args.isPinned === false) {
      patch.isPinned = undefined;
      patch.pinnedAt = undefined;
      patch.pinnedBy = undefined;
    }

    await updateTaskList(ctx, list._id, patch, user._id);

    return null;
  },
});

export const reorder = mutation({
  args: {
    id: v.id("taskLists"),
    rank: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx);
    const list = await requireTaskListExists(ctx, args.id);
    await requireAuthorizedProject(
      ctx,
      principal,
      list.projectId,
      ProjectPermission.LIST_MANAGE
    );

    await updateTaskList(
      ctx,
      list._id,
      { rank: validateRank(args.rank, errors.LIST_RANK_INVALID) },
      user._id
    );

    return null;
  },
});

// Pinned Lists for every project the caller can view in the organization, in
// List rank order. Feeds the sidebar in a single subscription. Returns
// the full public List shape so the sidebar can reuse the List actions menu.
export const listPinnedForOrganization = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(
    v.object({
      projectId: v.id("projects"),
      lists: v.array(pinnedSidebarListValidator),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const orgMembership = await getOrgMembership(
      ctx,
      user._id,
      args.organizationId
    );
    if (!orgMembership) {
      return [];
    }

    const projects = await listUnarchivedProjectsByOrganization(
      ctx,
      args.organizationId
    );
    const accessibleProjects = await filterProjectsByAccess(
      ctx,
      user._id,
      orgMembership,
      projects,
      ProjectPermission.PROJECT_VIEW
    );

    const entries = await Promise.all(
      accessibleProjects.map(async (project) => {
        const pinnedLists = await listPinnedTaskListsByProject(ctx, project._id);

        // System Lists (Backlog) always render at the top of the group, in
        // their own chronological pin order; persisted pins follow the shared
        // List rank order. System pins live on the project doc.
        const systemEntries = (project.pinnedSystemLists ?? [])
          .slice()
          .sort((a, b) => a.pinnedAt - b.pinnedAt)
          .map((pin) => toSystemPinnedSidebarList(pin.key));
        const persistedEntries = pinnedLists.map((list) =>
          toPersistedPinnedSidebarList(list, project.defaultListId)
        );

        return {
          projectId: project._id,
          lists: [...systemEntries, ...persistedEntries],
        };
      })
    );

    return entries.filter((entry) => entry.lists.length > 0);
  },
});

export const setDefault = mutation({
  args: { id: v.id("taskLists") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const list = await requireTaskListExists(ctx, args.id);
    const { project } = await requireAuthorizedProject(
      ctx,
      user._id,
      list.projectId,
      ProjectPermission.LIST_MANAGE
    );

    ensure(list.isArchived).isFalse(errors.LIST_ARCHIVED_CANNOT_BE_DEFAULT);

    if (project.defaultListId === list._id) {
      return null;
    }

    await updateProject(ctx, list.projectId, { defaultListId: list._id });

    return null;
  },
});

export const pin = mutation({
  args: { id: v.id("taskLists") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const list = await requireTaskListExists(ctx, args.id);
    await requireAuthorizedProject(
      ctx,
      user._id,
      list.projectId,
      ProjectPermission.LIST_PIN
    );

    ensure(list.isArchived).isFalse(errors.LIST_ARCHIVED_CANNOT_BE_PINNED);

    if (list.isPinned) {
      // Idempotent: pinning an already pinned List is a no-op.
      return null;
    }

    await assertPinnedTaskListLimit(ctx, list.projectId);

    await updateTaskList(
      ctx,
      list._id,
      { isPinned: true, pinnedAt: Date.now(), pinnedBy: user._id },
      user._id
    );

    return null;
  },
});

export const unpin = mutation({
  args: { id: v.id("taskLists") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const list = await requireTaskListExists(ctx, args.id);
    await requireAuthorizedProject(
      ctx,
      user._id,
      list.projectId,
      ProjectPermission.LIST_PIN
    );

    if (!list.isPinned) {
      // Idempotent: unpinning a List that is not pinned is a no-op.
      return null;
    }

    await updateTaskList(
      ctx,
      list._id,
      { isPinned: undefined, pinnedAt: undefined, pinnedBy: undefined },
      user._id
    );

    return null;
  },
});

// System (virtual) Lists like Backlog have no `taskLists` row, so their pin
// state lives embedded on the project document. Identified by project + key
// rather than a List id; otherwise mirrors `pin`/`unpin` (LIST_PIN, idempotent,
// shared pin limit, chronological via pinnedAt).
export const pinSystemList = mutation({
  args: {
    projectId: v.id("projects"),
    key: systemTaskListKeyValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const { project } = await requireAuthorizedProject(
      ctx,
      user._id,
      args.projectId,
      ProjectPermission.LIST_PIN
    );

    const existing = project.pinnedSystemLists ?? [];
    if (existing.some((pin) => pin.key === args.key)) {
      // Idempotent: pinning an already pinned system List is a no-op.
      return null;
    }

    await assertPinnedTaskListLimit(ctx, args.projectId);

    await updateProject(ctx, args.projectId, {
      pinnedSystemLists: [
        ...existing,
        { key: args.key, pinnedAt: Date.now(), pinnedBy: user._id },
      ],
    });

    return null;
  },
});

export const unpinSystemList = mutation({
  args: {
    projectId: v.id("projects"),
    key: systemTaskListKeyValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const { project } = await requireAuthorizedProject(
      ctx,
      user._id,
      args.projectId,
      ProjectPermission.LIST_PIN
    );

    const existing = project.pinnedSystemLists ?? [];
    if (!existing.some((pin) => pin.key === args.key)) {
      // Idempotent: unpinning a system List that is not pinned is a no-op.
      return null;
    }

    await updateProject(ctx, args.projectId, {
      pinnedSystemLists: existing.filter((pin) => pin.key !== args.key),
    });

    return null;
  },
});

// Pinned system List keys for a single project. Drives the Backlog pin toggle
// in the header List picker; requires only project:view.
export const listPinnedSystemListKeys = query({
  args: { projectId: v.id("projects") },
  returns: v.array(systemTaskListKeyValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const access = await authorizeProjectAccess(
      ctx,
      user._id,
      args.projectId,
      ProjectPermission.PROJECT_VIEW
    );
    if (!access) {
      return [];
    }

    return (access.project.pinnedSystemLists ?? []).map(
      (pin): SystemTaskListKey => pin.key
    );
  },
});

export const archive = mutation({
  args: { id: v.id("taskLists") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const list = await requireTaskListExists(ctx, args.id);
    const { project } = await requireAuthorizedProject(
      ctx,
      user._id,
      list.projectId,
      ProjectPermission.LIST_MANAGE
    );

    assertNotDefaultList(project, list);
    await assertNotLastActiveList(ctx, list);

    if (list.isArchived) {
      // Idempotent: archiving an already archived List is a no-op.
      return null;
    }

    await updateTaskList(
      ctx,
      list._id,
      {
        isArchived: true,
        archivedAt: Date.now(),
        archivedBy: user._id,
        // Archiving removes the sidebar pin; unarchiving does not restore it.
        isPinned: undefined,
        pinnedAt: undefined,
        pinnedBy: undefined,
      },
      user._id
    );

    return null;
  },
});

export const unarchive = mutation({
  args: { id: v.id("taskLists") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const list = await requireTaskListExists(ctx, args.id);
    await requireAuthorizedProject(
      ctx,
      user._id,
      list.projectId,
      ProjectPermission.LIST_MANAGE
    );

    if (!list.isArchived) {
      // Idempotent: unarchiving an already active List is a no-op.
      return null;
    }

    await updateTaskList(
      ctx,
      list._id,
      { isArchived: false, archivedAt: undefined, archivedBy: undefined },
      user._id
    );

    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("taskLists") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const list = await requireTaskListExists(ctx, args.id);
    const { project } = await requireAuthorizedProject(
      ctx,
      user._id,
      list.projectId,
      ProjectPermission.LIST_MANAGE
    );

    assertNotDefaultList(project, list);
    await assertNotLastActiveList(ctx, list);

    await assertTaskListHasNoActiveTasks(ctx, list._id);
    for (const section of await listSectionsByList(ctx, project._id, createPersistedTaskListKey(list._id))) {
      await removeSection(ctx, section._id);
    }
    await deleteTaskList(ctx, list._id);

    return null;
  },
});
