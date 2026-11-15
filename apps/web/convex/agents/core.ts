import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { OrgPermission } from "../../lib/authz/permissions";
import { getAuthenticatedUser, getOptionalAuthenticatedUser } from "../lib/access/auth";
import { requireOrgPermission } from "../lib/access/permissions";
import { getOrgMembership } from "../lib/accessRepo";
import { buildPatch, mapClearable, mapDefined } from "../lib/shared/patch";
import { ensure } from "../lib/shared/ensure";
import { getActiveOrganizationById } from "../organizations/lib/organizationsRepo";
import { duplicateAgentName, errors } from "./errors";
import {
  normalizeAgentAppearance,
  normalizeAgentName,
  normalizeAgentNameKey,
  normalizeOptionalAgentPrompt,
  normalizeOptionalAgentText,
} from "./lib/normalize";
import {
  agentVersion,
  getActiveAgentByNormalizedName,
  getAgentById,
  insertAgent,
  listActiveAgentsByOrganization,
  patchAgentIfChanged,
  softDeleteAgent,
  type AgentUpdatePatch,
} from "./lib/agentsRepo";
import { agentAppearanceValidator, agentValidator, type Agent } from "./lib/validators";

type Ctx = QueryCtx | MutationCtx;

async function requireActiveOrganization(ctx: Ctx, organizationId: Id<"organizations">) {
  return ensure(getActiveOrganizationById(ctx, organizationId)).notNull(errors.ORGANIZATION_NOT_FOUND);
}

async function canReadOrganizationAgents(ctx: Ctx, userId: Id<"users">, organizationId: Id<"organizations">): Promise<boolean> {
  const organization = await getActiveOrganizationById(ctx, organizationId);
  if (!organization) {
    return false;
  }

  const membership = await getOrgMembership(ctx, userId, organizationId);
  return membership !== null;
}

async function assertUniqueAgentName(ctx: Ctx, organizationId: Id<"organizations">, normalizedName: string, currentAgentId?: Id<"agents">) {
  const duplicate = await getActiveAgentByNormalizedName(ctx, organizationId, normalizedName);
  ensure(duplicate).satisfies(
    (agent) => agent === null || agent._id === currentAgentId,
    duplicate ? duplicateAgentName(duplicate.name) : errors.AGENT_NAME_DUPLICATE
  );
}

function serializeAgent(agent: Doc<"agents">): Agent {
  return {
    _id: agent._id,
    _creationTime: agent._creationTime,
    organizationId: agent.organizationId,
    name: agent.name,
    description: agent.description,
    prompt: agent.prompt,
    category: agent.category,
    appearance: agent.appearance,
    version: agentVersion(agent),
    createdBy: agent.createdBy,
    updatedBy: agent.updatedBy,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    isDeleted: agent.isDeleted,
    deletedAt: agent.deletedAt,
    deletedBy: agent.deletedBy,
  };
}

export const listByOrganization = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(agentValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const canRead = await canReadOrganizationAgents(ctx, user._id, args.organizationId);
    if (!canRead) {
      return [];
    }

    const agents = await listActiveAgentsByOrganization(ctx, args.organizationId);
    return agents.map(serializeAgent);
  },
});

export const get = query({
  args: { agentId: v.id("agents") },
  returns: v.union(agentValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const agent = await getAgentById(ctx, args.agentId);
    if (!agent || agent.isDeleted) {
      return null;
    }

    const canRead = await canReadOrganizationAgents(ctx, user._id, agent.organizationId);
    if (!canRead) {
      return null;
    }

    return serializeAgent(agent);
  },
});

export const create = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
    category: v.optional(v.string()),
    appearance: agentAppearanceValidator,
  },
  returns: v.id("agents"),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    await requireActiveOrganization(ctx, args.organizationId);
    await requireOrgPermission(ctx, user._id, args.organizationId, OrgPermission.AGENTS_MANAGE);

    const name = normalizeAgentName(args.name);
    const normalizedName = normalizeAgentNameKey(name);
    await assertUniqueAgentName(ctx, args.organizationId, normalizedName);

    return insertAgent(
      ctx,
      {
        organizationId: args.organizationId,
        name,
        normalizedName,
        description: normalizeOptionalAgentText(args.description),
        prompt: normalizeOptionalAgentPrompt(args.prompt),
        category: normalizeOptionalAgentText(args.category),
        appearance: normalizeAgentAppearance(args.appearance),
      },
      user._id
    );
  },
});

export const update = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    prompt: v.optional(v.string()),
    category: v.optional(v.union(v.string(), v.null())),
    appearance: v.optional(agentAppearanceValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const agent = await ensure(getAgentById(ctx, args.agentId)).notDeleted(errors.AGENT_NOT_FOUND);
    await requireActiveOrganization(ctx, agent.organizationId);
    await requireOrgPermission(ctx, user._id, agent.organizationId, OrgPermission.AGENTS_MANAGE);

    const name = args.name === undefined ? undefined : normalizeAgentName(args.name);
    const normalizedName = name === undefined ? undefined : normalizeAgentNameKey(name);
    if (normalizedName !== undefined && normalizedName !== agent.normalizedName) {
      await assertUniqueAgentName(ctx, agent.organizationId, normalizedName, args.agentId);
    }

    const patch = buildPatch<AgentUpdatePatch>({
      name,
      normalizedName,
      description: mapClearable(args.description, normalizeOptionalAgentText),
      prompt: mapClearable(args.prompt, normalizeOptionalAgentPrompt),
      category: mapClearable(args.category, normalizeOptionalAgentText),
      appearance: mapDefined(args.appearance, normalizeAgentAppearance),
    });

    await patchAgentIfChanged(ctx, agent, patch, user._id);

    return null;
  },
});

export const deleteAgent = mutation({
  args: { agentId: v.id("agents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const agent = await ensure(getAgentById(ctx, args.agentId)).notDeleted(errors.AGENT_NOT_FOUND);
    await requireActiveOrganization(ctx, agent.organizationId);
    await requireOrgPermission(ctx, user._id, agent.organizationId, OrgPermission.AGENTS_MANAGE);

    await softDeleteAgent(ctx, args.agentId, user._id);

    return null;
  },
});
