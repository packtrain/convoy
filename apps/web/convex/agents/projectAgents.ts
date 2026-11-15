import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ProjectPermission } from "../../lib/authz/permissions";
import {
  getAuthenticatedAccess,
  getAuthenticatedUser,
  getOptionalAuthenticatedAccess,
  getOptionalAuthenticatedUser,
} from "../lib/access/auth";
import { authorizeProjectAccess, requireAuthorizedProject } from "../lib/access/permissions";
import { buildPatch, changedFields, mapClearable, mapDefined } from "../lib/shared/patch";
import { ensure } from "../lib/shared/ensure";
import { duplicateAgentName, errors } from "./errors";
import {
  normalizeAgentAppearance,
  normalizeAgentName,
  normalizeAgentNameKey,
  normalizeOptionalAgentPrompt,
  normalizeOptionalAgentText,
  normalizeProjectAgentAutomation,
} from "./lib/normalize";
import { agentVersion, getAgentById } from "./lib/agentsRepo";
import {
  getActiveProjectAgentByNormalizedName,
  getProjectAgentById,
  insertProjectAgent,
  listActiveProjectAgentsByProject,
  patchProjectAgent,
  softDeleteProjectAgent,
  type ProjectAgentUpdatePatch,
} from "./lib/projectAgentsRepo";
import {
  agentAppearanceValidator,
  projectAgentAutomationValidator,
  projectAgentValidator,
  type ProjectAgent,
} from "./lib/validators";

type Ctx = QueryCtx | MutationCtx;

/** Fields a copy inherits from its source Agent template, so changing one makes it dirty (OS-1759). */
const TEMPLATE_OWNED_FIELDS = ["name", "description", "prompt", "category", "appearance"] as const satisfies readonly (keyof ProjectAgentUpdatePatch)[];

function isTemplateOwnedField(field: keyof ProjectAgentUpdatePatch): boolean {
  return (TEMPLATE_OWNED_FIELDS as readonly (keyof ProjectAgentUpdatePatch)[]).includes(field);
}

/**
 * Whether overwriting this copy could destroy project-local work (OS-1759).
 * A copy with no `installedVersion` predates versioning (or was never installed
 * from a template at all), so nothing is known about how it diverged — unknown
 * provenance counts as edited, because the guarantee is about not losing text.
 */
function mayHaveLocalEdits(projectAgent: Doc<"projectAgents">): boolean {
  return projectAgent.locallyEdited === true || projectAgent.installedVersion === undefined;
}

async function assertUniqueProjectAgentName(
  ctx: Ctx,
  projectId: Id<"projects">,
  normalizedName: string,
  currentProjectAgentId?: Id<"projectAgents">
) {
  const duplicate = await getActiveProjectAgentByNormalizedName(ctx, projectId, normalizedName);
  ensure(duplicate).satisfies(
    (projectAgent) => projectAgent === null || projectAgent._id === currentProjectAgentId,
    duplicate ? duplicateAgentName(duplicate.name) : errors.AGENT_NAME_DUPLICATE
  );
}

function assertAgentBelongsToProjectOrganization(agent: Doc<"agents">, project: Doc<"projects">) {
  ensure(agent.organizationId).eq(project.organizationId, errors.AGENT_PROJECT_MISMATCH);
}

function serializeProjectAgent(projectAgent: Doc<"projectAgents">): ProjectAgent {
  return {
    _id: projectAgent._id,
    _creationTime: projectAgent._creationTime,
    projectId: projectAgent.projectId,
    sourceAgentId: projectAgent.sourceAgentId,
    name: projectAgent.name,
    description: projectAgent.description,
    prompt: projectAgent.prompt,
    category: projectAgent.category,
    appearance: projectAgent.appearance,
    automation: projectAgent.automation,
    installedVersion: projectAgent.installedVersion,
    locallyEdited: projectAgent.locallyEdited,
    createdBy: projectAgent.createdBy,
    updatedBy: projectAgent.updatedBy,
    createdAt: projectAgent.createdAt,
    updatedAt: projectAgent.updatedAt,
    isDeleted: projectAgent.isDeleted,
    deletedAt: projectAgent.deletedAt,
    deletedBy: projectAgent.deletedBy,
  };
}

export const listByProject = query({
  args: { projectId: v.id("projects"), apiKey: v.optional(v.string()) },
  returns: v.array(projectAgentValidator),
  handler: async (ctx, args) => {
    const accessPrincipal = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!accessPrincipal) {
      return [];
    }

    const access = await authorizeProjectAccess(ctx, accessPrincipal.principal, args.projectId, ProjectPermission.PROJECT_VIEW);
    if (!access) {
      return [];
    }

    const projectAgents = await listActiveProjectAgentsByProject(ctx, args.projectId);
    return projectAgents.map(serializeProjectAgent);
  },
});

export const get = query({
  args: { projectAgentId: v.id("projectAgents") },
  returns: v.union(projectAgentValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const projectAgent = await getProjectAgentById(ctx, args.projectAgentId);
    if (!projectAgent || projectAgent.isDeleted) {
      return null;
    }

    const access = await authorizeProjectAccess(ctx, user._id, projectAgent.projectId, ProjectPermission.PROJECT_VIEW);
    if (!access) {
      return null;
    }

    return serializeProjectAgent(projectAgent);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
    category: v.optional(v.string()),
    appearance: agentAppearanceValidator,
    automation: v.optional(projectAgentAutomationValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("projectAgents"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.AGENTS_MANAGE);

    const name = normalizeAgentName(args.name);
    const normalizedName = normalizeAgentNameKey(name);
    await assertUniqueProjectAgentName(ctx, args.projectId, normalizedName);

    return insertProjectAgent(
      ctx,
      {
        projectId: args.projectId,
        name,
        normalizedName,
        description: normalizeOptionalAgentText(args.description),
        prompt: normalizeOptionalAgentPrompt(args.prompt),
        category: normalizeOptionalAgentText(args.category),
        appearance: normalizeAgentAppearance(args.appearance),
        automation: normalizeProjectAgentAutomation(args.automation),
      },
      user._id
    );
  },
});

export const copyFromAgent = mutation({
  args: {
    projectId: v.id("projects"),
    agentId: v.id("agents"),
    name: v.optional(v.string()),
  },
  returns: v.id("projectAgents"),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const { project } = await requireAuthorizedProject(ctx, user._id, args.projectId, ProjectPermission.AGENTS_MANAGE);
    const agent = await ensure(getAgentById(ctx, args.agentId)).notDeleted(errors.AGENT_NOT_FOUND);
    assertAgentBelongsToProjectOrganization(agent, project);
    const name = args.name === undefined ? agent.name : normalizeAgentName(args.name);
    const normalizedName = normalizeAgentNameKey(name);
    await assertUniqueProjectAgentName(ctx, args.projectId, normalizedName);

    return insertProjectAgent(
      ctx,
      {
        projectId: args.projectId,
        sourceAgentId: agent._id,
        name,
        normalizedName,
        description: agent.description,
        prompt: agent.prompt,
        category: agent.category,
        appearance: agent.appearance,
        installedVersion: agentVersion(agent),
        // Installing under a different name is already a local edit, so a later
        // refresh must not silently rename the copy back (OS-1759).
        locallyEdited: normalizedName === agent.normalizedName ? undefined : true,
      },
      user._id
    );
  },
});

export const copyFromProjectAgent = mutation({
  args: {
    projectId: v.id("projects"),
    sourceProjectAgentId: v.id("projectAgents"),
    name: v.optional(v.string()),
  },
  returns: v.id("projectAgents"),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    await requireAuthorizedProject(ctx, user._id, args.projectId, ProjectPermission.AGENTS_MANAGE);
    const source = await ensure(getProjectAgentById(ctx, args.sourceProjectAgentId)).notDeleted(errors.PROJECT_AGENT_NOT_FOUND);
    await requireAuthorizedProject(ctx, user._id, source.projectId, ProjectPermission.PROJECT_VIEW);

    const name = args.name === undefined ? source.name : normalizeAgentName(args.name);
    const normalizedName = normalizeAgentNameKey(name);
    await assertUniqueProjectAgentName(ctx, args.projectId, normalizedName);

    return insertProjectAgent(
      ctx,
      {
        projectId: args.projectId,
        name,
        normalizedName,
        description: source.description,
        prompt: source.prompt,
        category: source.category,
        appearance: source.appearance,
        automation: source.automation,
      },
      user._id
    );
  },
});

export const replaceFromAgent = mutation({
  args: {
    projectAgentId: v.id("projectAgents"),
    agentId: v.id("agents"),
    /** Set by the callers that already asked the user — see the spec's overwrite rule (OS-1759). */
    overwriteLocalEdits: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const projectAgent = await ensure(getProjectAgentById(ctx, args.projectAgentId)).notDeleted(errors.PROJECT_AGENT_NOT_FOUND);
    const { project } = await requireAuthorizedProject(ctx, user._id, projectAgent.projectId, ProjectPermission.AGENTS_MANAGE);
    const agent = await ensure(getAgentById(ctx, args.agentId)).notDeleted(errors.AGENT_NOT_FOUND);
    assertAgentBelongsToProjectOrganization(agent, project);
    // The guarantee lives here, not in the caller's snapshot: a copy edited after
    // the client last read it must not be overwritten without an explicit intent.
    ensure(args.overwriteLocalEdits === true || !mayHaveLocalEdits(projectAgent)).isTrue(errors.PROJECT_AGENT_HAS_LOCAL_EDITS);
    await assertUniqueProjectAgentName(ctx, projectAgent.projectId, agent.normalizedName, projectAgent._id);

    await patchProjectAgent(
      ctx,
      args.projectAgentId,
      {
        sourceAgentId: agent._id,
        name: agent.name,
        normalizedName: agent.normalizedName,
        description: agent.description,
        prompt: agent.prompt,
        category: agent.category,
        appearance: agent.appearance,
        installedVersion: agentVersion(agent),
        locallyEdited: undefined,
      },
      user._id
    );

    return null;
  },
});

export const update = mutation({
  args: {
    projectAgentId: v.id("projectAgents"),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    prompt: v.optional(v.union(v.string(), v.null())),
    category: v.optional(v.union(v.string(), v.null())),
    appearance: v.optional(agentAppearanceValidator),
    automation: v.optional(v.union(projectAgentAutomationValidator, v.null())),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const projectAgent = await ensure(getProjectAgentById(ctx, args.projectAgentId)).notDeleted(errors.PROJECT_AGENT_NOT_FOUND);
    await requireAuthorizedProject(ctx, principal, projectAgent.projectId, ProjectPermission.AGENTS_MANAGE);

    const name = args.name === undefined ? undefined : normalizeAgentName(args.name);
    const normalizedName = name === undefined ? undefined : normalizeAgentNameKey(name);
    if (normalizedName !== undefined && normalizedName !== projectAgent.normalizedName) {
      await assertUniqueProjectAgentName(ctx, projectAgent.projectId, normalizedName, args.projectAgentId);
    }

    const patch = buildPatch<ProjectAgentUpdatePatch>({
      name,
      normalizedName,
      description: mapClearable(args.description, normalizeOptionalAgentText),
      prompt: mapClearable(args.prompt, normalizeOptionalAgentPrompt),
      category: mapClearable(args.category, normalizeOptionalAgentText),
      appearance: mapDefined(args.appearance, normalizeAgentAppearance),
      automation: mapClearable(args.automation, normalizeProjectAgentAutomation),
    });

    // Changing a template-owned value makes the copy dirty, so refresh can warn
    // before overwriting it (OS-1759). The editor re-sends every field on every
    // save, so this compares values — `automation` is project-local either way.
    const changed = changedFields(patch, projectAgent);
    if (projectAgent.sourceAgentId && !projectAgent.locallyEdited && changed.some((field) => isTemplateOwnedField(field))) {
      patch.locallyEdited = true;
    }

    await patchProjectAgent(ctx, args.projectAgentId, patch, user._id);

    return null;
  },
});

export const deleteProjectAgent = mutation({
  args: { projectAgentId: v.id("projectAgents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const projectAgent = await ensure(getProjectAgentById(ctx, args.projectAgentId)).notDeleted(errors.PROJECT_AGENT_NOT_FOUND);
    await requireAuthorizedProject(ctx, user._id, projectAgent.projectId, ProjectPermission.AGENTS_MANAGE);

    await softDeleteProjectAgent(ctx, args.projectAgentId, user._id);

    return null;
  },
});
