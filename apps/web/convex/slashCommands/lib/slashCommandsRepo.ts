import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export async function listActiveOrganizationSlashCommands(
  ctx: QueryCtx,
  organizationId: Id<"organizations">
): Promise<Doc<"slashCommands">[]> {
  return ctx.db
    .query("slashCommands")
    .withIndex("by_scope_and_organizationId_and_isDeleted", (q) =>
      q.eq("scope", "organization").eq("organizationId", organizationId).eq("isDeleted", false)
    )
    .collect();
}

export async function listActiveProjectSlashCommands(
  ctx: QueryCtx,
  projectId: Id<"projects">
): Promise<Doc<"slashCommands">[]> {
  return ctx.db
    .query("slashCommands")
    .withIndex("by_scope_and_projectId_and_isDeleted", (q) =>
      q.eq("scope", "project").eq("projectId", projectId).eq("isDeleted", false)
    )
    .collect();
}

export async function getSlashCommandById(ctx: Ctx, slashCommandId: Id<"slashCommands">): Promise<Doc<"slashCommands"> | null> {
  return ctx.db.get("slashCommands", slashCommandId);
}

export async function getActiveOrganizationSlashCommandByKey(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  key: string
): Promise<Doc<"slashCommands"> | null> {
  return ctx.db
    .query("slashCommands")
    .withIndex("by_scope_and_organizationId_and_isDeleted_and_key", (q) =>
      q.eq("scope", "organization").eq("organizationId", organizationId).eq("isDeleted", false).eq("key", key)
    )
    .unique();
}

export async function getActiveProjectSlashCommandByKey(
  ctx: Ctx,
  projectId: Id<"projects">,
  key: string
): Promise<Doc<"slashCommands"> | null> {
  return ctx.db
    .query("slashCommands")
    .withIndex("by_scope_and_projectId_and_isDeleted_and_key", (q) =>
      q.eq("scope", "project").eq("projectId", projectId).eq("isDeleted", false).eq("key", key)
    )
    .unique();
}

export async function insertOrganizationSlashCommand(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    key: string;
    description?: string;
    category?: string;
    content: string;
    autoExpand: boolean;
    autoSubmit: boolean;
  },
  userId: Id<"users">
): Promise<Id<"slashCommands">> {
  const now = Date.now();

  return ctx.db.insert("slashCommands", {
    scope: "organization",
    organizationId: args.organizationId,
    key: args.key,
    description: args.description,
    category: args.category,
    content: args.content,
    autoExpand: args.autoExpand,
    autoSubmit: args.autoSubmit,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  });
}

export async function insertProjectSlashCommand(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    projectId: Id<"projects">;
    key: string;
    description?: string;
    category?: string;
    content: string;
    autoExpand: boolean;
    autoSubmit: boolean;
  },
  userId: Id<"users">
): Promise<Id<"slashCommands">> {
  const now = Date.now();

  return ctx.db.insert("slashCommands", {
    scope: "project",
    organizationId: args.organizationId,
    projectId: args.projectId,
    key: args.key,
    description: args.description,
    category: args.category,
    content: args.content,
    autoExpand: args.autoExpand,
    autoSubmit: args.autoSubmit,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  });
}

export async function patchSlashCommand(
  ctx: MutationCtx,
  slashCommandId: Id<"slashCommands">,
  patch: Partial<Pick<Doc<"slashCommands">, "key" | "description" | "category" | "content" | "autoExpand" | "autoSubmit">>,
  userId: Id<"users">
): Promise<void> {
  await ctx.db.patch("slashCommands", slashCommandId, {
    ...patch,
    updatedBy: userId,
    updatedAt: Date.now(),
  });
}

export async function softDeleteSlashCommand(ctx: MutationCtx, slashCommandId: Id<"slashCommands">, userId: Id<"users">): Promise<void> {
  const now = Date.now();

  await ctx.db.patch("slashCommands", slashCommandId, {
    isDeleted: true,
    deletedAt: now,
    deletedBy: userId,
    updatedAt: now,
    updatedBy: userId,
  });
}
