import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import { ProjectPermission } from "../../../../lib/authz/permissions";
import { getOptionalAuthenticatedAccess } from "../../../lib/access/auth";
import { authorizeProjectAccess, type AuthorizedProjectAccess } from "../../../lib/access/permissions";
import { normalizeRepositoryId } from "./integrationRepositoriesRepo";
import { findRepositoryLinkForProjectAndRepository, listActiveRepositoryLinksForProject } from "./integrationRepositoryLinksRepo";

type Ctx = QueryCtx | MutationCtx;

/**
 * The caller's project access with `permission`, or null. Project membership
 * is the only grant: an organization role alone never reads integration data.
 */
export async function authorizeIntegrationProject(
  ctx: Ctx,
  projectId: Id<"projects">,
  permission: ProjectPermission,
  apiKey?: string
): Promise<(AuthorizedProjectAccess & { userId: Id<"users"> }) | null> {
  const auth = await getOptionalAuthenticatedAccess(ctx, apiKey);
  if (!auth) {
    return null;
  }
  const access = await authorizeProjectAccess(ctx, auth.principal, projectId, permission);
  return access ? { ...access, userId: auth.user._id } : null;
}

/** The project's active links when the caller may view the project, else null. */
export async function getReadableRepositoryLinks(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"integrationRepositoryLinks">[] | null> {
  const access = await authorizeIntegrationProject(ctx, projectId, ProjectPermission.PROJECT_VIEW);
  return access ? listActiveRepositoryLinksForProject(ctx, projectId) : null;
}

/**
 * The project's active link to `repositoryId` when the caller may view the
 * project. A stored repository or PR never authorizes on its own.
 */
export async function getReadableRepositoryLink(
  ctx: Ctx,
  projectId: Id<"projects">,
  /** From a URL, so any string; only the project's own link to it matches. */
  repositoryId: string
): Promise<Doc<"integrationRepositoryLinks"> | null> {
  return (await getReadableRepositoryAccess(ctx, projectId, repositoryId))?.link ?? null;
}

/** `getReadableRepositoryLink` with the caller's project access, for reads that also decide what the caller may change. */
export async function getReadableRepositoryAccess(
  ctx: Ctx,
  projectId: Id<"projects">,
  repositoryId: string
): Promise<{ access: AuthorizedProjectAccess & { userId: Id<"users"> }; link: Doc<"integrationRepositoryLinks"> } | null> {
  const access = await authorizeIntegrationProject(ctx, projectId, ProjectPermission.PROJECT_VIEW);
  const id = access ? normalizeRepositoryId(ctx, repositoryId) : null;
  const link = id ? await findRepositoryLinkForProjectAndRepository(ctx, projectId, id) : null;
  return access && link?.status === "active" ? { access, link } : null;
}
