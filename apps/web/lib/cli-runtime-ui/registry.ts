import AmpIcon from "@/components/icons/amp";
import CodeRabbitIcon from "@/components/icons/coderabbit";
import DroidIcon from "@/components/icons/droid";
import GeminiColorIcon from "@/components/icons/gemini-color";
import GithubCopilotIcon from "@/components/icons/github-copilot";
import { createElement, type ReactNode } from "react";
import {
  CLI_RUNTIME_LABELS,
  getCliModelOption as getCliModelOptionFromBackend,
  getCliModelOptions as getCliModelOptionsFromBackend,
  getCliTriggerLabel as getCliTriggerLabelFromBackend,
  getSupportedCliTypes,
} from "@/convex/cli/lib/runtimes/registry";
import type {
  CliRuntimeEffortOption,
  CliRuntimeModelOption,
} from "@/convex/cli/lib/runtimes/contracts";
import type { CliRuntimeEffortContext } from "@/convex/cli/lib/runtimes/registry";
import {
  claudeCodeRuntimeUi,
  DEFAULT_CLAUDE_CODE_MODEL,
} from "./claude-code";
import type {
  AvailableCliInfo,
  CliIconComponent,
  CliProviderNotice,
  CliModel,
  CliModelGroup,
  CliModeDefinition,
  CliRuntimeUiDefinition,
  CliTypeSlug,
} from "./contracts";
import { antigravityRuntimeUi } from "./antigravity";
import { codexRuntimeUi } from "./codex";
import { cursorRuntimeUi } from "./cursor";
import { opencodeRuntimeUi } from "./opencode";

const CLI_RUNTIME_UI_DEFINITIONS: Partial<
  Record<CliTypeSlug, CliRuntimeUiDefinition>
> = {
  "claude-code": claudeCodeRuntimeUi,
  codex: codexRuntimeUi,
  amp: { type: "amp", icon: AmpIcon, availableInSelector: false },
  opencode: opencodeRuntimeUi,
  droid: { type: "droid", icon: DroidIcon, availableInSelector: false },
  cursor: cursorRuntimeUi,
  gemini: {
    type: "gemini",
    icon: GeminiColorIcon,
    availableInSelector: false,
  },
  antigravity: antigravityRuntimeUi,
  coderabbit: {
    type: "coderabbit",
    icon: CodeRabbitIcon,
    availableInSelector: false,
  },
  "github-copilot": {
    type: "github-copilot",
    icon: GithubCopilotIcon,
    availableInSelector: false,
  },
  other: { type: "other", availableInSelector: false },
};

export const CLI_TYPE_SELECTOR_ORDER: CliTypeSlug[] = [
  "claude-code",
  "codex",
  "opencode",
  "cursor",
  "antigravity",
];

export const CLI_TYPE_MAP: Record<CliTypeSlug, string> = Object.fromEntries(
  getSupportedCliTypes().map((slug) => [slug, CLI_RUNTIME_LABELS[slug]]),
) as Record<CliTypeSlug, string>;

export { DEFAULT_FALLBACK_CLI_TYPE } from "@/convex/cli/lib/runtimes/contracts";
export { DEFAULT_CLAUDE_CODE_MODEL };
export type {
  AvailableCliInfo,
  CliIconComponent,
  CliModel,
  CliModelGroup,
  CliModeDefinition,
  CliTypeSlug,
};
export type CliModelOption = CliRuntimeModelOption;
export type CliEffortOption = CliRuntimeEffortOption;

function getCliRuntimeUi(
  cliType: CliTypeSlug,
): CliRuntimeUiDefinition | undefined {
  return CLI_RUNTIME_UI_DEFINITIONS[cliType];
}

/**
 * Runtime facts the UI needs unchanged. Re-exported so the frontend has one
 * import path per function — see docs/specs/cli-runtime-architecture.md.
 */
export {
  cliTypeSupportsSteering,
  getAvailableCli,
  getCliEffortOptions,
  getDefaultCliEffort,
  getDefaultCliModel,
  isCliType,
  isSupportedCliEffort,
  isSupportedCliModel,
  supportsResumeLocally,
} from "@/convex/cli/lib/runtimes/registry";

export function getCliIcon(
  cliType: CliTypeSlug,
): CliIconComponent | undefined {
  return getCliRuntimeUi(cliType)?.icon;
}

export function renderCliIcon(
  cliType: CliTypeSlug,
  className?: string,
): ReactNode {
  const Icon = getCliIcon(cliType);
  return Icon ? createElement(Icon, { className }) : null;
}

export function getCliProviderNotice(
  cliType: CliTypeSlug,
  availableClis?: readonly AvailableCliInfo[],
): CliProviderNotice | undefined {
  return getCliRuntimeUi(cliType)?.getProviderNotice?.(availableClis);
}

export function isCliSelectable(cliType: CliTypeSlug): boolean {
  return getCliRuntimeUi(cliType)?.availableInSelector ?? false;
}

export function getCliModes(cliType: CliTypeSlug): CliModeDefinition[] {
  return getCliRuntimeUi(cliType)?.modes ?? [];
}

export function getCliModeDefinition(
  cliType: CliTypeSlug,
  mode: string,
): CliModeDefinition | undefined {
  return getCliModes(cliType).find((entry) => entry.value === mode);
}

export function getDefaultMode(
  cliType: CliTypeSlug,
): string | undefined {
  const modes = getCliModes(cliType);
  return (
    modes.find((mode) => mode.value === "agent")?.value ?? modes[0]?.value
  );
}

export function getCliModelOptions(
  cliType: CliTypeSlug,
  availableClis?: readonly AvailableCliInfo[],
): CliRuntimeModelOption[] {
  return getCliModelOptionsFromBackend({
    cliType,
    availableClis,
  });
}

export function getCliModelOption(
  cliType: CliTypeSlug,
  value: CliModel | undefined,
  availableClis?: readonly AvailableCliInfo[],
): CliRuntimeModelOption | undefined {
  return getCliModelOptionFromBackend({
    cliType,
    value,
    availableClis,
  });
}

export function getCliTriggerLabel(
  cliType: CliTypeSlug,
  value: CliModel | undefined,
  availableClis?: readonly AvailableCliInfo[],
): string {
  return getCliTriggerLabelFromBackend({
    cliType,
    value,
    availableClis,
  });
}

export type { CliRuntimeEffortContext as CliEffortContext };

export function getCliModelTooltip(
  cliType: CliTypeSlug,
  model: CliModel | undefined,
): string | undefined {
  return getCliRuntimeUi(cliType)?.getModelTooltip?.(model);
}

/**
 * Provider sections for the runtime's model list, or null for runtimes
 * that render a flat list.
 */
export function getCliModelGroups(
  cliType: CliTypeSlug,
  options: CliRuntimeModelOption[],
): CliModelGroup[] | null {
  return getCliRuntimeUi(cliType)?.groupModelOptions?.(options) ?? null;
}
