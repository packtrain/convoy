import { AGENT_COLOR_PALETTE } from "@/lib/colors/palette";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";
import type { AgentAppearance, ProjectAgentAutomation } from "./validators";

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeAgentName(name: string): string {
  const normalized = normalizeWhitespace(name);
  ensure(normalized.length).gte(1, errors.AGENT_NAME_REQUIRED);
  return normalized;
}

export function normalizeAgentNameKey(name: string): string {
  return normalizeAgentName(name).toLowerCase();
}

export function normalizeOptionalAgentPrompt(prompt: string | null | undefined): string | undefined {
  if (prompt == null) {
    return undefined;
  }
  const normalized = prompt.trim();
  return normalized || undefined;
}

export function normalizeOptionalAgentText(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  const normalized = normalizeWhitespace(value);
  return normalized || undefined;
}

export function isAgentPaletteColor(color: string): boolean {
  return AGENT_COLOR_PALETTE.some((paletteColor) => paletteColor === color);
}

export function normalizeAgentAppearance(appearance: AgentAppearance): AgentAppearance {
  ensure(appearance.color).satisfies(
    isAgentPaletteColor,
    errors.AGENT_COLOR_INVALID
  );
  return { color: appearance.color };
}

/**
 * Normalize assignment-automation config: drops an empty prompt (no trimmed
 * display text and no slash-command refs) and preserves refs unexpanded.
 */
export function normalizeProjectAgentAutomation(
  automation: ProjectAgentAutomation | null | undefined
): ProjectAgentAutomation | undefined {
  if (automation == null) {
    return undefined;
  }

  const displayContent = automation.prompt?.displayContent.trim() ?? "";
  const refs = automation.prompt?.composerDocument?.refs ?? [];
  const prompt =
    displayContent.length === 0 && refs.length === 0
      ? undefined
      : { displayContent, composerDocument: automation.prompt?.composerDocument };

  return {
    enabled: automation.enabled,
    prompt,
    cliType: automation.cliType,
    cliModel: automation.cliModel,
    cliEffort: automation.cliEffort,
    mode: automation.mode,
    workspace: automation.workspace,
  };
}
