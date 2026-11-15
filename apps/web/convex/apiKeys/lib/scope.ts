import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { ProjectPermission } from "../../../lib/authz/permissions";
import {
  authorizeProjectAccess,
  hasProjectAccess,
  type ApiKeyScope,
} from "../../lib/access/permissions";
import { getOrgMembership } from "../../lib/accessRepo";
import { ensure } from "../../lib/shared/ensure";
import { getOrganizationById } from "../../organizations/lib/organizationsRepo";
import { getProjectsByIds } from "../../projects/lib/projectsRepo";
import type { StoredApiKeyScope } from "./apiKeysRepo";
import { errors } from "../errors";

export type ApiKeyScopeInput = null | {
  organizationId: Id<"organizations">;
  projectIds: Id<"projects">[];
};

/**
 * Validate a requested scope: the org must be active, the caller a member,
 * and every project an active, viewable member of that org.
 */
export async function validateScopeInput(
  ctx: MutationCtx,
  userId: Id<"users">,
  scope: ApiKeyScopeInput | undefined
): Promise<StoredApiKeyScope> {
  if (scope === undefined || scope === null) {
    return undefined;
  }

  await ensure(getOrganizationById(ctx, scope.organizationId)).notDeleted(errors.ORG_NOT_FOUND);
  await ensure(getOrgMembership(ctx, userId, scope.organizationId)).notNull(errors.NOT_ORG_MEMBER);

  const projectIds = [...new Set(scope.projectIds)];
  const projects = await getProjectsByIds(ctx, projectIds);

  for (const projectDoc of projects) {
    const project = await ensure(projectDoc).notDeleted(errors.PROJECT_NOT_FOUND);
    ensure(project.organizationId).eq(scope.organizationId, errors.PROJECT_ORG_MISMATCH);

    // Scope visibility mirrors view access; absence is reported as not-found.
    await ensure(authorizeProjectAccess(ctx, userId, project, ProjectPermission.PROJECT_VIEW)).notNull(
      errors.PROJECT_NOT_FOUND
    );
  }

  return {
    kind: "organization",
    organizationId: scope.organizationId,
    projectIds,
  };
}

/** Resolve a stored scope into display data, counting projects the caller can no longer see. */
export async function formatScopeForList(ctx: MutationCtx | QueryCtx, userId: Id<"users">, scope: ApiKeyScope) {
  if (scope.kind === "unscoped") {
    return { kind: "unscoped" as const };
  }

  const org = await getOrganizationById(ctx, scope.organizationId);
  const projectDocs = await getProjectsByIds(ctx, scope.projectIds);
  const projects: Array<{
    _id: Doc<"projects">["_id"];
    name: string;
    alias: string;
  }> = [];
  let unavailableProjectCount = 0;

  for (const project of projectDocs) {
    if (!project || project.isDeleted || project.organizationId !== scope.organizationId) {
      unavailableProjectCount += 1;
      continue;
    }

    const hasAccess = await hasProjectAccess(ctx, userId, project, ProjectPermission.PROJECT_VIEW);
    if (!hasAccess) {
      unavailableProjectCount += 1;
      continue;
    }

    projects.push({
      _id: project._id,
      name: project.name,
      alias: project.alias,
    });
  }

  return {
    kind: "organization" as const,
    organizationId: scope.organizationId,
    organizationName: org && !org.isDeleted ? org.name : "Unavailable organization",
    projectIds: scope.projectIds,
    projects,
    unavailableProjectCount,
  };
}
