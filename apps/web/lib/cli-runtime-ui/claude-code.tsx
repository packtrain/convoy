import { ListChecks, MessageCircleQuestion, MousePointerClick, PenLine, Sparkles } from "lucide-react";
import ClaudeColorIcon from "@/components/icons/claude-color";
import type { CliRuntimeUiDefinition } from "./contracts";

export const DEFAULT_CLAUDE_CODE_MODEL = "default" as const;

export const claudeCodeRuntimeUi: CliRuntimeUiDefinition = {
  type: "claude-code",
  icon: ClaudeColorIcon,
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
      value: "acceptEdits",
      label: "Accept edits",
      description: "Accepts edits; asks for other actions",
      icon: PenLine,
    },
    {
      value: "auto",
      label: "Auto",
      description: "Claude decides; asks only for risky actions",
      icon: Sparkles,
    },
    {
      value: "plan",
      label: "Plan",
      description: "Plans before acting; you approve the plan",
      icon: ListChecks,
    },
  ],
  getModelTooltip: (model) =>
    model === DEFAULT_CLAUDE_CODE_MODEL
      ? "This is the default that the user has set up in the Claude Code CLI."
      : undefined,
};
