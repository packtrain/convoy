import { createEffortCatalog } from "../shared/effortCatalog";

/**
 * Claude Code reasoning-effort slots. Values map 1:1 to the Agent SDK
 * `effort` query option, except `ultracode` (xhigh + the `ultracode` setting).
 * `max` is omitted: only select models support it and the SDK fails the run.
 */
export const claudeCodeEffortCatalog = createEffortCatalog([
  {
    value: "default",
    label: "Default",
    description: "Use Claude Code's configured effort",
  },
  { value: "low", label: "Low", description: "Fastest, minimal reasoning" },
  { value: "medium", label: "Medium", description: "Balanced reasoning" },
  { value: "high", label: "High", description: "Deep reasoning" },
  {
    value: "xhigh",
    label: "Extra high",
    description: "Maximum reasoning for the hardest problems",
  },
  {
    value: "ultracode",
    label: "Ultracode",
    description: "Extra high effort plus multi-agent workflows",
  },
]);
