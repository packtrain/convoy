import { MessageCircleQuestion, MousePointerClick } from "lucide-react";
import AntigravityColorIcon from "@/components/icons/antigravity-color";
import type { CliRuntimeUiDefinition } from "./contracts";

/** `default` reuses the "Ask to approve" mode value. Spec: docs/specs/cli-antigravity-runtime.md. */
export const antigravityRuntimeUi: CliRuntimeUiDefinition = {
  type: "antigravity",
  icon: AntigravityColorIcon,
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
      label: "Ask to approve",
      description: "Asks you before running commands",
      icon: MessageCircleQuestion,
    },
  ],
};
