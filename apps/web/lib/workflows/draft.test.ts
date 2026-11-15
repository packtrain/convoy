import { describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { StepOverrides, WorkflowDefinition, WorkflowStep } from "@/convex/lib/contracts/workflowDefinition";
import {
  addLane,
  addStage,
  addStep,
  createSeedDefinition,
  lastPromptOverrides,
  moveStep,
  removeLane,
  removeStage,
  removeStep,
  renameLane,
  renameStage,
  setLaneDefaults,
  setLaneType,
  updateStep,
} from "./draft";

function promptStep(stepId: string, laneId: string): WorkflowStep {
  return { stepId, laneId, action: { type: "prompt", content: { displayContent: stepId } } };
}

function overriddenPromptStep(stepId: string, laneId: string, overrides: StepOverrides): WorkflowStep {
  return { stepId, laneId, action: { type: "prompt", content: { displayContent: stepId }, overrides } };
}

function twoLaneDefinition(): WorkflowDefinition {
  return {
    lanes: [
      { laneId: "lane-1", name: "Lane 1", type: "single" },
      { laneId: "lane-2", name: "Lane 2", type: "single" },
    ],
    stages: [
      { stageId: "stage-1", name: "Stage 1", steps: [promptStep("step-a", "lane-1"), promptStep("step-b", "lane-2")] },
      { stageId: "stage-2", name: "Stage 2", steps: [promptStep("step-c", "lane-1")] },
    ],
  };
}

describe("workflow draft helpers", () => {
  test("createSeedDefinition starts with one single lane and one empty stage", () => {
    const definition = createSeedDefinition();

    expect(definition.lanes).toHaveLength(1);
    expect(definition.lanes[0]).toMatchObject({ name: "Lane 1", type: "single" });
    expect(definition.stages).toHaveLength(1);
    expect(definition.stages[0]).toMatchObject({ name: "Stage 1", steps: [] });
    expect(definition.lanes[0].laneId).not.toBe(definition.stages[0].stageId);
  });

  test("addLane and addStage append with unique ids across repeated adds", () => {
    let definition = createSeedDefinition();
    definition = addLane(definition);
    definition = addLane(definition);
    definition = addStage(definition);

    expect(definition.lanes.map((lane) => lane.name)).toEqual(["Lane 1", "Lane 2", "Lane 3"]);
    expect(definition.stages.map((stage) => stage.name)).toEqual(["Stage 1", "Stage 2"]);
    const ids = [...definition.lanes.map((lane) => lane.laneId), ...definition.stages.map((stage) => stage.stageId)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("addLane and addStage name purely by position, ignoring existing names", () => {
    const renamed = renameLane(twoLaneDefinition(), "lane-1", "Main Executor");
    expect(addLane(renamed).lanes.map((lane) => lane.name)).toEqual(["Main Executor", "Lane 2", "Lane 3"]);

    const afterDelete = removeLane(twoLaneDefinition(), "lane-1");
    expect(addLane(afterDelete).lanes.map((lane) => lane.name)).toEqual(["Lane 2", "Lane 2"]);

    const renamedStage = renameStage(twoLaneDefinition(), "stage-1", "Planning");
    expect(addStage(renamedStage).stages.map((stage) => stage.name)).toEqual(["Planning", "Stage 2", "Stage 3"]);
  });

  test("renameLane and renameStage touch only their target", () => {
    const input = twoLaneDefinition();

    const renamedLane = renameLane(input, "lane-2", "Review");
    expect(renamedLane.lanes.map((lane) => lane.name)).toEqual(["Lane 1", "Review"]);

    const renamedStage = renameStage(input, "stage-1", "Plan");
    expect(renamedStage.stages.map((stage) => stage.name)).toEqual(["Plan", "Stage 2"]);
  });

  test("removeLane drops the lane and its steps in every stage", () => {
    const result = removeLane(twoLaneDefinition(), "lane-1");

    expect(result.lanes.map((lane) => lane.laneId)).toEqual(["lane-2"]);
    expect(result.stages[0].steps.map((step) => step.stepId)).toEqual(["step-b"]);
    expect(result.stages[1].steps).toEqual([]);
  });

  test("removeStage drops only that stage", () => {
    const result = removeStage(twoLaneDefinition(), "stage-1");

    expect(result.stages.map((stage) => stage.stageId)).toEqual(["stage-2"]);
    expect(result.lanes).toHaveLength(2);
  });

  test("addStep appends to its stage with a generated id", () => {
    const result = addStep(twoLaneDefinition(), "stage-2", "lane-2", {
      name: "Checks",
      action: { type: "bash", script: "pnpm test", timeoutMs: 600_000, reportOutput: "on_failure" },
    });

    expect(result.stages[0].steps).toHaveLength(2);
    const added = result.stages[1].steps.at(-1);
    expect(added).toMatchObject({ laneId: "lane-2", name: "Checks", action: { type: "bash" } });
    expect(added?.stepId).toBeTruthy();
    expect(added?.stepId).not.toBe("step-c");
  });

  test("updateStep replaces name and action on only its target, keeping stepId and laneId", () => {
    const result = updateStep(twoLaneDefinition(), "stage-1", "step-a", { action: { type: "wait" } });

    expect(result.stages[0].steps[0]).toEqual({ stepId: "step-a", laneId: "lane-1", action: { type: "wait" } });
    expect(result.stages[0].steps[1]).toEqual(twoLaneDefinition().stages[0].steps[1]);
    expect(result.stages[1]).toEqual(twoLaneDefinition().stages[1]);
  });

  test("updateStep keeps step fields it does not edit", () => {
    const definition = twoLaneDefinition();
    definition.stages[0].steps[0] = {
      ...definition.stages[0].steps[0],
      future: "keep",
    } as unknown as WorkflowStep;

    const result = updateStep(definition, "stage-1", "step-a", { action: { type: "wait" } });

    expect(result.stages[0].steps[0]).toMatchObject({
      stepId: "step-a",
      laneId: "lane-1",
      future: "keep",
      action: { type: "wait" },
    });
  });

  test("moveStep to another lane's cell rewrites laneId and appends to the stage", () => {
    const result = moveStep(
      twoLaneDefinition(),
      { stageId: "stage-1", stepId: "step-a" },
      { stageId: "stage-1", laneId: "lane-2" }
    );

    expect(result.stages[0].steps.map((step) => step.stepId)).toEqual(["step-b", "step-a"]);
    expect(result.stages[0].steps[1].laneId).toBe("lane-2");
  });

  test("moveStep across stages removes from the source and inserts at the anchor", () => {
    const result = moveStep(
      twoLaneDefinition(),
      { stageId: "stage-1", stepId: "step-b" },
      { stageId: "stage-2", laneId: "lane-1", anchor: { stepId: "step-c", position: "before" } }
    );

    expect(result.stages[0].steps.map((step) => step.stepId)).toEqual(["step-a"]);
    expect(result.stages[1].steps.map((step) => step.stepId)).toEqual(["step-b", "step-c"]);
    expect(result.stages[1].steps[0].laneId).toBe("lane-1");
  });

  test("moveStep reorders within a cell with an after anchor", () => {
    let definition = twoLaneDefinition();
    definition = addStep(definition, "stage-1", "lane-1", { action: { type: "wait" } });
    const addedId = definition.stages[0].steps.at(-1)?.stepId ?? "";

    const result = moveStep(
      definition,
      { stageId: "stage-1", stepId: "step-a" },
      { stageId: "stage-1", laneId: "lane-1", anchor: { stepId: addedId, position: "after" } }
    );

    expect(result.stages[0].steps.map((step) => step.stepId)).toEqual(["step-b", addedId, "step-a"]);
  });

  test("moveStep returns the input unchanged for no-op drops and missing sources", () => {
    const definition = twoLaneDefinition();

    // Dropping a card before its own next sibling leaves the order as-is.
    expect(
      moveStep(
        definition,
        { stageId: "stage-1", stepId: "step-a" },
        { stageId: "stage-1", laneId: "lane-1", anchor: { stepId: "step-b", position: "before" } }
      )
    ).toBe(definition);
    expect(
      moveStep(definition, { stageId: "stage-1", stepId: "missing" }, { stageId: "stage-2", laneId: "lane-1" })
    ).toBe(definition);
  });

  test("moveStep into a single lane sheds thread-level overrides, keeping only mode", () => {
    const definition = twoLaneDefinition();
    definition.lanes[0].type = "parallel";
    definition.stages[0].steps[0] = overriddenPromptStep("step-a", "lane-1", {
      projectAgentId: "agent-1" as Id<"projectAgents">,
      cliType: "codex",
      cliModel: "gpt-5",
      cliEffort: "high",
      mode: "plan",
    });

    const result = moveStep(
      definition,
      { stageId: "stage-1", stepId: "step-a" },
      { stageId: "stage-1", laneId: "lane-2" }
    );

    const moved = result.stages[0].steps.find((step) => step.stepId === "step-a");
    expect(moved?.action).toEqual({
      type: "prompt",
      content: { displayContent: "step-a" },
      overrides: { mode: "plan" },
    });
  });

  test("moveStep into a parallel lane pins the source lane's runtime, defaulting an override-less prompt", () => {
    const definition = twoLaneDefinition();
    definition.lanes[0].defaults = { cliType: "codex" };
    definition.lanes[1].type = "parallel";
    definition.stages[0].steps[0] = overriddenPromptStep("step-a", "lane-1", { mode: "plan" });

    const result = moveStep(
      definition,
      { stageId: "stage-1", stepId: "step-a" },
      { stageId: "stage-1", laneId: "lane-2" }
    );
    const moved = result.stages[0].steps.find((step) => step.stepId === "step-a");
    expect(moved?.action).toMatchObject({ overrides: { cliType: "codex", mode: "plan" } });

    // No source defaults and no overrides: the fallback runtime is pinned so
    // the step still resolves a runtime at version cut.
    const bareDefinition = twoLaneDefinition();
    bareDefinition.lanes[1].type = "parallel";
    const bareResult = moveStep(
      bareDefinition,
      { stageId: "stage-1", stepId: "step-a" },
      { stageId: "stage-1", laneId: "lane-2" }
    );
    const bareMoved = bareResult.stages[0].steps.find((step) => step.stepId === "step-a");
    expect(bareMoved?.action).toMatchObject({ overrides: { cliType: "claude-code" } });
  });

  test("moveStep between same-type lanes leaves prompt overrides untouched", () => {
    const definition = twoLaneDefinition();
    definition.stages[0].steps[0] = overriddenPromptStep("step-a", "lane-1", { mode: "plan" });

    const result = moveStep(
      definition,
      { stageId: "stage-1", stepId: "step-a" },
      { stageId: "stage-1", laneId: "lane-2" }
    );

    const moved = result.stages[0].steps.find((step) => step.stepId === "step-a");
    expect(moved?.action).toEqual(definition.stages[0].steps[0].action);
  });

  test("setLaneType to parallel moves the lane defaults onto its prompts, their own mode winning", () => {
    const definition = twoLaneDefinition();
    definition.lanes[0].defaults = {
      cliType: "codex",
      cliModel: "gpt-5",
      cliEffort: "high",
      mode: "agent",
      projectAgentId: "agent-1" as Id<"projectAgents">,
    };
    definition.stages[0].steps[0] = overriddenPromptStep("step-a", "lane-1", { mode: "plan" });

    const result = setLaneType(definition, "lane-1", "parallel");

    expect(result.lanes[0].type).toBe("parallel");
    expect(result.lanes[0].defaults).toBeUndefined();
    expect(result.stages[0].steps[0].action).toMatchObject({
      overrides: { cliType: "codex", cliModel: "gpt-5", cliEffort: "high", mode: "plan", projectAgentId: "agent-1" },
    });
    // An override-less prompt in the same lane inherits the full defaults.
    expect(result.stages[1].steps[0].action).toMatchObject({
      overrides: { cliType: "codex", cliModel: "gpt-5", cliEffort: "high", mode: "agent", projectAgentId: "agent-1" },
    });
    // Other lanes' steps stay untouched.
    expect(result.stages[0].steps[1]).toEqual(definition.stages[0].steps[1]);
  });

  test("setLaneType to single reduces its prompts' overrides to mode", () => {
    const definition = twoLaneDefinition();
    definition.lanes[0].type = "parallel";
    definition.stages[0].steps[0] = overriddenPromptStep("step-a", "lane-1", {
      projectAgentId: "agent-1" as Id<"projectAgents">,
      cliType: "codex",
      cliModel: "gpt-5",
      cliEffort: "high",
      mode: "plan",
    });

    const result = setLaneType(definition, "lane-1", "single");

    expect(result.lanes[0].type).toBe("single");
    expect(result.stages[0].steps[0].action).toEqual({
      type: "prompt",
      content: { displayContent: "step-a" },
      overrides: { mode: "plan" },
    });
  });

  test("setLaneDefaults switching the runtime drops step modes the new runtime lacks", () => {
    const definition = twoLaneDefinition();
    definition.lanes[0].defaults = { cliType: "claude-code" };
    // acceptEdits is claude-code only; agent exists on cursor too.
    definition.stages[0].steps[0] = overriddenPromptStep("step-a", "lane-1", { mode: "acceptEdits" });
    definition.stages[1].steps[0] = overriddenPromptStep("step-b", "lane-1", { mode: "agent" });

    const result = setLaneDefaults(definition, "lane-1", { cliType: "cursor" });

    expect(result.stages[0].steps[0].action).toEqual({ type: "prompt", content: { displayContent: "step-a" } });
    expect(result.stages[1].steps[0].action).toMatchObject({ overrides: { mode: "agent" } });
    // Other lanes' steps stay untouched.
    expect(result.stages[0].steps[1]).toBe(definition.stages[0].steps[1]);
  });

  test("setLaneDefaults keeping the runtime leaves step overrides untouched", () => {
    const definition = twoLaneDefinition();
    definition.lanes[0].defaults = { cliType: "claude-code" };
    definition.stages[0].steps[0] = overriddenPromptStep("step-a", "lane-1", { mode: "acceptEdits" });

    const result = setLaneDefaults(definition, "lane-1", { cliType: "claude-code", cliModel: "opus" });

    expect(result.stages[0].steps[0]).toBe(definition.stages[0].steps[0]);
  });

  test("setLaneType with the same type or a missing lane returns the input", () => {
    const definition = twoLaneDefinition();

    expect(setLaneType(definition, "lane-1", "single")).toBe(definition);
    expect(setLaneType(definition, "missing", "parallel")).toBe(definition);
  });

  test("setLaneDefaults sets and clears only its target lane", () => {
    const definition = twoLaneDefinition();

    const result = setLaneDefaults(definition, "lane-1", { cliType: "codex", cliEffort: "high" });
    expect(result.lanes[0].defaults).toEqual({ cliType: "codex", cliEffort: "high" });
    expect(result.lanes[1].defaults).toBeUndefined();

    expect(setLaneDefaults(result, "lane-1", undefined).lanes[0].defaults).toBeUndefined();
  });

  test("lastPromptOverrides reads the lane's last Prompt across stages, skipping other lanes and step types", () => {
    const definition = twoLaneDefinition();
    definition.stages[0].steps[0] = overriddenPromptStep("step-a", "lane-1", { cliType: "codex", cliModel: "gpt-5.5" });
    definition.stages[1].steps = [
      overriddenPromptStep("step-c", "lane-1", { cliType: "claude-code", cliModel: "haiku", cliEffort: "low" }),
      { stepId: "step-d", laneId: "lane-1", action: { type: "wait" } },
      overriddenPromptStep("step-e", "lane-2", { cliType: "codex" }),
    ];

    expect(lastPromptOverrides(definition, "lane-1")).toEqual({ cliType: "claude-code", cliModel: "haiku", cliEffort: "low" });
    expect(lastPromptOverrides(definition, "lane-3")).toBeUndefined();
  });

  test("removeStep drops only its target", () => {
    const result = removeStep(twoLaneDefinition(), "stage-1", "step-a");

    expect(result.stages[0].steps.map((step) => step.stepId)).toEqual(["step-b"]);
    expect(result.stages[1].steps.map((step) => step.stepId)).toEqual(["step-c"]);
  });

  test("edits do not mutate the input definition", () => {
    const input = twoLaneDefinition();
    const snapshot = JSON.parse(JSON.stringify(input));

    addLane(input);
    renameLane(input, "lane-1", "Changed");
    removeLane(input, "lane-1");
    addStage(input);
    renameStage(input, "stage-1", "Changed");
    removeStage(input, "stage-1");
    addStep(input, "stage-1", "lane-1", { action: { type: "wait" } });
    setLaneType(input, "lane-1", "parallel");
    setLaneDefaults(input, "lane-1", { cliType: "codex" });
    updateStep(input, "stage-1", "step-a", { action: { type: "wait" } });
    removeStep(input, "stage-1", "step-a");
    moveStep(input, { stageId: "stage-1", stepId: "step-a" }, { stageId: "stage-2", laneId: "lane-2" });

    expect(input).toEqual(snapshot);
  });
});
