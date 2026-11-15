import { ListChecks, MessageCircleQuestion, MousePointerClick, Shield } from "lucide-react";
import OpenAIIcon from "@/components/icons/openai";
import { getCodexAvailableCli } from "@/convex/cli/lib/runtimes/codex/models";
import type { CliRuntimeUiDefinition } from "./contracts";

export const DEFAULT_CODEX_MODEL = "default" as const;

/**
 * "Ask to approve" and "Plan" need the CLI connection to run the codex
 * app-server transport (interactive, OS-1109) — the default since OS-1659.
 * On a `--codex-exec` connection they degrade to the sandboxed
 * never-asks behavior (see docs/specs/cli-codex-runtime.md).
 */
export const codexRuntimeUi: CliRuntimeUiDefinition = {
  type: "codex",
  icon: OpenAIIcon,
  availableInSelector: true,
  modes: [
    {
      value: "agent",
      label: "Act",
      description: "Full access, no sandbox, never asks",
      icon: MousePointerClick,
    },
    {
      value: "default",
      label: "Ask to approve",
      description: "Sandboxed; asks you before untrusted commands and edits",
      icon: MessageCircleQuestion,
    },
    {
      value: "auto",
      label: "Sandboxed",
      description: "Writes only inside the workspace, never asks",
      icon: Shield,
    },
    {
      value: "plan",
      label: "Plan",
      description: "Read-only; researches and proposes a plan",
      icon: ListChecks,
    },
  ],
  // AWS-hosted Codex (OS-2105). Limits per docs/specs/cli-provider-keys.md → Codex.
  getProviderNotice: (availableClis) => {
    const cli = getCodexAvailableCli(availableClis);
    if (cli?.provider !== "mantle" && cli?.provider !== "bedrock") return undefined;
    const label = cli.provider === "mantle" ? "AWS Bedrock (Mantle)" : "AWS Bedrock";
    return {
      label: cli.region ? `${label} · ${cli.region}` : label,
      limits: cli.provider === "mantle"
        ? "No Fast mode or image generation."
        : "No Fast mode, image generation or hosted web search.",
    };
  },
  getModelTooltip: (model) =>
    model === DEFAULT_CODEX_MODEL
      ? "This is the default model configured in the Codex CLI on the connected machine."
      : undefined,
};
