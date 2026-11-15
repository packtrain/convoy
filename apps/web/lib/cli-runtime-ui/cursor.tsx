import { MousePointerClick, Shield } from "lucide-react";
import ClaudeColorIcon from "@/components/icons/claude-color";
import CursorIcon from "@/components/icons/cursor";
import GeminiColorIcon from "@/components/icons/gemini-color";
import GrokIcon from "@/components/icons/grok";
import KimiColorIcon from "@/components/icons/kimi-color";
import OpenAIIcon from "@/components/icons/openai";
import ZaiIcon from "@/components/icons/zai";
import { getCursorEffortOptions } from "@/convex/cli/lib/runtimes/cursor/effort";
import type {
  CliIconComponent,
  CliModelGroup,
  CliModelOption,
  CliRuntimeUiDefinition,
} from "./contracts";

export const DEFAULT_CURSOR_MODEL = "default" as const;

/**
 * Provider sections for the model picker — Cursor's catalog spans
 * providers. Matched by slot prefix so new versions of a family land in
 * their provider's section; the unlabeled group renders first as plain
 * items (Default). Unmatched slots fall into the unlabeled group too.
 */
const CURSOR_PROVIDER_GROUPS: Array<{
  key: string;
  label?: string;
  icon?: CliIconComponent;
  prefixes: string[];
}> = [
  // Cursor's own models stay one level up as plain rows.
  { key: "top", prefixes: ["default", "auto", "composer-"] },
  { key: "anthropic", label: "Anthropic", icon: ClaudeColorIcon, prefixes: ["claude-"] },
  { key: "openai", label: "OpenAI", icon: OpenAIIcon, prefixes: ["gpt-"] },
  { key: "google", label: "Google", icon: GeminiColorIcon, prefixes: ["gemini-"] },
  { key: "zai", label: "Z.ai", icon: ZaiIcon, prefixes: ["glm-"] },
  { key: "moonshot", label: "Moonshot AI", icon: KimiColorIcon, prefixes: ["kimi-"] },
  { key: "xai", label: "xAI", icon: GrokIcon, prefixes: ["grok-"] },
];

function groupCursorModelOptions(options: CliModelOption[]): CliModelGroup[] {
  const byKey = new Map<string, CliModelOption[]>();
  for (const option of options) {
    const group =
      CURSOR_PROVIDER_GROUPS.find((candidate) =>
        candidate.prefixes.some((prefix) => option.value.startsWith(prefix)),
      ) ?? CURSOR_PROVIDER_GROUPS[0];
    const bucket = byKey.get(group.key);
    if (bucket) {
      bucket.push(option);
    } else {
      byKey.set(group.key, [option]);
    }
  }

  return CURSOR_PROVIDER_GROUPS.filter((group) => byKey.has(group.key)).map(
    (group) => {
      const groupOptions = byKey.get(group.key) ?? [];
      // Tiers are uniform within a provider family, so the group's
      // Reasoning section comes from its first tiered model. A tier the
      // eventually-selected model does not offer never reaches the run
      // (resolveCursorRunEffort self-corrects).
      const effortOptions = groupOptions
        .map((option) => getCursorEffortOptions({ cliModel: option.value }))
        .find((candidate) => candidate.length > 0);
      return {
        key: group.key,
        label: group.label,
        icon: group.icon,
        options: groupOptions,
        ...(effortOptions ? { effortOptions } : {}),
      };
    },
  );
}

/**
 * Cursor print mode has no interactive approvals and no plan mode; the only
 * permission knob is `--force` (auto-allow) vs the trusted-directory default
 * (see docs/specs/cli-cursor-runtime.md).
 */
export const cursorRuntimeUi: CliRuntimeUiDefinition = {
  type: "cursor",
  icon: CursorIcon,
  availableInSelector: true,
  modes: [
    {
      value: "agent",
      label: "Act",
      description: "Full access, auto-allows all commands, never asks",
      icon: MousePointerClick,
    },
    {
      value: "default",
      label: "Guarded",
      description:
        "Follows the machine's Cursor permission config; denied commands are skipped, never asked",
      icon: Shield,
    },
  ],
  getModelTooltip: (model) =>
    model === DEFAULT_CURSOR_MODEL
      ? "This is the default model configured in the Cursor CLI on the connected machine."
      : undefined,
  groupModelOptions: groupCursorModelOptions,
};
