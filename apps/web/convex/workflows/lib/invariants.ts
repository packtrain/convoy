import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import type { LaneDefinition, LaneRuntimeDefaults, WorkflowDefinition } from "../../lib/contracts/workflowDefinition";
import { getProjectAgentById } from "../../agents/lib/projectAgentsRepo";
import { isSupportedCliEffort, isSupportedCliModel } from "../../lib/contracts/validators";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";

export const MAX_WORKFLOW_LANES = 12;
export const MAX_WORKFLOW_STAGES = 50;
export const MAX_WORKFLOW_STEPS_PER_STAGE = 50;
export const MAX_WORKFLOW_DEFINITION_JSON_LENGTH = 256_000;
// Per-field caps exist only to fail early with a specific message; the
// aggregate JSON cap is the binding limit and they are not sized to sum to it.
export const MAX_WORKFLOW_BASH_SCRIPT_LENGTH = 32_000;
export const MAX_WORKFLOW_PROMPT_LENGTH = 32_000;
// Bash timeout bounds, enforced at the version cut (the editor supplies the default).
export const MIN_WORKFLOW_BASH_TIMEOUT_MS = 1_000;
export const MAX_WORKFLOW_BASH_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/**
 * Structure and size limits only — beyond one Lane and one Stage, a half-built
 * Workflow is a legal draft, so Save never blocks work in progress. Full
 * semantic validation happens at the version cut
 * (docs/specs/workflow-data-schema.md → Save and version cut).
 */
export function assertDefinitionStructure(definition: WorkflowDefinition): void {
  ensure(definition.lanes.length).gte(1, errors.WORKFLOW_DEFINITION_NO_LANES);
  ensure(definition.stages.length).gte(1, errors.WORKFLOW_DEFINITION_NO_STAGES);
  ensure(definition.lanes.length).lte(MAX_WORKFLOW_LANES, errors.WORKFLOW_DEFINITION_TOO_MANY_LANES);
  ensure(definition.stages.length).lte(MAX_WORKFLOW_STAGES, errors.WORKFLOW_DEFINITION_TOO_MANY_STAGES);

  const laneIds = new Set(definition.lanes.map((lane) => lane.laneId));
  ensure(laneIds.size).eq(definition.lanes.length, errors.WORKFLOW_DEFINITION_DUPLICATE_LANE_ID);

  const stageIds = new Set(definition.stages.map((stage) => stage.stageId));
  ensure(stageIds.size).eq(definition.stages.length, errors.WORKFLOW_DEFINITION_DUPLICATE_STAGE_ID);

  for (const stage of definition.stages) {
    ensure(stage.steps.length).lte(MAX_WORKFLOW_STEPS_PER_STAGE, errors.WORKFLOW_DEFINITION_TOO_MANY_STEPS);
    const stepIds = new Set(stage.steps.map((step) => step.stepId));
    ensure(stepIds.size).eq(stage.steps.length, errors.WORKFLOW_DEFINITION_DUPLICATE_STEP_ID);
    for (const step of stage.steps) {
      ensure(laneIds.has(step.laneId)).isTrue(errors.WORKFLOW_DEFINITION_UNKNOWN_LANE);
      if (step.action.type === "bash") {
        ensure(step.action.script.length).lte(MAX_WORKFLOW_BASH_SCRIPT_LENGTH, errors.WORKFLOW_DEFINITION_SCRIPT_TOO_LONG);
      }
      if (step.action.type === "prompt") {
        ensure(step.action.content.displayContent.length).lte(MAX_WORKFLOW_PROMPT_LENGTH, errors.WORKFLOW_DEFINITION_PROMPT_TOO_LONG);
      }
    }
  }

  ensure(JSON.stringify(definition).length).lte(
    MAX_WORKFLOW_DEFINITION_JSON_LENGTH,
    errors.WORKFLOW_DEFINITION_TOO_LARGE
  );
}

type RuntimeSettings = Pick<LaneRuntimeDefaults, "cliType" | "cliModel" | "cliEffort" | "projectAgentId">;

/** Model/effort against the runtime, agent active and in-project — the same bar for Lane defaults and Parallel-Lane Step overrides. */
async function assertRuntimeSettingsRunnable(ctx: QueryCtx, projectId: Id<"projects">, settings: RuntimeSettings): Promise<void> {
  if (settings.cliModel !== undefined) {
    ensure(isSupportedCliModel(settings.cliType, settings.cliModel)).isTrue(errors.WORKFLOW_DEFINITION_LANE_MODEL_UNSUPPORTED);
  }
  if (settings.cliEffort !== undefined) {
    ensure(isSupportedCliEffort(settings.cliType, settings.cliEffort, { cliModel: settings.cliModel })).isTrue(
      errors.WORKFLOW_DEFINITION_LANE_EFFORT_UNSUPPORTED
    );
  }
  if (settings.projectAgentId !== undefined) {
    const agent = await ensure(getProjectAgentById(ctx, settings.projectAgentId)).notDeleted(
      errors.WORKFLOW_DEFINITION_AGENT_NOT_FOUND
    );
    ensure(agent.projectId).eq(projectId, errors.WORKFLOW_DEFINITION_AGENT_DIFFERENT_PROJECT);
  }
}

async function assertLaneRunnable(ctx: QueryCtx, projectId: Id<"projects">, lane: LaneDefinition): Promise<void> {
  ensure(lane.name.trim().length).gte(1, errors.WORKFLOW_DEFINITION_LANE_NAME_REQUIRED);
  // A parallel Lane stores no defaults; its Steps are validated in the stage loop.
  if (lane.type === "parallel") {
    return;
  }
  const defaults = await ensure(lane.defaults).notNull(errors.WORKFLOW_DEFINITION_LANE_RUNTIME_REQUIRED);
  await assertRuntimeSettingsRunnable(ctx, projectId, defaults);
}

/**
 * Full validation at the version cut (docs/specs/workflow-data-schema.md →
 * Save and version cut): everything Save tolerates in a draft must hold before
 * a run pins the definition. Includes the Bash rules (bounded timeout; a
 * parallel lane's script can only stop on failure — its one-shot thread has no
 * agent to report to) and the wait-not-first rule (a Wait step blocks a
 * thread that must already exist).
 */
export async function assertDefinitionRunnable(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  definition: WorkflowDefinition
): Promise<void> {
  assertDefinitionStructure(definition);

  // Restated here (Save already rejects both) so the version cut's contract
  // reads standalone and survives a change to what Save tolerates.
  ensure(definition.lanes.length).gte(1, errors.WORKFLOW_DEFINITION_NO_LANES);
  ensure(definition.stages.length).gte(1, errors.WORKFLOW_DEFINITION_NO_STAGES);

  const parallelLaneIds = new Set<string>();
  for (const lane of definition.lanes) {
    await assertLaneRunnable(ctx, projectId, lane);
    if (lane.type === "parallel") {
      parallelLaneIds.add(lane.laneId);
    }
  }

  const lanesWithSteps = new Set<string>();
  for (const stage of definition.stages) {
    ensure(stage.name.trim().length).gte(1, errors.WORKFLOW_DEFINITION_STAGE_NAME_REQUIRED);
    ensure(stage.steps.length).gte(1, errors.WORKFLOW_DEFINITION_EMPTY_STAGE);
    for (const step of stage.steps) {
      if (step.action.type === "bash") {
        ensure(step.action.timeoutMs).between(MIN_WORKFLOW_BASH_TIMEOUT_MS, MAX_WORKFLOW_BASH_TIMEOUT_MS, errors.WORKFLOW_DEFINITION_BASH_TIMEOUT_INVALID);
        if (parallelLaneIds.has(step.laneId)) {
          ensure(step.action.reportOutput).eq("stop_on_failure", errors.WORKFLOW_DEFINITION_PARALLEL_BASH_MUST_STOP);
        }
      }
      // Each Parallel-Lane prompt starts its own thread, so it carries the settings a Lane would.
      if (step.action.type === "prompt" && parallelLaneIds.has(step.laneId)) {
        const cliType = await ensure(step.action.overrides?.cliType).notNull(errors.WORKFLOW_DEFINITION_STEP_RUNTIME_REQUIRED);
        await assertRuntimeSettingsRunnable(ctx, projectId, { ...step.action.overrides, cliType });
      }
      if (step.action.type === "wait") {
        ensure(lanesWithSteps.has(step.laneId)).isTrue(errors.WORKFLOW_DEFINITION_WAIT_FIRST);
      }
      lanesWithSteps.add(step.laneId);
    }
  }
}
