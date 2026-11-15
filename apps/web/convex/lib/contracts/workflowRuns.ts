import { v, type Infer } from "convex/values";
import { cliEffortValidator, cliModelValidator, cliThreadWorktreeSpecValidator, cliTypeValidator } from "./validators";

// The Workflow run tree's shared shapes (docs/specs/workflow-data-schema.md → Run
// tree). In root contracts because schema.ts and the workflows domain share them.

export const workflowRunStatusValidator = v.union(
  v.literal("running"),
  v.literal("needs_attention"),
  v.literal("completed"),
  v.literal("canceled")
);

export const workflowRunStepStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("waiting"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("skipped"),
  // A run canceled while this step was in flight (docs/specs/workflows.md → Cancel).
  v.literal("canceled")
);

// The run-level start selection, shared by every Lane: one machine + working
// directory per run. `pathSnapshot` preserves context if the profile path is
// later renamed or removed.
export const runWorkspaceValidator = v.object({
  pathId: v.string(),
  pathSnapshot: v.string(),
  worktree: v.optional(cliThreadWorktreeSpecValidator),
});

export const runSelectionValidator = v.object({
  profileId: v.id("cliProfiles"),
  workspace: runWorkspaceValidator,
});

// Lane defaults and Step overrides folded together at run start — what the
// Step's thread actually starts with (docs/specs/workflow-data-schema.md).
export const resolvedExecutionValidator = v.object({
  projectAgentId: v.optional(v.id("projectAgents")),
  cliType: cliTypeValidator,
  cliModel: v.optional(cliModelValidator),
  cliEffort: v.optional(cliEffortValidator),
  mode: v.optional(v.string()),
});

// A manual user message parked this Lane until the starting user resumes it
// (docs/specs/workflows.md → Lane hold). Written by `cli/messages.ts` `send`,
// cleared by `workflows/runs/core.ts` `resumeLane`.
export const laneHoldValidator = v.object({
  heldAt: v.number(),
  triggeringMessageId: v.id("cliMessages"),
  resumeRequestedAt: v.optional(v.number()),
});

export type WorkflowRunStatus = Infer<typeof workflowRunStatusValidator>;
export type WorkflowRunStepStatus = Infer<typeof workflowRunStepStatusValidator>;
export type RunWorkspace = Infer<typeof runWorkspaceValidator>;
export type RunSelection = Infer<typeof runSelectionValidator>;
export type ResolvedExecution = Infer<typeof resolvedExecutionValidator>;
export type LaneHold = Infer<typeof laneHoldValidator>;
