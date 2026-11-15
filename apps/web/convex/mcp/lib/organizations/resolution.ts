import type { ActionCtx } from "../../../_generated/server";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { InvalidParamsError, should, throwInvalidParams } from "../should";

/**
 * Resolution of the organization an organization-scoped tool call targets. MCP
 * API keys are only organization-scoped when the key carries a scope, so the
 * organization is derived from the call instead: an explicit `organization`
 * argument, otherwise the organization owning the resolved project.
 */

/**
 * Slug or raw ID: `list_projects` exposes `organizationId` while
 * `?project=org-slug/ALIAS` configuration exposes the slug, so both forms reach
 * tool callers, and the two are indistinguishable by shape. `getByRef` tries
 * both against the key's scope so an unresolvable ref fails here with its own
 * name in the message instead of downstream as a validator error.
 */
async function resolveOrganizationRef(
  ctx: ActionCtx,
  ref: string,
  apiKey: string
): Promise<Id<"organizations">> {
  const organization = await ctx.runQuery(api.organizations.core.getByRef, { ref, apiKey });
  if (!organization) {
    throwInvalidParams(`Organization '${ref}' not found or outside API key scope`);
  }

  return organization._id;
}

/**
 * Cached per-request organization resolver for tool handlers: an explicit
 * `organization` tool argument wins, then the resolved project's organization.
 */
export function createOrganizationIdGetter(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  getProjectId: () => Promise<Id<"projects">>,
  apiKey: string
): () => Promise<Id<"organizations">> {
  let cachedOrganizationId: Id<"organizations"> | undefined;
  return async () => {
    if (cachedOrganizationId) {
      return cachedOrganizationId;
    }

    const explicit = should.beOptionalString(args, "organization");
    if (explicit) {
      cachedOrganizationId = await resolveOrganizationRef(ctx, explicit, apiKey);
      return cachedOrganizationId;
    }

    // The organization is only being derived from a project here, so a missing
    // project must still mention the argument that would have answered the
    // call directly.
    let projectId: Id<"projects">;
    try {
      projectId = await getProjectId();
    } catch (error) {
      if (error instanceof InvalidParamsError) {
        throwInvalidParams(`${error.message}, or pass organization to name the organization directly`);
      }
      throw error;
    }

    const project = await ctx.runQuery(api.projects.core.getById, { id: projectId, apiKey });
    if (!project) {
      throwInvalidParams("Project not found or outside API key scope");
    }

    cachedOrganizationId = project.organizationId;
    return cachedOrganizationId;
  };
}
