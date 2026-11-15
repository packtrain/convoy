import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { OrgPermission, ProjectPermission } from "../../lib/authz/permissions";
import { getAuthenticatedAccess } from "../lib/access/auth";
import {
  authorizeProjectAccess,
  requireAuthorizedProject,
  requireOrganizationManage,
  requireOrganizationMember,
  type AuthenticatedAccess,
  type OrganizationRecordAccess,
} from "../lib/access/permissions";
import { ensure } from "../lib/shared/ensure";
import { buildPatch, mapClearable, mapDefined } from "../lib/shared/patch";
import { errors } from "./errors";
import {
  normalizeSlashCommandCategory,
  normalizeSlashCommandContent,
  normalizeSlashCommandDescription,
  normalizeSlashCommandKey,
} from "./lib/normalize";
import {
  getActiveOrganizationSlashCommandByKey,
  getActiveProjectSlashCommandByKey,
  getSlashCommandById,
  insertOrganizationSlashCommand,
  insertProjectSlashCommand,
  listActiveOrganizationSlashCommands,
  listActiveProjectSlashCommands,
  patchSlashCommand,
  softDeleteSlashCommand,
} from "./lib/slashCommandsRepo";
import { slashCommandComposerCatalogItemValidator, slashCommandValidator } from "./lib/validators";
import { buildSlashCommandCanonicalKey, buildSlashCommandDisplayLabel } from "../lib/slashCommands/composer";

type Ctx = QueryCtx | MutationCtx;
type SlashCommandPatch = Parameters<typeof patchSlashCommand>[2];

const organizationAccess: OrganizationRecordAccess = {
  managePermission: OrgPermission.SLASH_COMMANDS_MANAGE,
  errors: {
    organizationNotFound: errors.SLASH_COMMAND_ORGANIZATION_NOT_FOUND,
    organizationForbidden: errors.SLASH_COMMAND_ORGANIZATION_FORBIDDEN,
    projectScopedKey: errors.SLASH_COMMAND_ORGANIZATION_PROJECT_SCOPED,
    membershipRequired: errors.SLASH_COMMAND_ORGANIZATION_MEMBERSHIP_REQUIRED,
  },
};

function toComposerCatalogItem(command: Awaited<ReturnType<typeof listActiveOrganizationSlashCommands>>[number]) {
  return {
    id: command._id,
    scope: command.scope,
    key: command.key,
    canonicalKey: buildSlashCommandCanonicalKey(command),
    displayLabel: buildSlashCommandDisplayLabel(command),
    ...(command.description !== undefined ? { description: command.description } : {}),
    content: command.content,
    autoExpand: command.autoExpand,
    autoSubmit: command.autoSubmit ?? false,
  };
}

async function requireSlashCommandManagePermission(
  ctx: Ctx,
  principal: AuthenticatedAccess,
  slashCommand: Doc<"slashCommands">
) {
  if (slashCommand.scope === "project") {
    const projectId = await ensure(slashCommand.projectId).notNull(errors.SLASH_COMMAND_NOT_FOUND);
    await requireAuthorizedProject(ctx, principal, projectId, ProjectPermission.SLASH_COMMANDS_MANAGE);
    return;
  }

  await requireOrganizationManage(ctx, principal, slashCommand.organizationId, organizationAccess);
}

export const listByOrganization = query({
  args: {
    organizationId: v.id("organizations"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(slashCommandValidator),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireOrganizationMember(ctx, principal, args.organizationId, organizationAccess);

    return listActiveOrganizationSlashCommands(ctx, args.organizationId);
  },
});

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(slashCommandValidator),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_VIEW);

    return listActiveProjectSlashCommands(ctx, args.projectId);
  },
});

export const listComposerCatalog = query({
  args: {
    organizationId: v.id("organizations"),
    projectId: v.optional(v.id("projects")),
  },
  returns: v.array(slashCommandComposerCatalogItemValidator),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx);
    await requireOrganizationMember(ctx, principal, args.organizationId, organizationAccess);

    if (!args.projectId) {
      const commands = await listActiveOrganizationSlashCommands(ctx, args.organizationId);
      return commands.map(toComposerCatalogItem);
    }

    const access = await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_VIEW);
    ensure(access.project.organizationId).eq(args.organizationId, errors.SLASH_COMMAND_ORGANIZATION_NOT_FOUND);
    const [projectCommands, organizationCommands] = await Promise.all([
      listActiveProjectSlashCommands(ctx, args.projectId),
      listActiveOrganizationSlashCommands(ctx, args.organizationId),
    ]);

    return [...projectCommands, ...organizationCommands].map(toComposerCatalogItem);
  },
});

export const get = query({
  args: { slashCommandId: v.id("slashCommands") },
  returns: v.union(slashCommandValidator, v.null()),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx);
    const slashCommand = await getSlashCommandById(ctx, args.slashCommandId);
    if (!slashCommand || slashCommand.isDeleted) {
      return null;
    }

    // A project Prompt out of the caller's reach reads as missing, so a stale URL
    // lands on the not-found card instead of the route error boundary.
    if (slashCommand.scope === "project") {
      if (!slashCommand.projectId) {
        return null;
      }
      const access = await authorizeProjectAccess(ctx, principal, slashCommand.projectId, ProjectPermission.PROJECT_VIEW);
      if (!access) {
        return null;
      }
    } else {
      await requireOrganizationMember(ctx, principal, slashCommand.organizationId, organizationAccess);
    }

    return slashCommand;
  },
});

export const createInOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
    key: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    content: v.string(),
    autoExpand: v.optional(v.boolean()),
    autoSubmit: v.optional(v.boolean()),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("slashCommands"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireOrganizationManage(ctx, principal, args.organizationId, organizationAccess);

    const key = normalizeSlashCommandKey(args.key);
    const description = normalizeSlashCommandDescription(args.description);
    const category = normalizeSlashCommandCategory(args.category);
    const content = normalizeSlashCommandContent(args.content);

    const duplicate = await getActiveOrganizationSlashCommandByKey(ctx, args.organizationId, key);
    await ensure(duplicate).isNullOrDeleted(errors.SLASH_COMMAND_KEY_DUPLICATE);

    return insertOrganizationSlashCommand(
      ctx,
      {
        organizationId: args.organizationId,
        key,
        description,
        category,
        content,
        autoExpand: args.autoExpand ?? false,
        autoSubmit: args.autoSubmit ?? false,
      },
      user._id
    );
  },
});

export const createInProject = mutation({
  args: {
    projectId: v.id("projects"),
    key: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    content: v.string(),
    autoExpand: v.optional(v.boolean()),
    autoSubmit: v.optional(v.boolean()),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("slashCommands"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const access = await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.SLASH_COMMANDS_MANAGE);
    const key = normalizeSlashCommandKey(args.key);
    const duplicate = await getActiveProjectSlashCommandByKey(ctx, args.projectId, key);
    await ensure(duplicate).isNullOrDeleted(errors.SLASH_COMMAND_KEY_DUPLICATE);

    return insertProjectSlashCommand(
      ctx,
      {
        organizationId: access.project.organizationId,
        projectId: args.projectId,
        key,
        description: normalizeSlashCommandDescription(args.description),
        category: normalizeSlashCommandCategory(args.category),
        content: normalizeSlashCommandContent(args.content),
        autoExpand: args.autoExpand ?? false,
        autoSubmit: args.autoSubmit ?? false,
      },
      user._id
    );
  },
});

export const update = mutation({
  args: {
    slashCommandId: v.id("slashCommands"),
    key: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    category: v.optional(v.union(v.string(), v.null())),
    content: v.optional(v.string()),
    autoExpand: v.optional(v.boolean()),
    autoSubmit: v.optional(v.boolean()),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const slashCommand = await ensure(getSlashCommandById(ctx, args.slashCommandId)).notDeleted(errors.SLASH_COMMAND_NOT_FOUND);
    await requireSlashCommandManagePermission(ctx, principal, slashCommand);

    const key = args.key === undefined ? undefined : normalizeSlashCommandKey(args.key);

    if (key !== undefined) {
      if (key !== slashCommand.key) {
        const duplicate =
          slashCommand.scope === "project"
            ? await getActiveProjectSlashCommandByKey(
                ctx,
                await ensure(slashCommand.projectId).notNull(errors.SLASH_COMMAND_NOT_FOUND),
                key
              )
            : await getActiveOrganizationSlashCommandByKey(ctx, slashCommand.organizationId, key);
        ensure(duplicate === null || duplicate._id === args.slashCommandId).isTrue(errors.SLASH_COMMAND_KEY_DUPLICATE);
      }
    }

    const patch = buildPatch<SlashCommandPatch>({
      key,
      description: mapClearable(args.description, normalizeSlashCommandDescription),
      category: mapClearable(args.category, normalizeSlashCommandCategory),
      content: mapDefined(args.content, normalizeSlashCommandContent),
      autoExpand: args.autoExpand,
      autoSubmit: args.autoSubmit,
    });

    await patchSlashCommand(ctx, args.slashCommandId, patch, user._id);

    return null;
  },
});

export const deleteSlashCommand = mutation({
  args: { slashCommandId: v.id("slashCommands") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx);
    const slashCommand = await ensure(getSlashCommandById(ctx, args.slashCommandId)).notDeleted(errors.SLASH_COMMAND_NOT_FOUND);
    await requireSlashCommandManagePermission(ctx, principal, slashCommand);

    await softDeleteSlashCommand(ctx, args.slashCommandId, user._id);

    return null;
  },
});
