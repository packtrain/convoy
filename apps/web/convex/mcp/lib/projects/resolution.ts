import type { ActionCtx } from "../../../_generated/server";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
// Validator-first typing: inside convex modules, shapes come from domain
// validators (FunctionReturnType over the generated api is circular here).
import type { Project } from "../../../projects/lib/validators";
import { should, throwInvalidParams } from "../should";
import type { Status } from "@/lib/tasks/status";
import { getAllowedTaskStatuses, getDisabledTaskStatuses } from "@/lib/tasks/status-policy";

/**
 * Resolution of the MCP `?project=` parameter, which is either a Convex
 * document ID or an `org-slug/ALIAS` compound identifier. Both forms resolve
 * to the project document within the API key's scope, throwing JSON-RPC
 * invalid-params errors when they don't.
 */



export type ProjectStatusContext = {
  projectId: Id<"projects">;
  allowedTaskStatuses: Status[];
  disabledTaskStatuses: Status[];
};

type ParsedProjectParam = { kind: "id"; id: string } | { kind: "scopedAlias"; orgSlug: string; alias: string };

function parseProjectParam(param: string): ParsedProjectParam {
  if (!param.includes("/")) {
    return { kind: "id", id: param };
  }

  const slashIndex = param.indexOf("/");
  const orgSlug = param.substring(0, slashIndex);
  const alias = param.substring(slashIndex + 1);
  if (!orgSlug || !alias) {
    throwInvalidParams("Invalid project format: expected 'org-slug/ALIAS' (e.g., 'acme/WEB')");
  }

  return { kind: "scopedAlias", orgSlug, alias };
}

async function resolveScopedAlias(
  ctx: ActionCtx,
  parsed: { orgSlug: string; alias: string },
  apiKey: string
): Promise<Project> {
  const org = await ctx.runQuery(api.organizations.core.getBySlug, { slug: parsed.orgSlug, apiKey });
  if (!org) {
    throwInvalidParams(`Organization '${parsed.orgSlug}' not found`);
  }

  const project = await ctx.runQuery(api.projects.core.getByAlias, {
    organizationId: org._id,
    alias: parsed.alias,
    apiKey,
  });
  if (!project) {
    throwInvalidParams(`Project '${parsed.alias}' not found in organization '${parsed.orgSlug}' or outside API key scope`);
  }

  return project;
}

/** The `org-slug/ALIAS` parts of a `?project=` param; null for the raw-ID form. */
export function parseScopedAliasParam(param: string): { orgSlug: string; alias: string } | null {
  const parsed = parseProjectParam(param);
  return parsed.kind === "scopedAlias" ? parsed : null;
}

/**
 * Resolve a `?project=` param to a project ID without a lookup for the raw-ID
 * form: tool queries scope-check the ID themselves, and validating here would
 * cost one extra query on every scoped tool call. The `org-slug/ALIAS` form
 * needs lookups either way.
 */
async function resolveProjectIdFromParam(ctx: ActionCtx, param: string, apiKey: string): Promise<Id<"projects">> {
  const parsed = parseProjectParam(param);
  if (parsed.kind === "id") {
    return parsed.id as Id<"projects">;
  }
  return (await resolveScopedAlias(ctx, parsed, apiKey))._id;
}

/**
 * Resolve the default project's status policy for `initialize`/`tools/list`
 * responses. Returns null when no default project is configured.
 */
export async function resolveDefaultProjectStatusContext(
  ctx: ActionCtx,
  defaultProjectParam: string | undefined,
  apiKey: string
): Promise<ProjectStatusContext | null> {
  if (!defaultProjectParam) {
    return null;
  }

  const parsed = parseProjectParam(defaultProjectParam);
  let project: Project;
  if (parsed.kind === "id") {
    const found = await ctx.runQuery(api.projects.core.getById, { id: parsed.id, apiKey });
    if (!found) {
      throwInvalidParams("Default project not found or outside API key scope");
    }
    project = found;
  } else {
    project = await resolveScopedAlias(ctx, parsed, apiKey);
  }

  return {
    projectId: project._id,
    allowedTaskStatuses: getAllowedTaskStatuses(project),
    disabledTaskStatuses: getDisabledTaskStatuses(project),
  };
}

/**
 * Cached per-request project resolver for tool handlers: an explicit
 * `projectId` tool argument wins, then the URL default, then invalid-params.
 */
export function createProjectIdGetter(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  defaultProjectParam: string | undefined,
  apiKey: string
): () => Promise<Id<"projects">> {
  let cachedProjectId: Id<"projects"> | undefined;
  return async () => {
    if (cachedProjectId) {
      return cachedProjectId;
    }

    const explicit = should.beOptionalId<"projects">(args, "projectId");
    if (explicit) {
      cachedProjectId = explicit;
    } else if (defaultProjectParam) {
      cachedProjectId = await resolveProjectIdFromParam(ctx, defaultProjectParam, apiKey);
    } else {
      throwInvalidParams("projectId is required (provide it in tool arguments or via ?project= URL parameter)");
    }

    return cachedProjectId;
  };
}
