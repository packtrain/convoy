import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { OrgPermission, type ProjectPermission } from "../../../lib/authz/permissions";
import { OrgRole } from "../../../lib/authz/roles";
import { authorizeProjectAccess, hasOrgPermission, requireAuthorizedProject } from "../../lib/access/permissions";
import { getOrgMembership } from "../../lib/accessRepo";
import { ensure } from "../../lib/shared/ensure";
import { getActiveProjectById } from "./projectsRepo";
import { errors } from "../errors";

/**
 * The project permission, or org-level `PROJECTS_MANAGE_ALL` as an explicit
 * alternative. Null when denied. Spec: docs/specs/permissions-system.md
 */
export async function authorizeProjectAuthority(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
  permission: ProjectPermission
): Promise<Doc<"projects"> | null> {
  const project = await getActiveProjectById(ctx, projectId);
  if (!project) {
    return null;
  }

  if (await hasOrgPermission(ctx, userId, project.organizationId, OrgPermission.PROJECTS_MANAGE_ALL)) {
    return project;
  }

  const access = await authorizeProjectAccess(ctx, userId, project, permission);
  return access?.project ?? null;
}

/** Throwing counterpart of `authorizeProjectAuthority`, for mutations. */
export async function requireProjectAdministration(
  ctx: MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
  permission: ProjectPermission
): Promise<Doc<"projects">> {
  const project = await ensure(getActiveProjectById(ctx, projectId)).notNull(errors.PROJECT_NOT_FOUND);

  if (await hasOrgPermission(ctx, userId, project.organizationId, OrgPermission.PROJECTS_MANAGE_ALL)) {
    return project;
  }

  const { project: authorizedProject } = await requireAuthorizedProject(ctx, userId, project, permission);
  return authorizedProject;
}

/**
 * A project membership row for an org owner/admin becomes their authoritative
 * project role in OS-1536, so only org-level authority may write one.
 * Spec: docs/specs/permissions-system.md
 */
export async function requireAuthorityOverMember(
  ctx: MutationCtx,
  callerId: Id<"users">,
  project: Doc<"projects">,
  targetUserId: Id<"users">
): Promise<void> {
  const target = await getOrgMembership(ctx, targetUserId, project.organizationId);
  if (target?.role !== OrgRole.OWNER && target?.role !== OrgRole.ADMIN) {
    return;
  }

  ensure(await hasOrgPermission(ctx, callerId, project.organizationId, OrgPermission.PROJECTS_MANAGE_ALL)).isTrue(
    errors.TARGET_IS_ORG_LEADER
  );
}
