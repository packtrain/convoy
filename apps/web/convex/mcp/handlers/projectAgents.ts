import { api } from "../../_generated/api";
import { AGENT_COLOR_PALETTE } from "@/lib/colors/palette";
import type { AgentAppearance, ProjectAgentAutomation } from "../../agents/lib/validators";
import { getSupportedCliTypes, isCliType } from "../../lib/contracts/validators";
import { should, throwInvalidParams } from "../lib/should";
import type { ToolHandler } from "./context";

function isAgentPaletteColor(color: string): boolean {
  return AGENT_COLOR_PALETTE.some((paletteColor) => paletteColor === color);
}

// MCP automation prompts are plain text only: slash-command refs can only be
// inserted through the web UI composer, and assignment automation itself only
// triggers for assignments made in the web UI.
function parseAgentAutomation(value: unknown, key: string): ProjectAgentAutomation {
  const record = should.beRecord(value, key);
  if (typeof record.enabled !== "boolean") {
    throwInvalidParams(`${key}.enabled is required and must be a boolean`);
  }
  const prompt = should.beOptionalString(record, "prompt");
  const cliType = should.beOptionalString(record, "cliType");
  if (cliType !== undefined && !isCliType(cliType)) {
    throwInvalidParams(`${key}.cliType must be one of: ${getSupportedCliTypes().join(", ")}`);
  }
  const cliModel = should.beOptionalString(record, "cliModel");
  const cliEffort = should.beOptionalString(record, "cliEffort");
  const mode = should.beOptionalString(record, "mode");
  const workspace = should.beOptionalString(record, "workspace");
  if (workspace !== undefined && workspace !== "local" && workspace !== "worktree") {
    throwInvalidParams(`${key}.workspace must be "local" or "worktree"`);
  }
  return {
    enabled: record.enabled,
    prompt: prompt === undefined ? undefined : { displayContent: prompt },
    cliType,
    cliModel,
    cliEffort,
    mode,
    workspace,
  };
}

function parseNullableAgentAutomation(
  args: Record<string, unknown>,
  key: string
): ProjectAgentAutomation | null | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return parseAgentAutomation(value, key);
}

function parseAgentAppearance(args: Record<string, unknown>, key: string): AgentAppearance {
  if (args[key] === undefined) {
    throwInvalidParams(`${key} is required and must be an object`);
  }
  const appearance = should.beRecord(args[key], key);
  const color = should.beString(appearance, "color");
  if (!isAgentPaletteColor(color)) {
    throwInvalidParams(`appearance.color must be one of: ${AGENT_COLOR_PALETTE.join(", ")}`);
  }
  return { color };
}

function parseOptionalAgentAppearance(
  args: Record<string, unknown>,
  key: string
): AgentAppearance | undefined {
  if (args[key] === undefined) {
    return undefined;
  }
  return parseAgentAppearance(args, key);
}

export const handleListProjectAgents: ToolHandler = async ({
  ctx,
  apiKey,
  getProjectId,
}) => {
  const projectId = await getProjectId();
  const agents = await ctx.runQuery(api.agents.projectAgents.listByProject, {
    projectId,
    apiKey,
  });

  return agents.map((agent) => ({
    projectAgentId: agent._id,
    name: agent.name,
    description: agent.description,
    prompt: agent.prompt,
    category: agent.category,
    appearance: agent.appearance,
    automation: agent.automation,
  }));
};

export const handleCreateProjectAgent: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const projectId = await getProjectId();
  const description = should.beOptionalString(args, "description");
  const prompt = should.beOptionalString(args, "prompt");
  const category = should.beOptionalString(args, "category");
  const automation = args.automation === undefined ? undefined : parseAgentAutomation(args.automation, "automation");
  const projectAgentId = await ctx.runMutation(api.agents.projectAgents.create, {
    projectId,
    name: should.beString(args, "name"),
    ...(description !== undefined && { description }),
    ...(prompt !== undefined && { prompt }),
    ...(category !== undefined && { category }),
    appearance: parseAgentAppearance(args, "appearance"),
    ...(automation !== undefined && { automation }),
    apiKey,
  });

  return { projectAgentId };
};

export const handleUpdateProjectAgent: ToolHandler = async ({
  ctx,
  apiKey,
  args,
}) => {
  const name = should.beOptionalString(args, "name");
  const description = should.beNullableString(args, "description");
  const prompt = should.beNullableString(args, "prompt");
  const category = should.beNullableString(args, "category");
  const appearance = parseOptionalAgentAppearance(args, "appearance");
  const automation = parseNullableAgentAutomation(args, "automation");

  return ctx.runMutation(api.agents.projectAgents.update, {
    projectAgentId: should.beId<"projectAgents">(args, "projectAgentId"),
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(prompt !== undefined && { prompt }),
    ...(category !== undefined && { category }),
    ...(appearance !== undefined && { appearance }),
    ...(automation !== undefined && { automation }),
    apiKey,
  });
};
