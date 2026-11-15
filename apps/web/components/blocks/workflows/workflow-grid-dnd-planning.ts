import type { WorkflowDefinition } from "@/convex/lib/contracts/workflowDefinition";
import { MAX_WORKFLOW_STEPS_PER_STAGE } from "@/convex/workflows/lib/invariants";
import type { StepDropTarget, StepLocation } from "@/lib/workflows/draft";

/**
 * Pure planning model for grid step drag-and-drop, mirroring the kanban
 * board's board-dnd-planning: encode/decode dnd-kit ids and map a drop onto
 * a `moveStep` target. Lane/stage/step ids are UUIDs, so ":" never collides.
 */

const STEP_DRAG_PREFIX = "step-drag:";
const STEP_EDGE_PREFIX = "step-edge:";
const CELL_DROP_PREFIX = "step-cell:";

export function stepDragId(location: StepLocation): string {
  return `${STEP_DRAG_PREFIX}${location.stageId}:${location.stepId}`;
}

export function parseStepDragId(id: string): StepLocation | null {
  if (!id.startsWith(STEP_DRAG_PREFIX)) {
    return null;
  }

  const [stageId, stepId, ...rest] = id.slice(STEP_DRAG_PREFIX.length).split(":");
  return stageId && stepId && rest.length === 0 ? { stageId, stepId } : null;
}

export function stepEdgeDropId(location: StepLocation, position: "before" | "after"): string {
  return `${STEP_EDGE_PREFIX}${location.stageId}:${location.stepId}:${position}`;
}

export function cellDropId(stageId: string, laneId: string): string {
  return `${CELL_DROP_PREFIX}${stageId}:${laneId}`;
}

export function isStepEdgeDropId(id: string): boolean {
  return id.startsWith(STEP_EDGE_PREFIX);
}

export function isCellDropId(id: string): boolean {
  return id.startsWith(CELL_DROP_PREFIX);
}

/**
 * Maps a drop id onto a `moveStep` target, or null for no-op drops: unknown
 * ids, a card's own edges, and cross-stage drops into a full stage (the
 * same cap that hides the cell's "Add step" affordance).
 */
export function planStepDrop({
  source,
  dropId,
  definition,
}: {
  source: StepLocation;
  dropId: string;
  definition: WorkflowDefinition;
}): StepDropTarget | null {
  const target = parseStepDropId(dropId, definition);
  if (!target) {
    return null;
  }

  if (
    target.stageId === source.stageId &&
    target.anchor?.stepId === source.stepId
  ) {
    return null;
  }

  if (target.stageId !== source.stageId) {
    const targetStage = definition.stages.find((stage) => stage.stageId === target.stageId);
    if (!targetStage || targetStage.steps.length >= MAX_WORKFLOW_STEPS_PER_STAGE) {
      return null;
    }
  }

  return target;
}

function parseStepDropId(id: string, definition: WorkflowDefinition): StepDropTarget | null {
  if (id.startsWith(STEP_EDGE_PREFIX)) {
    const [stageId, stepId, position, ...rest] = id.slice(STEP_EDGE_PREFIX.length).split(":");
    if (!stageId || !stepId || (position !== "before" && position !== "after") || rest.length > 0) {
      return null;
    }

    // An edge drop lands in the anchor card's cell, so its lane is the target lane.
    const anchor = definition.stages
      .find((stage) => stage.stageId === stageId)
      ?.steps.find((step) => step.stepId === stepId);
    return anchor ? { stageId, laneId: anchor.laneId, anchor: { stepId, position } } : null;
  }

  if (id.startsWith(CELL_DROP_PREFIX)) {
    const [stageId, laneId, ...rest] = id.slice(CELL_DROP_PREFIX.length).split(":");
    return stageId && laneId && rest.length === 0 ? { stageId, laneId } : null;
  }

  return null;
}

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Twin of the kanban board's isPointWithinRect (board-dnd-planning.ts);
// components must not import from app routes, so the 6 lines live here too.
export function isPointWithinRect(point: GridPoint, rect: GridRect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}
