import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import {
  OrgPermission,
  PERMISSION_DENIED,
  ProjectPermission,
  hasOrgPermission as roleHasOrgPermission,
  hasProjectPermission,
} from "../../../lib/authz/permissions";
import type { OrgRole, ProjectRole } from "../../../lib/authz/roles";
import {
  getOrgMembership,
  getProjectById,
  getProjectMembership,
  listProjectMembershipsForUser,
} from "../accessRepo";
import { getActiveOrganizationById } from "../../organizations/lib/organizationsRepo";
import { ensure } from "../shared/ensure";

export type ProjectAccessTarget = Id<"projects"> | Doc<"projects">;

export type ApiKeyScope =
  | { kind: "unscoped" }
  | {
      kind: "organization";
      organizationId: Id<"organizations">;
      projectIds: Id<"projects">[];
    };

export function isBroadApiKeyScope(scope: ApiKeyScope | null): boolean {
  return !scope || scope.kind === "unscoped" || scope.projectIds.length === 0;
}

export type AuthenticatedAccess = {
  userId: Id<"users">;
  apiKeyScope: ApiKeyScope | null;
};

export type ProjectAccessPrincipal = Id<"users"> | AuthenticatedAccess;

export type AuthorizedProjectAccess = {
  project: Doc<"projects">;
  orgMembership: Doc<"organizationMembers">;
  projectMembership: Doc<"projectMembers"> | null;
};

type AccessOptions = {
  convexErrorMessage?: string;
};

type ProjectAccessDenialReason = "project-not-found" | "no-org-membership" | "no-project-membership" | "permission-denied";

type ProjectAccessDecision = { ok: true; access: AuthorizedProjectAccess } | { ok: false; reason: ProjectAccessDenialReason };

/**
 * Require organization permission. Throws if the user doesn't have the permission.
 * `convexErrorMessage` replaces the internal denial error with a user-facing one.
 */
export async function requireOrgPermission(
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">,
  organizationId: Id<"organizations">,
  permission: OrgPermission,
  options?: AccessOptions
): Promise<Doc<"organizationMembers">> {
  const membership = await getOrgMembership(ctx, userId, organizationId);

  if (!membership) {
    throw new Error("Not a member of this organization");
  }

  if (!roleHasOrgPermission(membership.role as OrgRole, permission)) {
    if (options?.convexErrorMessage) {
      throw new ConvexError(options.convexErrorMessage);
    }
    throw new Error(`${PERMISSION_DENIED}: ${permission}`);
  }

  return membership;
}

async function getProjectFromTarget(ctx: MutationCtx | QueryCtx, projectOrId: ProjectAccessTarget): Promise<Doc<"projects"> | null> {
  if (typeof projectOrId === "string") {
    return getProjectById(ctx, projectOrId);
  }

  return projectOrId;
}

/**
 * The user a principal resolves to. Exported for the few callers that need both
 * halves of a principal — the user id for an ownership comparison, and the whole
 * principal for the project check — without hand-destructuring the union at each
 * site (`cli/lib/permissions.getViewableThread`).
 */
export function getPrincipalUserId(principal: ProjectAccessPrincipal): Id<"users"> {
  return typeof principal === "string" ? principal : principal.userId;
}

function getPrincipalApiKeyScope(principal: ProjectAccessPrincipal): ApiKeyScope | null {
  return typeof principal === "string" ? null : principal.apiKeyScope;
}

export function apiKeyScopeAllowsProject(scope: ApiKeyScope | null, project: Doc<"projects">): boolean {
  if (!scope || scope.kind === "unscoped") {
    return true;
  }

  if (project.organizationId !== scope.organizationId) {
    return false;
  }

  if (scope.projectIds.length === 0) {
    return true;
  }

  return scope.projectIds.includes(project._id);
}

export function apiKeyScopeAllowsOrganization(scope: ApiKeyScope | null, organizationId: Id<"organizations">): boolean {
  if (!scope || scope.kind === "unscoped") {
    return true;
  }

  return scope.organizationId === organizationId;
}

/** How a domain of organization-wide records names its access failures. */
export type OrganizationRecordAccess = {
  managePermission: OrgPermission;
  errors: {
    organizationNotFound: string;
    organizationForbidden: string;
    projectScopedKey: string;
    membershipRequired: string;
  };
};

/**
 * Organization scope for a principal that may be an API key: `requireOrgPermission`
 * and `getOrgMembership` take a user ID only, so the key's organization scope has to
 * be checked here — otherwise a key scoped to one organization could reach another
 * organization's records through its owner's memberships.
 */
async function requireOrganizationScope(
  ctx: MutationCtx | QueryCtx,
  principal: AuthenticatedAccess,
  organizationId: Id<"organizations">,
  access: OrganizationRecordAccess
): Promise<void> {
  await ensure(getActiveOrganizationById(ctx, organizationId)).notNull(access.errors.organizationNotFound);

  const scope = principal.apiKeyScope;
  ensure(apiKeyScopeAllowsOrganization(scope, organizationId)).isTrue(access.errors.organizationForbidden);
  // A key narrowed to projects must not reach organization-wide records: they
  // surface in every project of the organization, so a key that can only reach
  // project A must not read or write them.
  ensure(isBroadApiKeyScope(scope)).isTrue(access.errors.projectScopedKey);
}

/** Read access to an organization's records, honouring API-key scope. */
export async function requireOrganizationMember(
  ctx: MutationCtx | QueryCtx,
  principal: AuthenticatedAccess,
  organizationId: Id<"organizations">,
  access: OrganizationRecordAccess
): Promise<void> {
  await requireOrganizationScope(ctx, principal, organizationId, access);
  await ensure(getOrgMembership(ctx, principal.userId, organizationId)).notNull(access.errors.membershipRequired);
}

/** Manage access to an organization's records, honouring API-key scope. */
export async function requireOrganizationManage(
  ctx: MutationCtx | QueryCtx,
  principal: AuthenticatedAccess,
  organizationId: Id<"organizations">,
  access: OrganizationRecordAccess
): Promise<void> {
  await requireOrganizationScope(ctx, principal, organizationId, access);
  await requireOrgPermission(ctx, principal.userId, organizationId, access.managePermission);
}

async function getProjectAccessDecision(
  ctx: MutationCtx | QueryCtx,
  principal: ProjectAccessPrincipal,
  projectOrId: ProjectAccessTarget,
  permission: ProjectPermission
): Promise<ProjectAccessDecision> {
  const project = await getProjectFromTarget(ctx, projectOrId);
  if (!project || project.isDeleted) {
    return { ok: false, reason: "project-not-found" };
  }

  if (!apiKeyScopeAllowsProject(getPrincipalApiKeyScope(principal), project)) {
    return { ok: false, reason: "permission-denied" };
  }

  const userId = getPrincipalUserId(principal);
  const orgMembership = await getOrgMembership(ctx, userId, project.organizationId);
  if (!orgMembership) {
    return { ok: false, reason: "no-org-membership" };
  }

  const projectMembership = await getProjectMembership(ctx, userId, project._id);
  const access = { project, orgMembership, projectMembership };

  if (hasAuthorizedProjectPermission(access, permission)) {
    return { ok: true, access };
  }

  if (!projectMembership) {
    return { ok: false, reason: "no-project-membership" };
  }

  return { ok: false, reason: "permission-denied" };
}

function projectAccessErrorMessage(reason: ProjectAccessDenialReason, permission: ProjectPermission): string {
  switch (reason) {
    case "project-not-found":
      return "Project not found";
    case "no-org-membership":
      return "Not a member of this organization";
    case "no-project-membership":
      return "Not a member of this project";
    case "permission-denied":
      return `${PERMISSION_DENIED}: ${permission}`;
  }
}

/**
 * Check if user has organization permission. Returns boolean (doesn't throw).
 * Use this in queries where the caller only needs predicate behavior.
 */
export async function hasOrgPermission(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  organizationId: Id<"organizations">,
  permission: OrgPermission
): Promise<boolean> {
  const membership = await getOrgMembership(ctx, userId, organizationId);
  if (!membership) {
    return false;
  }
  return roleHasOrgPermission(membership.role as OrgRole, permission);
}

/**
 * Check if user has project permission. Returns boolean (doesn't throw).
 * Use this in queries where the caller only needs predicate behavior.
 */
export async function hasProjectAccess(
  ctx: QueryCtx | MutationCtx,
  principal: ProjectAccessPrincipal,
  projectOrId: ProjectAccessTarget,
  permission: ProjectPermission
): Promise<boolean> {
  const decision = await getProjectAccessDecision(ctx, principal, projectOrId, permission);
  return decision.ok;
}

/**
 * Batch-resolve which of the given projects the principal can access with
 * `permission`. Missing, deleted, and denied projects are dropped (fail-soft).
 * Use for cross-project feeds that join items to their project.
 */
export async function getAccessibleProjectsById(
  ctx: QueryCtx | MutationCtx,
  principal: ProjectAccessPrincipal,
  projectIds: Id<"projects">[],
  permission: ProjectPermission
): Promise<Map<Id<"projects">, Doc<"projects">>> {
  const projects = await Promise.all(projectIds.map((projectId) => getProjectById(ctx, projectId)));
  const accessible = await Promise.all(
    projects.map(async (project) =>
      project && !project.isDeleted && (await hasProjectAccess(ctx, principal, project, permission))
        ? project
        : null
    )
  );
  return new Map(accessible.filter((project) => project !== null).map((project) => [project._id, project]));
}

/**
 * Check another permission from an existing authorized project access result.
 * This avoids re-reading project and membership documents for repeated checks.
 */
export function hasAuthorizedProjectPermission(access: AuthorizedProjectAccess, permission: ProjectPermission): boolean {
  if (!access.projectMembership) {
    return false;
  }

  return hasProjectPermission(access.projectMembership.role as ProjectRole, permission);
}

/**
 * Get an authorized project access result. Returns null if denied.
 * A `projectMembers` row is the sole grant — org role never substitutes for it
 * (OS-1536). Use this in queries where you want conditional behavior instead of
 * throwing, or when the caller needs the authorized project document.
 */
export async function authorizeProjectAccess(
  ctx: QueryCtx | MutationCtx,
  principal: ProjectAccessPrincipal,
  projectOrId: ProjectAccessTarget,
  permission: ProjectPermission
): Promise<AuthorizedProjectAccess | null> {
  const decision = await getProjectAccessDecision(ctx, principal, projectOrId, permission);
  return decision.ok ? decision.access : null;
}

/**
 * Require an authorized project access result. Throws if the user doesn't have
 * the permission. Use this in mutations where project-level authorization is
 * required, or when the caller needs the authorized project document.
 */
export async function requireAuthorizedProject(
  ctx: MutationCtx | QueryCtx,
  principal: ProjectAccessPrincipal,
  projectOrId: ProjectAccessTarget,
  permission: ProjectPermission,
  options?: AccessOptions
): Promise<AuthorizedProjectAccess> {
  const decision = await getProjectAccessDecision(ctx, principal, projectOrId, permission);

  if (decision.ok) {
    return decision.access;
  }

  if (options?.convexErrorMessage) {
    throw new ConvexError(options.convexErrorMessage);
  }

  const message = projectAccessErrorMessage(decision.reason, permission);
  // ConvexError survives production redaction, so the web UI can recognize it.
  if (decision.reason === "permission-denied") {
    throw new ConvexError(message);
  }
  throw new Error(message);
}

/**
 * Efficiently filter a list of projects by user access.
 * Use this when you already have org membership and a list of projects.
 * Much more efficient than authorizing each project separately.
 *
 * `orgMembership` is the caller's proof of org membership, already fetched; it
 * confers no project access of its own (OS-1536).
 *
 * @param ctx - Query or mutation context
 * @param userId - User to check access for
 * @param orgMembership - User's org membership (already fetched)
 * @param projects - List of projects to filter
 * @param permission - Permission to check
 * @returns Projects the user has access to, each with the caller's `myRole`
 */
export async function filterProjectsByAccess<T extends { _id: Id<"projects"> }>(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  orgMembership: Doc<"organizationMembers">,
  projects: T[],
  permission: ProjectPermission
): Promise<Array<T & { myRole: ProjectRole }>> {
  // One query for every membership the user holds
  const userProjectMemberships = await listProjectMembershipsForUser(
    ctx,
    userId
  );

  // Build a map of projectId -> role for quick lookup
  const projectRoleMap = new Map<string, ProjectRole>();
  for (const membership of userProjectMemberships) {
    projectRoleMap.set(membership.projectId, membership.role as ProjectRole);
  }

  // Filter projects to only those with access
  return projects.flatMap((project) => {
    const myRole = projectRoleMap.get(project._id);
    return myRole && hasProjectPermission(myRole, permission) ? [{ ...project, myRole }] : [];
  });
}
