"use client";

import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Hand, Minus, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/custom/spinner";
import type { WorkflowRunStatus } from "@/convex/lib/contracts/workflowRuns";
import { WAIT_ICON_CLASS, WAIT_SURFACE_CLASS, WAIT_TITLE_CLASS, WorkflowScriptPreview } from "@/components/blocks/workflows/workflow-wait-card";
import { getCliEffortOptions, getCliModelOption, renderCliIcon } from "@/lib/cli-runtime-ui/registry";
import { AppLink, appRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useWorkflowRunActions } from "./use-workflow-run-actions";

type WorkflowRunStepItem = NonNullable<FunctionReturnType<typeof api.workflows.runs.core.get>>["stages"][number]["steps"][number];

/** Status labels/glyphs are run-step-local — the thread catalogs cover a different union. */
// Only the label navigates, so only it hovers; shared by the linkless fallback.
const STEP_LABEL_CLASS = "flex min-w-0 flex-1 items-center gap-2";
/** Row actions re-enable pointer events above the stretched link. */
const STEP_ACTION_CLASS = "pointer-events-auto shrink-0";

const RUN_STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  needs_attention: "Needs attention",
  completed: "Completed",
  canceled: "Canceled",
};

/** Cancel's confirmation, shared with the Run rail: a canceled run cannot be resumed. */
export function WorkflowRunCancelDialog({ children, onConfirm }: { children: ReactNode; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
          <AlertDialogDescription>
            Running steps are stopped and nothing further is dispatched. Threads created by the run are kept. A
            canceled run cannot be resumed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep running</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Cancel run
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function StepStatusGlyph({ status }: { status: WorkflowRunStepItem["status"] }) {
  if (status === "running") {
    return <Spinner className="size-3" />;
  }
  if (status === "completed") {
    return <Check className="size-3.5 text-muted-foreground" />;
  }
  if (status === "skipped" || status === "canceled") {
    return <Minus className="size-3.5 text-muted-foreground" />;
  }
  if (status === "waiting") {
    // The editor's wait-card identity: amber hand.
    return <Hand className={cn("size-3.5", WAIT_ICON_CLASS)} />;
  }
  return <span className={cn("size-1.5 rounded-full", status === "failed" ? "bg-destructive" : "bg-muted-foreground/40")} />;
}

/**
 * A run's live progress: steps grouped by stage, with run-level actions
 * (docs/specs/workflows.md → Threads page integration). Hosted by the run
 * container's view; later slices reuse it as a sidebar tab on lane threads.
 */
export function WorkflowRunPanel({
  runId,
  params,
}: {
  runId: Id<"workflowRuns">;
  params: { organizationSlug: string; projectAlias: string };
}) {
  const run = useQuery(api.workflows.runs.core.get, { runId });
  const actions = useWorkflowRunActions(runId);

  if (run === undefined) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  if (run === null) {
    return <p className="p-4 text-sm text-muted-foreground">This run is not available.</p>;
  }

  const isActive = run.status === "running" || run.status === "needs_attention";
  const { stepAction, resume, busyStepId, resumingLaneId } = actions;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Same toolbar row as the Tasks/Changes tabs (thread-sidebar-tabs.tsx). */}
      <div className="flex h-[41px] shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-2">
        <div className="flex min-w-0 items-center gap-2 px-2">
          {/* A real anchor into the editor, like the thread-list run glyph (OS-1875).
              A deleted workflow has no editor page — plain text then. */}
          {run.workflowDeleted ? (
            <span className="truncate text-sm font-medium">{run.workflowName}</span>
          ) : (
            <AppLink
              href={appRoute.projectWorkflowDetail(params.organizationSlug, params.projectAlias, String(run.workflowId))}
              className="truncate text-sm font-medium hover:underline"
            >
              {run.workflowName}
            </AppLink>
          )}
          <span className="shrink-0 text-xs text-muted-foreground">v{run.versionNumber}</span>
          <Badge variant={run.status === "needs_attention" ? "destructive" : "outline"}>
            {RUN_STATUS_LABELS[run.status]}
          </Badge>
        </div>
        {isActive ? (
          <WorkflowRunCancelDialog onConfirm={() => void actions.cancel()}>
            <Button variant="outline" size="xs" className="shrink-0 gap-2" disabled={actions.isCanceling}>
              <X className="h-4 w-4" />
              Cancel run
            </Button>
          </WorkflowRunCancelDialog>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <ol className="flex flex-col gap-4">
          {run.stages.map((stage) => (
            <li key={stage.stageId}>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                {stage.name}
              </p>
              <ul className="flex flex-col gap-1">
                {stage.steps.map((step) => {
                  const label = (
                    <>
                      <span
                        className={cn(
                          "min-w-0 truncate",
                          step.status === "skipped" && "text-muted-foreground line-through",
                          step.status === "waiting" && cn("font-medium", WAIT_TITLE_CLASS)
                        )}
                      >
                        {step.title}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {step.cliType ? renderCliIcon(step.cliType, "size-3.5 shrink-0") : null}
                        {step.cliType && step.cliModel ? (
                          <span>{getCliModelOption(step.cliType, step.cliModel)?.label ?? step.cliModel}</span>
                        ) : null}
                        {step.cliType && step.cliEffort ? (
                          <span>
                            {getCliEffortOptions(step.cliType, { cliModel: step.cliModel }).find(
                              (option) => option.value === step.cliEffort
                            )?.label ?? step.cliEffort}
                          </span>
                        ) : null}
                        {/* A step with no runtime (wait steps) has nothing to separate from. */}
                        {step.cliType ? <span>-</span> : null}
                        <span>{step.laneName}</span>
                      </span>
                    </>
                  );
                  const waiting = step.status === "waiting";
                  return (
                    <li
                      key={step._id}
                      className={cn(
                        "relative -mx-1.5 rounded-sm px-1.5 py-1 text-sm",
                        waiting && WAIT_SURFACE_CLASS,
                        step.threadId && (waiting ? "hover:bg-warning/15" : "hover:bg-muted")
                      )}
                    >
                      {/* The whole card is the thread link — a stretched overlay, like the
                          thread list row. Content sits above it; actions stay siblings of
                          the anchor (interactive content in an anchor breaks tab order and AT). */}
                      {step.threadId ? (
                        <AppLink
                          href={appRoute.projectThreadDetail(params.organizationSlug, params.projectAlias, String(step.threadId))}
                          className="absolute inset-0 z-0 rounded-sm"
                        >
                          <span className="sr-only">Open thread {step.title}</span>
                        </AppLink>
                      ) : null}
                      <div className="pointer-events-none relative z-10 flex items-center gap-2">
                      <span className="flex w-4 shrink-0 items-center justify-center">
                        <StepStatusGlyph status={step.status} />
                      </span>
                      {step.status === "failed" && isActive ? (
                        <>
                          <Button size="2xs" className={STEP_ACTION_CLASS} disabled={busyStepId === step._id} onClick={() => void stepAction(step._id, "retry")}>
                            Retry
                          </Button>
                          <Button size="2xs" variant="outline" className={STEP_ACTION_CLASS} disabled={busyStepId === step._id} onClick={() => void stepAction(step._id, "skip")}>
                            Skip
                          </Button>
                        </>
                      ) : null}
                      {waiting && isActive ? (
                        // The in-thread wait card's control, duplicated on the
                        // step row (workflow-wait-card.tsx).
                        <Button size="2xs" className={STEP_ACTION_CLASS} disabled={busyStepId === step._id} onClick={() => void stepAction(step._id, "approve")}>
                          Approve
                        </Button>
                      ) : null}
                      {/* The hold blocks exactly this dispatch — Resume lives on the blocked step. */}
                      {step.held && isActive ? (
                        <Button
                          size="2xs"
                          className={STEP_ACTION_CLASS}
                          disabled={resumingLaneId === step.laneId}
                          onClick={() => void resume(step.laneId)}
                        >
                          Resume
                        </Button>
                      ) : null}
                      <span className={STEP_LABEL_CLASS}>{label}</span>
                      </div>
                      {/* The held script is what Approve authorizes; other rows stay compact.
                          Stays clickable so the script text can be selected. */}
                      {waiting && step.script ? <WorkflowScriptPreview script={step.script} className="relative z-10 mt-1.5 pl-6" /> : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
