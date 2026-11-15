import { describe, expect, test } from "vitest";
import type { WorkflowDefinition, WorkflowStep } from "@/convex/lib/contracts/workflowDefinition";
import {
  cellDropId,
  parseStepDragId,
  planStepDrop,
  stepDragId,
  stepEdgeDropId,
} from "./workflow-grid-dnd-planning";

function waitStep(stepId: string, laneId: string): WorkflowStep {
  return { stepId, laneId, action: { type: "wait" } };
}

function definition(): WorkflowDefinition {
  return {
    lanes: [
      { laneId: "lane-1", name: "Lane 1", type: "single" },
      { laneId: "lane-2", name: "Lane 2", type: "single" },
    ],
    stages: [
      { stageId: "stage-1", name: "Stage 1", steps: [waitStep("step-a", "lane-1"), waitStep("step-b", "lane-2")] },
      { stageId: "stage-2", name: "Stage 2", steps: [waitStep("step-c", "lane-1")] },
    ],
  };
}

describe("workflow grid dnd planning", () => {
  test("step drag ids round-trip and malformed ids parse to null", () => {
    expect(parseStepDragId(stepDragId({ stageId: "stage-1", stepId: "step-a" }))).toEqual({
      stageId: "stage-1",
      stepId: "step-a",
    });
    expect(parseStepDragId("step-cell:stage-1:lane-1")).toBeNull();
    expect(parseStepDragId("step-drag:stage-1")).toBeNull();
  });

  test("an edge drop targets the anchor card's cell at the anchor position", () => {
    const target = planStepDrop({
      source: { stageId: "stage-1", stepId: "step-a" },
      dropId: stepEdgeDropId({ stageId: "stage-2", stepId: "step-c" }, "after"),
      definition: definition(),
    });

    expect(target).toEqual({
      stageId: "stage-2",
      laneId: "lane-1",
      anchor: { stepId: "step-c", position: "after" },
    });
  });

  test("a cell drop targets the cell with no anchor (append)", () => {
    const target = planStepDrop({
      source: { stageId: "stage-1", stepId: "step-a" },
      dropId: cellDropId("stage-1", "lane-2"),
      definition: definition(),
    });

    expect(target).toEqual({ stageId: "stage-1", laneId: "lane-2" });
  });

  test("a card's own edges, unknown ids, and missing anchors plan to null", () => {
    const source = { stageId: "stage-1", stepId: "step-a" };

    expect(
      planStepDrop({ source, dropId: stepEdgeDropId({ stageId: "stage-1", stepId: "step-a" }, "before"), definition: definition() })
    ).toBeNull();
    expect(
      planStepDrop({ source, dropId: stepEdgeDropId({ stageId: "stage-1", stepId: "missing" }, "before"), definition: definition() })
    ).toBeNull();
    expect(planStepDrop({ source, dropId: "not-a-drop-id", definition: definition() })).toBeNull();
  });

  test("cross-stage drops into a full stage plan to null; same-stage reorders stay legal", () => {
    const full = definition();
    full.stages[1].steps = Array.from({ length: 50 }, (_, i) => waitStep(`step-${i}`, "lane-1"));

    expect(
      planStepDrop({
        source: { stageId: "stage-1", stepId: "step-a" },
        dropId: cellDropId("stage-2", "lane-1"),
        definition: full,
      })
    ).toBeNull();

    full.stages[0].steps = Array.from({ length: 50 }, (_, i) => waitStep(`step-${i}`, "lane-1"));
    expect(
      planStepDrop({
        source: { stageId: "stage-1", stepId: "step-0" },
        dropId: cellDropId("stage-1", "lane-2"),
        definition: full,
      })
    ).toEqual({ stageId: "stage-1", laneId: "lane-2" });
  });
});
