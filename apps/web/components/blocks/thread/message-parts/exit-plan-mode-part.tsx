import type { ExitPlanModeToolPayload } from "@/lib/ai-tools/exit-plan-mode";
import type { PlanDecision } from "@/lib/threads/plan-decision";
import type { CliTypeSlug } from "@/lib/threads/types";
import { PlanPart } from "./plan-part";

export function ExitPlanModePart({ payload, ...props }: {
  payload: ExitPlanModeToolPayload;
  cliType?: CliTypeSlug;
  onPlanDecision?: (decision: PlanDecision) => Promise<void> | void;
  showPlanDecisions?: boolean;
}) {
  return <PlanPart payload={{ id: payload.toolCallId, text: payload.plan }} {...props} />;
}
