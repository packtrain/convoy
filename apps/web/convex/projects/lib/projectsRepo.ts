import type { BoardRowGroupBy, ListGroupBy } from "../../lib/contracts/validators";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { BACKLOG_SYSTEM_LIST } from "@/lib/task-lists/system-lists";
import type { Status } from "../../../lib/tasks/status";
import type { TaskTableColumnId } from "../../../lib/tasks/task-table-columns";
import type { BoardGroupBy, ProjectViewMode } from "../../lib/contracts/validators";

type Ctx = QueryCtx | MutationCtx;

export function normalizeProjectId(ctx: Ctx, id: string): Id<"projects"> | null {
  return ctx.db.normalizeId("projects", id);
}

export async function getProjectById(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"projects"> | null> {
  return ctx.db.get("projects", projectId);
}

export async function getProjectsByIds(ctx: Ctx, projectIds: Id<"projects">[]): Promise<(Doc<"projects"> | null)[]> {
  return Promise.all(projectIds.map((projectId) => getProjectById(ctx, projectId)));
}

export async function getActiveProjectById(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"projects"> | null> {
  const project = await ctx.db.get("projects", projectId);
  if (!project || project.isDeleted) {
    return null;
  }
  return project;
}

export async function listActiveProjectsByOrganization(ctx: Ctx, organizationId: Id<"organizations">): Promise<Doc<"projects">[]> {
  return ctx.db
    .query("projects")
    .withIndex("by_organization_and_isDeleted", (q) => q.eq("organizationId", organizationId).eq("isDeleted", false))
    .collect();
}

/**
 * Find the active project for an alias (already normalized to uppercase).
 * Soft-deleted projects keep their alias row, so an alias can resolve to
 * several documents; index on isDeleted to read only the active one (avoids
 * `.unique()` throwing when a deleted homonym exists).
 */
export async function getActiveProjectByAlias(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  alias: string
): Promise<Doc<"projects"> | null> {
  return ctx.db
    .query("projects")
    .withIndex("by_organization_and_alias_and_isDeleted", (q) =>
      q.eq("organizationId", organizationId).eq("alias", alias).eq("isDeleted", false)
    )
    .first();
}

/** True when another active project (not `excludeProjectId`) holds the alias. */
export async function hasOtherActiveProjectWithAlias(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  alias: string,
  excludeProjectId: Id<"projects">
): Promise<boolean> {
  const activeAliasProjects = await ctx.db
    .query("projects")
    .withIndex("by_organization_and_alias_and_isDeleted", (q) =>
      q.eq("organizationId", organizationId).eq("alias", alias).eq("isDeleted", false)
    )
    .collect();

  return activeAliasProjects.some((candidate) => candidate._id !== excludeProjectId);
}

/**
 * Insert a project, stamping `disabledStatuses`, `isArchived`, `createdBy`,
 * `createdAt`, `updatedAt`, and `isDeleted`. Callers pass only the
 * user-supplied props. The task ref counter is no longer stamped here (OS-934):
 * it lives in `taskRefCounters` and is created lazily on first task creation.
 */
export async function insertProject(
  ctx: MutationCtx,
  props: {
    organizationId: Id<"organizations">;
    name: string;
    alias: string;
    description?: string;
    color?: string;
  },
  createdBy: Id<"users">
): Promise<Id<"projects">> {
  const now = Date.now();
  return ctx.db.insert("projects", {
    ...props,
    disabledStatuses: [],
    isArchived: false,
    createdBy,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  });
}

export type ProjectUpdatePatch = {
  name?: string;
  description?: string;
  // An explicitly `undefined` color clears the field (Convex removes fields
  // patched to `undefined`).
  color?: string;
  alias?: string;
  disabledStatuses?: Status[];
  hiddenTaskTableColumns?: TaskTableColumnId[];
  defaultViewMode?: ProjectViewMode;
  defaultBoardGroupBy?: BoardGroupBy;
  defaultListGroupBy?: ListGroupBy;
  defaultBoardRowGroupBy?: BoardRowGroupBy;
  // Task-row resource count indicator visibility; absent means shown.
  showArtifactsCount?: boolean;
  // Pull request check results go to the Git host; absent means on.
  publishPullRequestChecks?: boolean;
  // Sidebar pins for system Lists (Backlog etc.), which have no `taskLists` row.
  pinnedSystemLists?: NonNullable<Doc<"projects">["pinnedSystemLists"]>;
  // The project-wide default List pointer. Use `setProjectDefaultList` for the
  // creation path (no `updatedAt` stamp); use this when a user changes it.
  defaultListId?: Id<"taskLists">;
};

/** Patch project settings, stamping `updatedAt`. */
export async function updateProject(ctx: MutationCtx, projectId: Id<"projects">, patch: ProjectUpdatePatch): Promise<void> {
  await ctx.db.patch("projects", projectId, {
    ...patch,
    updatedAt: Date.now(),
  });
}

/**
 * Point a new project at its default list and pin Backlog to the sidebar. Intentionally
 * does not stamp `updatedAt` — this runs during project creation, not as a user edit.
 */
export async function initializeProjectLists(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  defaultListId: Id<"taskLists">,
  userId: Id<"users">
): Promise<void> {
  await ctx.db.patch("projects", projectId, {
    defaultListId,
    pinnedSystemLists: [{ key: BACKLOG_SYSTEM_LIST.key, pinnedAt: Date.now(), pinnedBy: userId }],
  });
}

export async function softDeleteProject(ctx: MutationCtx, projectId: Id<"projects">, deletedBy: Id<"users">): Promise<void> {
  await ctx.db.patch("projects", projectId, {
    isDeleted: true,
    deletedAt: Date.now(),
    deletedBy,
  });
}
