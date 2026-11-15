import { v, type Infer } from "convex/values";
import { cliEffortValidator, cliModelValidator, cliTypeValidator } from "./validators";
import { composerContentValidator } from "./composerContent";

// Project-agent assignment-automation config (OS-1094). In root contracts because schema.ts,
// the agents domain and MCP handlers all share it. The prompt keeps the composer's display
// text plus unexpanded slash-command refs; expansion happens on the normal create/send path.
// No CLI profile/path is stored — each assigning user picks their own in the composer.

// Where the automation thread prefers to run, relative to whichever working
// directory the assigning user picks: the checkout as-is, or a fresh worktree
// (branch auto-derived, based on the repo's default branch).
export const projectAgentAutomationWorkspaceValidator = v.union(v.literal("local"), v.literal("worktree"));

export const projectAgentAutomationValidator = v.object({
  enabled: v.boolean(),
  prompt: v.optional(composerContentValidator),
  cliType: v.optional(cliTypeValidator),
  cliModel: v.optional(cliModelValidator),
  cliEffort: v.optional(cliEffortValidator),
  mode: v.optional(v.string()),
  workspace: v.optional(projectAgentAutomationWorkspaceValidator),
});

export type ProjectAgentAutomation = Infer<typeof projectAgentAutomationValidator>;
