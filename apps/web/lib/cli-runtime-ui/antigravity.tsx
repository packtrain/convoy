import { MousePointerClick } from "lucide-react";
import AntigravityColorIcon from "@/components/icons/antigravity-color";
import type { CliRuntimeUiDefinition } from "./contracts";

/** Act only until Ask to approve lands (OS-2469). Spec: docs/specs/cli-antigravity-runtime.md. */
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
  ],
};
