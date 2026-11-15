import type { FunctionArgs } from "convex/server";
import { api } from "../../convex/_generated/api.js";
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { validateNoConflict } from "../tasks/parsers.js";

const SUPPORTED_CLI_TYPES = [
  "claude-code",
  "codex",
  "amp",
  "opencode",
  "droid",
  "cursor",
  "gemini",
  "coderabbit",
  "github-copilot",
  "other",
] as const;

type CreateProjectAgentArgs = Omit<FunctionArgs<typeof api.agents.projectAgents.create>, "apiKey">;
export type ProjectAgentAutomation = NonNullable<CreateProjectAgentArgs["automation"]>;
type ProjectAgentCliType = NonNullable<ProjectAgentAutomation["cliType"]>;

export interface ProjectAgentAutomationOptions {
  automation?: string;
  automationPrompt?: string;
  automationCliType?: string;
  automationCliModel?: string;
  automationCliEffort?: string;
  automationMode?: string;
  automationWorkspace?: string;
  clearAutomation?: boolean;
}

function isProjectAgentCliType(value: string): value is ProjectAgentCliType {
  return (SUPPORTED_CLI_TYPES as readonly string[]).includes(value);
}

function parseAutomationEnabled(value: string): boolean {
  if (value === "enabled") {
    return true;
  }
  if (value === "disabled") {
    return false;
  }
  throw new Error('--automation must be "enabled" or "disabled".');
}

function parseAutomationWorkspace(value: string | undefined): ProjectAgentAutomation["workspace"] {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "local" && value !== "worktree") {
    throw new Error('--automation-workspace must be "local" or "worktree".');
  }
  return value;
}

function hasAutomationDetails(options: ProjectAgentAutomationOptions): boolean {
  return [
    options.automationPrompt,
    options.automationCliType,
    options.automationCliModel,
    options.automationCliEffort,
    options.automationMode,
    options.automationWorkspace,
  ].some((value) => value !== undefined);
}

export function parseProjectAgentAutomation(
  options: ProjectAgentAutomationOptions,
  allowClear: boolean
): ProjectAgentAutomation | null | undefined {
  const hasDetails = hasAutomationDetails(options);
  validateNoConflict(
    options.clearAutomation === true,
    options.automation !== undefined || hasDetails,
    "Cannot use --clear-automation with automation configuration flags"
  );

  if (options.clearAutomation === true) {
    if (!allowClear) {
      throw new Error("--clear-automation is only valid when updating an agent.");
    }
    return null;
  }

  if (options.automation === undefined) {
    if (hasDetails) {
      throw new Error("Automation detail flags require --automation enabled|disabled.");
    }
    return undefined;
  }

  const cliType = parseOptionalNonEmptyString(options.automationCliType, "Automation CLI type");
  if (cliType !== undefined && !isProjectAgentCliType(cliType)) {
    throw new Error(`Invalid automation CLI type "${cliType}". Valid values: ${SUPPORTED_CLI_TYPES.join(", ")}`);
  }

  const prompt = parseOptionalNonEmptyString(options.automationPrompt, "Automation prompt");
  const cliModel = parseOptionalNonEmptyString(options.automationCliModel, "Automation CLI model");
  const cliEffort = parseOptionalNonEmptyString(options.automationCliEffort, "Automation CLI effort");
  const mode = parseOptionalNonEmptyString(options.automationMode, "Automation mode");
  const workspace = parseAutomationWorkspace(options.automationWorkspace);

  return {
    enabled: parseAutomationEnabled(options.automation),
    ...(prompt !== undefined && { prompt: { displayContent: prompt } }),
    ...(cliType !== undefined && { cliType }),
    ...(cliModel !== undefined && { cliModel }),
    ...(cliEffort !== undefined && { cliEffort }),
    ...(mode !== undefined && { mode }),
    ...(workspace !== undefined && { workspace }),
  };
}
