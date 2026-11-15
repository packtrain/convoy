import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { should } from "../lib/should";
import type { ToolHandler } from "./context";

/**
 * Prompts are one entity with two scopes, so a single tool covers both. Project
 * scope is the default because MCP connections are configured per project.
 */
function parsePromptScope(args: Record<string, unknown>) {
  return should.beOptionalEnum(args, "scope", ["project", "organization"] as const) ?? "project";
}

function serializePrompt(prompt: Doc<"slashCommands">) {
  return {
    promptId: prompt._id,
    scope: prompt.scope,
    key: prompt.key,
    description: prompt.description,
    category: prompt.category,
    content: prompt.content,
    autoExpand: prompt.autoExpand,
    autoSubmit: prompt.autoSubmit ?? false,
  };
}

export const handleListPrompts: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
  getOrganizationId,
}) => {
  if (parsePromptScope(args) === "organization") {
    const prompts = await ctx.runQuery(api.slashCommands.core.listByOrganization, {
      organizationId: await getOrganizationId(),
      apiKey,
    });
    return prompts.map(serializePrompt);
  }

  const prompts = await ctx.runQuery(api.slashCommands.core.listByProject, {
    projectId: await getProjectId(),
    apiKey,
  });
  return prompts.map(serializePrompt);
};

export const handleCreatePrompt: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
  getOrganizationId,
}) => {
  // Scope first: it picks the branch, so a bad scope must not be masked by a
  // missing `key` on the way there.
  const scope = parsePromptScope(args);
  const description = should.beOptionalString(args, "description");
  const category = should.beOptionalString(args, "category");
  const autoExpand = should.beOptionalBoolean(args, "autoExpand");
  const autoSubmit = should.beOptionalBoolean(args, "autoSubmit");
  const shared = {
    key: should.beString(args, "key"),
    content: should.beString(args, "content"),
    ...(description !== undefined && { description }),
    ...(category !== undefined && { category }),
    ...(autoExpand !== undefined && { autoExpand }),
    ...(autoSubmit !== undefined && { autoSubmit }),
    apiKey,
  };

  if (scope === "organization") {
    const promptId = await ctx.runMutation(api.slashCommands.core.createInOrganization, {
      organizationId: await getOrganizationId(),
      ...shared,
    });
    return { promptId };
  }

  const promptId = await ctx.runMutation(api.slashCommands.core.createInProject, {
    projectId: await getProjectId(),
    ...shared,
  });
  return { promptId };
};

// No scope argument: the stored prompt already knows its scope, and
// `slashCommands.core.update` derives permissions from it.
export const handleUpdatePrompt: ToolHandler = async ({ ctx, apiKey, args }) => {
  const key = should.beOptionalString(args, "key");
  const content = should.beOptionalString(args, "content");
  const description = should.beNullableString(args, "description");
  const category = should.beNullableString(args, "category");
  const autoExpand = should.beOptionalBoolean(args, "autoExpand");
  const autoSubmit = should.beOptionalBoolean(args, "autoSubmit");

  return ctx.runMutation(api.slashCommands.core.update, {
    slashCommandId: should.beId<"slashCommands">(args, "promptId"),
    ...(key !== undefined && { key }),
    ...(content !== undefined && { content }),
    ...(description !== undefined && { description }),
    ...(category !== undefined && { category }),
    ...(autoExpand !== undefined && { autoExpand }),
    ...(autoSubmit !== undefined && { autoSubmit }),
    apiKey,
  });
};
