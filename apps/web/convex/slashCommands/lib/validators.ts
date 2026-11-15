import { v, type Infer } from "convex/values";

export const slashCommandScopeValidator = v.union(v.literal("organization"), v.literal("project"));

export const slashCommandValidator = v.object({
  _id: v.id("slashCommands"),
  _creationTime: v.number(),
  scope: slashCommandScopeValidator,
  organizationId: v.id("organizations"),
  projectId: v.optional(v.id("projects")),
  userId: v.optional(v.id("users")),
  title: v.optional(v.string()),
  key: v.string(),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  content: v.string(),
  autoExpand: v.boolean(),
  autoSubmit: v.optional(v.boolean()),
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  isDeleted: v.boolean(),
  deletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id("users")),
});

export const slashCommandSummaryValidator = slashCommandValidator;

export const slashCommandComposerCatalogItemValidator = v.object({
  id: v.id("slashCommands"),
  scope: slashCommandScopeValidator,
  key: v.string(),
  canonicalKey: v.string(),
  displayLabel: v.string(),
  description: v.optional(v.string()),
  content: v.string(),
  autoExpand: v.boolean(),
  autoSubmit: v.boolean(),
});

export type SlashCommand = Infer<typeof slashCommandValidator>;
