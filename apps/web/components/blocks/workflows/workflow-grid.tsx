"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Hand, MessageSquare, Plus, Terminal, Trash2 } from "lucide-react";
import {
  cellDropId,
  isCellDropId,
  isPointWithinRect,
  isStepEdgeDropId,
  parseStepDragId,
  planStepDrop,
  stepDragId,
  stepEdgeDropId,
} from "@/components/blocks/workflows/workflow-grid-dnd-planning";
import { SettingsCatalogDeleteDialog } from "@/components/blocks/settings-catalog/settings-catalog-delete-dialog";
import type { ThreadAgentSelectorAgent } from "@/components/blocks/thread/thread-agent-selector";
import { WorkflowLaneMenu } from "@/components/blocks/workflows/workflow-lane-menu";
import { WorkflowStepDialog, type StepComposerContext } from "@/components/blocks/workflows/workflow-step-dialog";
import {
  BASH_CHIP_CLASS,
  BASH_ICON_CLASS,
  BASH_SURFACE_CLASS,
  BASH_TITLE_CLASS,
  WAIT_ICON_CLASS,
  WAIT_SURFACE_CLASS,
  WAIT_TITLE_CLASS,
  formatScriptTimeout,
} from "@/components/blocks/workflows/workflow-wait-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LaneDefinition, StepOverrides, WorkflowDefinition, WorkflowStep } from "@/convex/lib/contracts/workflowDefinition";
import { MAX_WORKFLOW_LANES, MAX_WORKFLOW_STAGES, MAX_WORKFLOW_STEPS_PER_STAGE } from "@/convex/workflows/lib/invariants";
import {
  CLI_TYPE_MAP,
  DEFAULT_FALLBACK_CLI_TYPE,
  getCliEffortOptions,
  getCliModeDefinition,
  getCliModelOption,
  renderCliIcon,
  type CliTypeSlug,
} from "@/lib/cli-runtime-ui/registry";
import {
  addLane,
  addStage,
  addStep,
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
  type StepLocation,
} from "@/lib/workflows/draft";
import { SlashCommandDisplayText } from "@/lib/slash-commands/display";
import { cn } from "@/lib/utils";

// Drag mechanics mirror the kanban board (use-board-dnd): a pointer sensor
// that ignores touch, a long-press touch sensor, and explicit collision
// priority because the edge zones overlap the cell body.
class GridPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: ReactPointerEvent<Element>) =>
        nativeEvent.isPrimary && nativeEvent.button === 0 && nativeEvent.pointerType !== "touch",
    },
  ];
}

const gridCollisionDetection: CollisionDetection = (args) => {
  // A pointer still over the dragged card's original rect only overlaps the
  // cell body, which would teleport the card to the cell end — treat the
  // release as a no-op instead.
  const initialRect = args.active.rect.current.initial;
  if (args.pointerCoordinates && initialRect && isPointWithinRect(args.pointerCoordinates, initialRect)) {
    return [];
  }

  for (const matches of [isStepEdgeDropId, isCellDropId]) {
    const containers = args.droppableContainers.filter((container) => matches(String(container.id)));
    const collisions = pointerWithin({ ...args, droppableContainers: containers });
    if (collisions.length > 0) {
      return collisions;
    }
  }

  return rectIntersection(args);
};

interface WorkflowGridProps {
  definition: WorkflowDefinition;
  /** Omit for read-only (viewers): renames disabled, add/remove hidden. */
  onChange?: (definition: WorkflowDefinition) => void;
  /** Temporarily blocks edits (e.g. while a Save is in flight) without hiding affordances. */
  disabled?: boolean;
  /** Omit (e.g. the playground) to disable Prompt step add/edit — the composer needs a real project. */
  composer?: StepComposerContext;
  /** The project's active agents, offered by Lane settings and Parallel-step overrides. */
  projectAgents?: ThreadAgentSelectorAgent[];
  /** Sizes the scrollport: flush flex child in the editor, bounded box in the playground. */
  className?: string;
}

/**
 * The Stage × Lane authoring grid (docs/specs/workflows.md → UI). Rows are
 * Stages, columns are Lanes. Steps cover Prompt, Wait, and Bash; each Lane
 * header opens its settings (name, type, single-Lane defaults).
 */
export function WorkflowGrid({ definition, onChange, disabled = false, composer, projectAgents, className }: WorkflowGridProps) {
  const readOnly = onChange === undefined;
  const inputsDisabled = readOnly || disabled;
  const { lanes, stages } = definition;
  // The affordances stop at the server caps so Save can't be rejected for size.
  const showAddLane = !readOnly && lanes.length < MAX_WORKFLOW_LANES;
  const showAddStage = !readOnly && stages.length < MAX_WORKFLOW_STAGES;
  const contentRows = 1 + stages.length + (showAddStage ? 1 : 0);
  // step === null → creating a new step of createType in that cell (Wait
  // steps are added straight from the placeholder dropdown, no dialog).
  const [stepDialog, setStepDialog] = useState<{
    stageId: string;
    laneId: string;
    step: WorkflowStep | null;
    createType?: "bash" | "prompt";
  } | null>(null);
  const [activeDrag, setActiveDrag] = useState<{ location: StepLocation; step: WorkflowStep } | null>(null);
  // Lane/stage deletion is one click while empty; holding steps, it confirms first.
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "lane" | "stage"; id: string; name: string } | null>(null);
  const sensors = useSensors(
    // Keep plain clicks (open the step dialog) from starting a drag.
    useSensor(GridPointerSensor, { activationConstraint: { distance: 5 } }),
    // Long-press lifts on touch so swiping across the grid still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 10 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const location = parseStepDragId(String(event.active.id));
    const step = location
      ? stages.find((stage) => stage.stageId === location.stageId)?.steps.find((s) => s.stepId === location.stepId)
      : undefined;
    if (location && step) {
      setActiveDrag({ location, step });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = activeDrag;
    setActiveDrag(null);
    if (!active || !event.over) {
      return;
    }

    const target = planStepDrop({ source: active.location, dropId: String(event.over.id), definition });
    if (target) {
      onChange?.(moveStep(definition, active.location, target));
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={gridCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
    {/* This container is the scrollport the sticky header and sticky Stage
        column stick to. */}
    <div className={cn("overflow-auto", className)} data-testid="workflow-grid">
      <div
        className="grid min-h-full min-w-max"
        style={{
          // `repeat(0, ...)` is invalid CSS and would drop the whole template,
          // so the lane fragment is omitted when the last lane is deleted.
          gridTemplateColumns: ["14rem", ...(lanes.length > 0 ? [`repeat(${lanes.length}, 20rem)`] : []), "minmax(10rem, 1fr)"].join(" "),
          // Trailing 1fr spacer row stretches the lane columns' borders to
          // the bottom of the scrollport, like kanban columns.
          gridTemplateRows: `repeat(${contentRows}, max-content) minmax(0, 1fr)`,
        }}
      >
        {/* Header row — matches the kanban column header treatment. */}
        <div className="sticky left-0 top-0 z-30 flex items-center border-b border-r border-border bg-muted px-3 py-2 dark:bg-background">
          <span className="text-sm font-medium text-foreground">Stage</span>
        </div>
        {lanes.map((lane, laneIndex) => (
          <div
            key={lane.laneId}
            className="group/lane sticky top-0 z-10 flex items-center gap-2 border-b border-r border-border bg-muted/95 py-1 pl-3 pr-1 dark:bg-background/95"
          >
            <GridNameInput
              value={lane.name}
              ariaLabel={`Lane ${laneIndex + 1} name`}
              disabled={inputsDisabled}
              onChange={(name) => onChange?.(renameLane(definition, lane.laneId, name))}
            />
            <WorkflowLaneMenu
              lane={lane}
              projectAgents={projectAgents ?? []}
              disabled={inputsDisabled}
              onSelect={(selection) => {
                // Type flips move the runtime settings in this same edit, so
                // the override pills change now, not silently on Save.
                let next = setLaneType(definition, lane.laneId, selection.type);
                if (selection.type === "single") {
                  next = setLaneDefaults(next, lane.laneId, selection.defaults);
                }
                onChange?.(next);
              }}
              onDelete={
                readOnly
                  ? undefined
                  : () =>
                      stages.some((stage) => stage.steps.some((step) => step.laneId === lane.laneId))
                        ? setConfirmDelete({ kind: "lane", id: lane.laneId, name: lane.name })
                        : onChange?.(removeLane(definition, lane.laneId))
              }
            />
          </div>
        ))}
        <div className="sticky top-0 z-10 flex items-center border-b border-border bg-muted/95 px-3 py-2 dark:bg-background/95">
          {showAddLane ? (
            <GridAddButton label="Add lane" disabled={disabled} onClick={() => onChange?.(addLane(definition))} />
          ) : null}
        </div>

        {/* Stage rows — no separators; alternating rows get a subtle bg tint. */}
        {stages.map((stage, stageIndex) => {
          const altBg = stageIndex % 2 === 1 && "bg-muted/60 dark:bg-muted/60";
          // A full stage can still reorder its own cards; only cross-stage
          // drops must respect the per-stage cap (same bar as "Add step").
          const stageDropAllowed =
            activeDrag !== null &&
            (stage.stageId === activeDrag.location.stageId || stage.steps.length < MAX_WORKFLOW_STEPS_PER_STAGE);
          return (
            <Fragment key={stage.stageId}>
              <div className="group/stage sticky left-0 z-20 flex items-start gap-1 border-r border-border bg-background p-3">
                {altBg ? <span className={cn("absolute inset-0 -z-10", altBg)} /> : null}
                <GridNameInput
                  value={stage.name}
                  ariaLabel={`Stage ${stageIndex + 1} name`}
                  disabled={inputsDisabled}
                  onChange={(name) => onChange?.(renameStage(definition, stage.stageId, name))}
                />
                {readOnly ? null : (
                  <GridRemoveButton
                    label={`Delete stage ${stage.name}`}
                    hoverGroup="stage"
                    disabled={disabled}
                    onClick={() =>
                      stage.steps.length > 0
                        ? setConfirmDelete({ kind: "stage", id: stage.stageId, name: stage.name })
                        : onChange?.(removeStage(definition, stage.stageId))
                    }
                  />
                )}
              </div>
              {lanes.map((lane) => (
                <GridCell
                  key={lane.laneId}
                  stageId={stage.stageId}
                  laneId={lane.laneId}
                  dropDisabled={!stageDropAllowed}
                  className={cn(altBg)}
                >
                  <div className="flex flex-col gap-3">
                    {stage.steps
                      .filter((step) => step.laneId === lane.laneId)
                      .map((step) =>
                        readOnly ? (
                          <StepCard key={step.stepId} step={step} lane={lane} className={cn(altBg && "dark:bg-background")} />
                        ) : (
                          <GridStepCard
                            key={step.stepId}
                            location={{ stageId: stage.stageId, stepId: step.stepId }}
                            step={step}
                            lane={lane}
                            dragDisabled={disabled}
                            showEdgeZones={stageDropAllowed}
                            cardClassName={cn(altBg && "dark:bg-background")}
                            // Prompt editing needs the composer's project context.
                            onEdit={
                              step.action.type === "prompt" && !composer
                                ? undefined
                                : () => setStepDialog({ stageId: stage.stageId, laneId: lane.laneId, step })
                            }
                            editDisabled={disabled}
                          />
                        )
                      )}
                    {!readOnly && stage.steps.length < MAX_WORKFLOW_STEPS_PER_STAGE ? (
                      <StepPlaceholder
                        disabled={disabled}
                        onAddWait={() =>
                          onChange?.(addStep(definition, stage.stageId, lane.laneId, { action: { type: "wait" } }))
                        }
                        onAddBash={() =>
                          setStepDialog({ stageId: stage.stageId, laneId: lane.laneId, step: null, createType: "bash" })
                        }
                        onAddPrompt={
                          composer
                            ? () =>
                                setStepDialog({ stageId: stage.stageId, laneId: lane.laneId, step: null, createType: "prompt" })
                            : undefined
                        }
                      />
                    ) : null}
                  </div>
                </GridCell>
              ))}
              <div className={cn(altBg)} />
            </Fragment>
          );
        })}

        {/* Add Stage row — banded like a stage row so it reads as the next one. */}
        {(() => {
          if (!showAddStage) return null;
          const altBg = stages.length % 2 === 1 && "bg-muted/60 dark:bg-muted/60";
          return (
            <>
              <div className="sticky left-0 z-20 flex items-start border-r border-border bg-background p-3">
                {altBg ? <span className={cn("absolute inset-0 -z-10", altBg)} /> : null}
                <GridAddButton label="Add stage" disabled={disabled} onClick={() => onChange?.(addStage(definition))} />
              </div>
              {lanes.map((lane) => (
                <div key={lane.laneId} className={cn("border-r border-border p-3", altBg)} />
              ))}
              <div className={cn(altBg)} />
            </>
          );
        })()}

        {/* Spacer row — carries the column borders down to the bottom edge. */}
        <div className="sticky left-0 z-20 border-r border-border bg-background" />
        {lanes.map((lane) => (
          <div key={lane.laneId} className="border-r border-border" />
        ))}
        <div />
      </div>
      {confirmDelete ? (
        <SettingsCatalogDeleteDialog
          title={confirmDelete.kind === "lane" ? "Delete lane?" : "Delete stage?"}
          description={`Delete ${confirmDelete.name}? Its steps are removed with it.`}
          open
          onOpenChange={(open) => {
            if (!open) setConfirmDelete(null);
          }}
          onConfirm={() => {
            onChange?.(
              confirmDelete.kind === "lane"
                ? removeLane(definition, confirmDelete.id)
                : removeStage(definition, confirmDelete.id)
            );
            setConfirmDelete(null);
          }}
        />
      ) : null}
      {stepDialog ? (
        <WorkflowStepDialog
          step={stepDialog.step}
          createType={stepDialog.createType}
          composer={composer}
          projectAgents={projectAgents}
          lane={lanes.find((lane) => lane.laneId === stepDialog.laneId)}
          seedOverrides={lastPromptOverrides(definition, stepDialog.laneId)}
          onOpenChange={(open) => {
            if (!open) setStepDialog(null);
          }}
          onSubmit={(input) => {
            onChange?.(
              stepDialog.step
                ? updateStep(definition, stepDialog.stageId, stepDialog.step.stepId, input)
                : addStep(definition, stepDialog.stageId, stepDialog.laneId, input)
            );
            setStepDialog(null);
          }}
          onDelete={
            stepDialog.step
              ? () => {
                  onChange?.(removeStep(definition, stepDialog.stageId, stepDialog.step!.stepId));
                  setStepDialog(null);
                }
              : undefined
          }
        />
      ) : null}
    </div>
    <DragOverlay dropAnimation={null}>
      {activeDrag ? (
        <StepCard
          step={activeDrag.step}
          lane={lanes.find((lane) => lane.laneId === activeDrag.step.laneId)}
          className="shadow-lg"
        />
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}

/** Grid cell droppable: dropping on the cell body appends to that cell. */
function GridCell({
  stageId,
  laneId,
  dropDisabled,
  className,
  children,
}: {
  stageId: string;
  laneId: string;
  dropDisabled: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: cellDropId(stageId, laneId), disabled: dropDisabled });

  return (
    <div ref={setNodeRef} className={cn("group/cell relative border-r border-border p-3", className)}>
      {children}
      {isOver ? (
        <div className="pointer-events-none absolute inset-1 rounded-lg bg-info/5 ring-2 ring-info" />
      ) : null}
    </div>
  );
}

/**
 * Half-height edge zones extend into half the cell gap, so the space between
 * two cards resolves to a before/after intent instead of the cell body —
 * the kanban board's CardDropZone treatment.
 */
function StepEdgeDropZone({ id, edge }: { id: string; edge: "before" | "after" }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "pointer-events-none absolute inset-x-0",
        edge === "before" ? "-top-1.5 bottom-1/2" : "top-1/2 -bottom-1.5"
      )}
    >
      {isOver ? (
        <div
          className={cn(
            "absolute inset-x-0 h-0.5 rounded-full bg-info",
            edge === "before" ? "-top-px" : "-bottom-px"
          )}
        />
      ) : null}
    </div>
  );
}

/**
 * Draggable step card. The click that trails a completed drag is swallowed
 * so a drop doesn't also open the dialog (the kanban board's card treatment).
 */
function GridStepCard({
  location,
  step,
  lane,
  dragDisabled,
  showEdgeZones,
  cardClassName,
  onEdit,
  editDisabled,
}: {
  location: StepLocation;
  step: WorkflowStep;
  lane: LaneDefinition;
  dragDisabled: boolean;
  showEdgeZones: boolean;
  cardClassName?: string;
  onEdit?: () => void;
  editDisabled?: boolean;
}) {
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: stepDragId(location),
    disabled: dragDisabled,
  });
  const didDragRef = useRef(false);

  useEffect(() => {
    if (isDragging) {
      didDragRef.current = true;
      return;
    }

    if (!didDragRef.current) {
      return;
    }

    // Clears the flag when no click follows the drag (e.g. Escape-canceled),
    // so the next real click is not swallowed.
    const timeout = window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [isDragging]);

  const handleClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!didDragRef.current) {
      return;
    }

    didDragRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={setNodeRef}
      data-workflow-dnd-step={dragDisabled ? "disabled" : "enabled"}
      className={cn(
        // touch-manipulation keeps native panning before long-press lift; the
        // selection suppression stops iOS text selection during the press.
        "relative touch-manipulation max-md:select-none max-md:[-webkit-touch-callout:none]",
        isDragging && "opacity-50"
      )}
      onClickCapture={handleClickCapture}
      {...listeners}
    >
      {onEdit ? (
        <button
          type="button"
          disabled={editDisabled}
          className="w-full cursor-pointer text-left disabled:cursor-default"
          onClick={onEdit}
        >
          <StepCard step={step} lane={lane} className={cardClassName} />
        </button>
      ) : (
        <StepCard step={step} lane={lane} className={cardClassName} />
      )}
      {showEdgeZones && !isDragging ? (
        <>
          <StepEdgeDropZone id={stepEdgeDropId(location, "before")} edge="before" />
          <StepEdgeDropZone id={stepEdgeDropId(location, "after")} edge="after" />
        </>
      ) : null}
    </div>
  );
}

/**
 * Hover-revealed "Add step" dropdown. Wait needs no config, so it lands in
 * the cell directly; Prompt and Bash open the config dialog.
 */
function StepPlaceholder({
  disabled,
  onAddWait,
  onAddBash,
  onAddPrompt,
}: {
  disabled: boolean;
  onAddWait: () => void;
  onAddBash: () => void;
  onAddPrompt?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm text-muted-foreground opacity-0 transition-opacity group-hover/cell:opacity-100 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 disabled:cursor-default"
        >
          <Plus className="size-4 shrink-0" />
          Add step...
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {onAddPrompt ? (
          <DropdownMenuItem className="cursor-pointer" onClick={onAddPrompt}>
            <MessageSquare className="size-4" />
            Prompt
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="cursor-pointer" onClick={onAddWait}>
          <Hand className="size-4" />
          Wait for human
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onClick={onAddBash}>
          <Terminal className="size-4" />
          Bash script
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Borderless inline rename, styled like static text; Enter leaves edit mode. */
function GridNameInput({
  value,
  ariaLabel,
  disabled,
  onChange,
}: {
  value: string;
  ariaLabel: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={value}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      className="min-w-0 flex-1 truncate rounded bg-transparent px-1 py-0.5 text-sm font-medium text-foreground outline-none disabled:cursor-default"
    />
  );
}

/** "+ Add Lane" / "+ Add Stage" affordance. */
function GridAddButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
      onClick={onClick}
    >
      <Plus className="size-4" />
      {label}
    </button>
  );
}

/** Hover-revealed delete affordance for a lane column or stage row. */
function GridRemoveButton({
  label,
  disabled,
  onClick,
  hoverGroup = "lane",
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  hoverGroup?: "lane" | "stage";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "shrink-0 cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 disabled:cursor-default",
        hoverGroup === "lane" ? "group-hover/lane:opacity-100" : "group-hover/stage:opacity-100"
      )}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

/** Same pill styling as the kanban column count badge. */
export function StepPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{children}</span>
  );
}

/** Card shell copied from KanbanCard so steps read as board cards. */
export function StepCardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg border border-border bg-card text-left shadow-xs transition-colors hover:border-muted-foreground/35 dark:border-transparent dark:shadow-none [&_svg]:saturate-70",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Read-only Step rendering; editing happens through the step dialog. */
function StepCard({
  step,
  lane,
  className,
}: {
  step: WorkflowStep;
  /** The step's lane; its type decides which Prompt override pills apply. */
  lane?: LaneDefinition;
  className?: string;
}) {
  if (step.action.type === "wait") {
    // Amber = "waiting on a human", matching thread-list/usage-limit styling.
    return (
      <StepCardShell className={cn(className, WAIT_SURFACE_CLASS, "hover:border-warning/60")}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <Hand className={cn("size-4 shrink-0", WAIT_ICON_CLASS)} />
          <span className={cn("text-sm font-medium leading-snug", WAIT_TITLE_CLASS)}>
            {step.name ?? "Wait for human"}
          </span>
        </div>
      </StepCardShell>
    );
  }

  if (step.action.type === "bash") {
    const reportPill = {
      always: "Always report",
      on_failure: "Report on failure",
      stop_on_failure: "Stop on failure",
    }[step.action.reportOutput];
    // Blue = "runs on your machine", matching the exec family in the action catalog.
    return (
      <StepCardShell className={cn(className, BASH_SURFACE_CLASS, "hover:border-info/60")}>
        <div className="flex min-h-24 flex-col px-3 py-2.5">
          <div className="flex items-start gap-2">
            <Terminal className={cn("mt-0.5 size-4 shrink-0", BASH_ICON_CLASS)} />
            {/* The name replaces the script preview — a long name in the pill row wrecked it. */}
            {step.name ? (
              <h4 className={cn("line-clamp-3 text-sm font-medium leading-snug", BASH_TITLE_CLASS)}>{step.name}</h4>
            ) : (
              <p className={cn("line-clamp-3 font-mono text-xs leading-relaxed", BASH_TITLE_CLASS)}>{step.action.script}</p>
            )}
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
            <span className={BASH_CHIP_CLASS}>Timeout: {formatScriptTimeout(step.action.timeoutMs)}</span>
            <span className={BASH_CHIP_CLASS}>{reportPill}</span>
          </div>
        </div>
      </StepCardShell>
    );
  }

  const { runtime, pills } = promptOverrideBadges(step.action.overrides, lane);
  return (
    <StepCardShell className={className}>
      <div className="flex min-h-24 flex-col px-3 py-2.5">
        <h4 className="line-clamp-3 text-sm font-medium leading-snug text-foreground">
          <SlashCommandDisplayText text={step.action.content.displayContent} />
        </h4>
        {runtime || pills.length > 0 ? (
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
            {runtime ? (
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                {renderCliIcon(runtime.cliType, "size-3.5 shrink-0")}
                <span className="min-w-0 truncate text-foreground">{runtime.label}</span>
                {runtime.effortLabel ? <span className="text-muted-foreground">{runtime.effortLabel}</span> : null}
              </span>
            ) : null}
            {pills.map((pill) => (
              <StepPill key={pill}>{pill}</StepPill>
            ))}
          </div>
        ) : null}
      </div>
    </StepCardShell>
  );
}

/**
 * The overrides that apply under the Lane override rule
 * (workflow-data-schema.md): a single Lane's card shows only the mode pill —
 * runtime, model, and effort are the Lane's — while a Parallel Lane's card also
 * shows its per-thread runtime the way the Lane header renders it.
 */
function promptOverrideBadges(
  overrides: StepOverrides | undefined,
  lane?: LaneDefinition
): { runtime?: { cliType: CliTypeSlug; label: string; effortLabel?: string }; pills: string[] } {
  if (!overrides) {
    return { pills: [] };
  }
  const isParallel = lane?.type === "parallel";
  const cliType = (isParallel ? overrides.cliType : lane?.defaults?.cliType) ?? DEFAULT_FALLBACK_CLI_TYPE;
  const effort = overrides.cliEffort;
  const runtime =
    isParallel && (overrides.cliType || overrides.cliModel || effort)
      ? {
          cliType,
          // The icon carries the runtime, so the label is the model when set.
          label: overrides.cliModel
            ? (getCliModelOption(cliType, overrides.cliModel)?.label ?? overrides.cliModel)
            : CLI_TYPE_MAP[cliType],
          effortLabel: effort
            ? (getCliEffortOptions(cliType, { cliModel: overrides.cliModel }).find(
                (option) => option.value === effort
              )?.label ?? effort)
            : undefined,
        }
      : undefined;
  const pills = overrides.mode ? [getCliModeDefinition(cliType, overrides.mode)?.label ?? overrides.mode] : [];
  return { runtime, pills };
}
