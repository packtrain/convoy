import type {
  AvailableCli as AvailableCliInfo,
  CliModel,
  CliType,
} from "@/convex/lib/contracts/validators";
import {
  CLI_TYPE_MAP,
  CLI_TYPE_SELECTOR_ORDER,
  DEFAULT_CLAUDE_CODE_MODEL,
  DEFAULT_FALLBACK_CLI_TYPE,
  getCliModes,
} from "@/lib/cli-runtime-ui/registry";

// Chat status — use backend values directly
export type ThreadStatus =
  | "pending"
  | "streaming"
  | "waiting_input"
  | "failed"
  | "completed";

// CLI type slug (backend values)
export type CliTypeSlug = CliType;
export type { AvailableCliInfo, CliModel };
export {
  CLI_TYPE_MAP,
  CLI_TYPE_SELECTOR_ORDER,
  DEFAULT_CLAUDE_CODE_MODEL,
  DEFAULT_FALLBACK_CLI_TYPE,
};

export function getPlanModeToggleTarget(
  cliType: CliTypeSlug,
  currentMode: string | undefined
): string | undefined {
  const modes = getCliModes(cliType);
  const hasPlanMode = modes.some((mode) => mode.value === "plan");
  if (!hasPlanMode) return undefined;

  const hasAgentMode = modes.some((mode) => mode.value === "agent");
  if (currentMode?.trim() === "plan" && hasAgentMode) {
    return "agent";
  }

  return "plan";
}
