import { ListChecks, MessageCircleQuestion, MousePointerClick } from "lucide-react";
import AwsColorIcon from "@/components/icons/aws-color";
import ClaudeColorIcon from "@/components/icons/claude-color";
import GeminiColorIcon from "@/components/icons/gemini-color";
import GrokIcon from "@/components/icons/grok";
import KimiColorIcon from "@/components/icons/kimi-color";
import OpenAIIcon from "@/components/icons/openai";
import OpenCodeIcon from "@/components/icons/opencode";
import ZaiIcon from "@/components/icons/zai";
import type {
  CliIconComponent,
  CliModelGroup,
  CliModelOption,
  CliRuntimeUiDefinition,
} from "./contracts";

export const DEFAULT_OPENCODE_MODEL = "default" as const;

/**
 * OpenCode advertises every model of every connected provider, so the list
 * easily runs to dozens — group by the `providerID/` slug prefix. Known
 * providers get a proper label/icon; anything else falls back to the
 * capitalized provider id.
 */
const OPENCODE_PROVIDER_META: Record<
  string,
  { label: string; icon?: CliIconComponent }
> = {
  anthropic: { label: "Anthropic", icon: ClaudeColorIcon },
  openai: { label: "OpenAI", icon: OpenAIIcon },
  google: { label: "Google", icon: GeminiColorIcon },
  "google-vertex": { label: "Google Vertex", icon: GeminiColorIcon },
  xai: { label: "xAI", icon: GrokIcon },
  zai: { label: "Z.ai", icon: ZaiIcon },
  "zai-coding-plan": { label: "Z.ai Coding Plan", icon: ZaiIcon },
  moonshotai: { label: "Moonshot AI", icon: KimiColorIcon },
  "github-copilot": { label: "GitHub Copilot" },
  "amazon-bedrock": { label: "Amazon Bedrock", icon: AwsColorIcon },
  bedrock: { label: "Amazon Bedrock", icon: AwsColorIcon },
  openrouter: { label: "OpenRouter" },
  opencode: { label: "OpenCode", icon: OpenCodeIcon },
};

function providerLabel(providerId: string): string {
  return (
    OPENCODE_PROVIDER_META[providerId]?.label ??
    providerId.charAt(0).toUpperCase() + providerId.slice(1)
  );
}

function groupOpencodeModelOptions(
  options: CliModelOption[],
): CliModelGroup[] {
  const ungrouped: CliModelOption[] = [];
  const byProvider = new Map<string, CliModelOption[]>();
  for (const option of options) {
    const slashIndex = option.value.indexOf("/");
    if (slashIndex <= 0) {
      // The default slot (and any non-slug value) stays at the top level.
      ungrouped.push(option);
      continue;
    }
    const providerId = option.value.slice(0, slashIndex);
    const bucket = byProvider.get(providerId);
    if (bucket) {
      bucket.push(option);
    } else {
      byProvider.set(providerId, [option]);
    }
  }

  return [
    ...(ungrouped.length > 0 ? [{ key: "top", options: ungrouped }] : []),
    // Insertion order = advertised inventory order.
    ...[...byProvider.entries()].map(([providerId, providerOptions]) => ({
      key: providerId,
      label: providerLabel(providerId),
      icon: OPENCODE_PROVIDER_META[providerId]?.icon,
      options: providerOptions,
    })),
  ];
}

/**
 * OpenCode runs interactively (serve + SDK): modes map to session permission
 * rulesets and approvals surface in the thread (see
 * docs/specs/cli-opencode-runtime.md). `default` reuses Claude's
 * "Ask to approve" mode value — no new mode literal.
 */
export const opencodeRuntimeUi: CliRuntimeUiDefinition = {
  type: "opencode",
  icon: OpenCodeIcon,
  availableInSelector: true,
  modes: [
    {
      value: "agent",
      label: "Act",
      description: "Full access, never asks for approval",
      icon: MousePointerClick,
    },
    {
      value: "default",
      label: "Ask to approve",
      description: "Asks you before running tools",
      icon: MessageCircleQuestion,
    },
    {
      value: "plan",
      label: "Plan",
      description: "Runs OpenCode's read-only plan agent",
      icon: ListChecks,
    },
  ],
  getModelTooltip: (model) =>
    model === DEFAULT_OPENCODE_MODEL
      ? "This is the default model configured in OpenCode on the connected machine."
      : undefined,
  groupModelOptions: groupOpencodeModelOptions,
};
