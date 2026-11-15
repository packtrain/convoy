"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Check, ChevronsLeftRight, Play, RotateCcw, SkipForward, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { WorkflowRunDetail, WorkflowRunStepItem } from "@/convex/workflows/runs/lib/validators";
import type { WorkflowRunStatus } from "@/convex/lib/contracts/workflowRuns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/custom/spinner";
import { WAIT_TITLE_CLASS } from "@/components/blocks/workflows/workflow-wait-card";
import { WorkflowRunCancelDialog } from "@/components/blocks/workflows/workflow-run-panel";
import { useWorkflowRunActions, type WorkflowRunStepAction } from "@/components/blocks/workflows/use-workflow-run-actions";
import { getCliModelOption, renderCliIcon } from "@/lib/cli-runtime-ui/registry";
import { AppLink, appRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const RUN_STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  needs_attention: "Needs attention",
  completed: "Completed",
  canceled: "Canceled",
};

/** Hover-to-expand waits this long so a cursor passing over the rail never opens it. */
const EXPAND_DELAY_MS = 250;
/** Height caps: a short dot column collapsed, a taller panel expanded. Both need a parent with a definite height. */
const COLLAPSED_MAX_HEIGHT_CLASS = "max-h-[min(18rem,100%)]";
const EXPANDED_MAX_HEIGHT_CLASS = "max-h-[min(36rem,100%)]";
const DOT = "size-2 rounded-full";

type RouteParams = { organizationSlug: string; projectAlias: string };

/** What the rail can do to the run; null renders it read-only (the playground, a terminal run). */
export type WorkflowRunRailActions = Pick<ReturnType<typeof useWorkflowRunActions>, "stepAction" | "resume" | "cancel" | "busyStepId" | "resumingLaneId" | "isCanceling">;

const isLive = (step: WorkflowRunStepItem) =>
  step.status === "running" || step.status === "waiting" || step.status === "failed" || step.held === true;

/** The step the rail centers on: this thread's live step, else the run's first live step, else the last finished one. */
function focusStepId(run: WorkflowRunDetail, threadId: Id<"cliThreads">): Id<"workflowRunSteps"> | undefined {
  const steps = run.stages.flatMap((stage) => stage.steps);
  const live = steps.find((step) => isLive(step) && step.threadId === threadId) ?? steps.find(isLive);
  if (live) return live._id;
  return [...steps].reverse().find((step) => step.status !== "pending")?._id ?? steps[0]?._id;
}

/** Fade only the edges steps overflow past, so a run that fits shows no fade at all. */
function edgeMask(top: boolean, bottom: boolean): string | undefined {
  if (!top && !bottom) return undefined;
  const start = top ? "transparent 0%, black 22%" : "black 0%";
  const end = bottom ? "black 78%, transparent 100%" : "black 100%";
  return `linear-gradient(to bottom, ${start}, ${end})`;
}

/** Filled = done, spinner = running, dimmed = not started; warning = needs the user, destructive = failed. */
function StepDot({ step }: { step: WorkflowRunStepItem }) {
  if (step.status === "running") return <Spinner className="size-2.5" />;
  if (step.status === "completed") return <span className={cn(DOT, "bg-foreground")} />;
  if (step.status === "failed") return <span className={cn(DOT, "bg-destructive")} />;
  if (step.status === "waiting") return <span className={cn(DOT, "animate-pulse bg-warning")} />;
  if (step.held) return <span className={cn(DOT, "bg-warning")} />;
  return <span className={cn(DOT, "bg-muted-foreground/30")} />;
}

type RowAction = { key: WorkflowRunStepAction | "resume"; label: string; Icon: typeof Check; variant: "default" | "outline" };

function stepActions(step: WorkflowRunStepItem): RowAction[] {
  if (step.status === "waiting") return [{ key: "approve", label: "Approve", Icon: Check, variant: "default" }];
  if (step.status === "failed")
    return [
      { key: "retry", label: "Retry", Icon: RotateCcw, variant: "default" },
      { key: "skip", label: "Skip", Icon: SkipForward, variant: "outline" },
    ];
  if (step.held) return [{ key: "resume", label: "Resume", Icon: Play, variant: "default" }];
  return [];
}

/** The row's second line: what needs the user, else runtime and lane. */
function stepDetail(step: WorkflowRunStepItem, isThisThread: boolean): string {
  if (step.errorMessage) return step.errorMessage;
  if (step.status === "waiting") return step.type === "bash" ? "Approve to run the script" : "Waiting for your approval";
  if (step.held) return `${step.laneName} held after your message`;
  const model = step.cliType && step.cliModel ? getCliModelOption(step.cliType, step.cliModel)?.label ?? step.cliModel : undefined;
  return [model, step.laneName, isThisThread ? "this thread" : undefined].filter(Boolean).join(" · ");
}

/**
 * The Run rail (docs/specs/workflows.md → Threads page integration): a
 * step dots expand on hover or activation. Reads the Workflow tab's query.
 */
export function WorkflowRunRail({ runId, threadId, params }: { runId: Id<"workflowRuns">; threadId: Id<"cliThreads">; params: RouteParams }) {
  const run = useQuery(api.workflows.runs.core.get, { runId });
  const actions = useWorkflowRunActions(runId);
  if (!run) return null;
  return <WorkflowRunRailView run={run} threadId={threadId} params={params} actions={actions} />;
}

export function WorkflowRunRailView({
  run,
  threadId,
  params,
  actions,
  pinned: pinnedProp,
}: {
  run: WorkflowRunDetail;
  threadId: Id<"cliThreads">;
  params: RouteParams;
  actions: WorkflowRunRailActions | null;
  /** Forces the expanded state (the playground's pin). */
  pinned?: boolean;
}) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const pinRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<"expand" | "pin" | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoverTimer = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => clearHoverTimer, []);
  const isPinned = pinnedProp || pinned;
  const expanded = isPinned || hovered || focusWithin;
  useLayoutEffect(() => {
    if (pendingFocus.current === "pin" && expanded) pinRef.current?.focus();
    if (pendingFocus.current === "expand" && !expanded) expandRef.current?.focus();
    pendingFocus.current = null;
  }, [expanded]);
  const active = run.status === "running" || run.status === "needs_attention";
  const controls = active ? actions : null;

  const listRef = useRef<HTMLOListElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const updateFade = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const slack = 2;
    setFade({ top: list.scrollTop > slack, bottom: list.scrollTop + list.clientHeight < list.scrollHeight - slack });
  }, []);
  // The focus step gravitates to the middle whenever the run or the rail's size changes.
  const focusId = focusStepId(run, threadId);
  useLayoutEffect(() => {
    const list = listRef.current;
    const target = focusId ? list?.querySelector<HTMLElement>(`[data-step-id="${focusId}"]`) : null;
    if (list && target) {
      list.scrollTo({ top: target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2, behavior: "smooth" });
    }
    updateFade();
  }, [focusId, expanded, run, updateFade]);

  const toggle = (
    <Button
      ref={pinRef}
      variant="ghost"
      size="icon-xs"
      className="shrink-0 text-muted-foreground"
      aria-label={isPinned ? "Unpin workflow run progress" : "Pin workflow run progress"}
      aria-pressed={Boolean(isPinned)}
      disabled={pinnedProp}
      onClick={() => setPinned((value) => !value)}
    >
      <ChevronsLeftRight />
    </Button>
  );

  return (
    <aside
      aria-label="Workflow run progress"
      onMouseEnter={() => {
        clearHoverTimer();
        hoverTimer.current = setTimeout(() => {
          if (document.activeElement === expandRef.current) pendingFocus.current = "pin";
          setHovered(true);
        }, EXPAND_DELAY_MS);
      }}
      onMouseLeave={() => {
        clearHoverTimer();
        setHovered(false);
      }}
      onFocus={(event) => {
        if (expanded && event.currentTarget.contains(event.target)) setFocusWithin(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusWithin(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || !event.currentTarget.contains(event.target as Node) || pinnedProp) return;
        event.preventDefault();
        event.stopPropagation();
        clearHoverTimer();
        if (expanded && event.currentTarget.contains(document.activeElement)) pendingFocus.current = "expand";
        setPinned(false);
        setHovered(false);
        setFocusWithin(false);
      }}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg transition-[width,max-height,background-color] duration-200 ease-out",
        expanded ? cn("w-80 border border-border bg-background/95 backdrop-blur", EXPANDED_MAX_HEIGHT_CLASS) : cn("w-8", COLLAPSED_MAX_HEIGHT_CLASS)
      )}
    >
      {expanded ? (
        <div className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1">
          <span className="truncate text-sm font-medium">{run.workflowName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">v{run.versionNumber}</span>
          <Badge variant={run.status === "needs_attention" ? "destructive" : "outline"} className="ml-auto shrink-0">
            {RUN_STATUS_LABELS[run.status]}
          </Badge>
          {toggle}
        </div>
      ) : null}

      {!expanded ? (
        <button
          ref={expandRef}
          type="button"
          aria-label="Expand workflow run progress"
          aria-expanded={false}
          title="Expand workflow run progress"
          className="absolute inset-0 z-10 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => {
            clearHoverTimer();
            pendingFocus.current = "pin";
            setPinned(true);
          }}
        />
      ) : null}

      <ol
        ref={listRef}
        aria-hidden={!expanded}
        onScroll={updateFade}
        style={{ maskImage: edgeMask(fade.top, fade.bottom) }}
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          expanded ? "px-3 py-2" : "items-center py-2"
        )}
      >
        {run.stages.map((stage, stageIndex) => (
          <li key={stage.stageId} className={cn("flex flex-col", !expanded && "items-center")}>
            {/* Stage boundary: a label when expanded, a blank gap when collapsed. */}
            {expanded ? (
              <p className={cn("mb-1 text-[10px] font-medium uppercase text-muted-foreground", stageIndex > 0 && "mt-3")}>{stage.name}</p>
            ) : stageIndex > 0 ? (
              <span className="h-5" />
            ) : null}
            <ul className={cn("flex flex-col", !expanded && "items-center")}>
              {stage.steps.map((step, stepIndex) => {
                const isThisThread = step.threadId === threadId;
                // Another thread's step links there; this thread's and threadless steps stay put.
                const href = expanded && step.threadId && !isThisThread ? appRoute.projectThreadDetail(params.organizationSlug, params.projectAlias, String(step.threadId)) : null;
                const rowActions = controls ? stepActions(step) : [];
                const last = stepIndex === stage.steps.length - 1;
                const busy = controls !== null && (controls.busyStepId === step._id || controls.resumingLaneId === step.laneId);
                const dot = (
                  <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", href && "hover:bg-muted")}>
                    <StepDot step={step} />
                  </span>
                );
                const text = (
                  <>
                    <span
                      className={cn(
                        "flex items-center gap-1.5 text-xs font-medium",
                        step.status === "skipped" && "text-muted-foreground line-through",
                        step.status === "waiting" && WAIT_TITLE_CLASS,
                        step.status === "failed" && "text-destructive",
                        step.status === "pending" && !step.held && "text-muted-foreground"
                      )}
                    >
                      {step.cliType ? renderCliIcon(step.cliType, "size-3 shrink-0") : null}
                      <span className="truncate">{step.title}</span>
                    </span>
                    <span
                      className={cn(
                        "block truncate text-xs text-muted-foreground",
                        step.status === "waiting" && WAIT_TITLE_CLASS,
                        step.status === "failed" && "text-destructive/80"
                      )}
                    >
                      {stepDetail(step, isThisThread)}
                    </span>
                  </>
                );
                return (
                  <li key={step._id} data-step-id={step._id} className={cn("flex", expanded ? "gap-3" : "flex-col items-center")}>
                    <div className="flex flex-col items-center">
                      {href ? (
                        <AppLink href={href} aria-label={step.title} title={expanded ? undefined : `${step.title} · ${step.laneName}`} className="rounded-full">
                          {dot}
                        </AppLink>
                      ) : (
                        <span title={expanded ? undefined : `${step.title} · ${step.laneName}`}>{dot}</span>
                      )}
                      {!last ? <span className="min-h-4 w-px flex-1 bg-border" /> : null}
                    </div>
                    {expanded ? (
                      <div className="min-w-0 flex-1 pb-3">
                        {href ? (
                          <AppLink href={href} className="block min-w-0 hover:underline">
                            {text}
                          </AppLink>
                        ) : (
                          <div className="min-w-0">{text}</div>
                        )}
                        {rowActions.length > 0 && controls ? (
                          <div className="mt-1.5 flex gap-1">
                            {rowActions.map(({ key, label, Icon, variant }) => (
                              <Button
                                key={key}
                                size="2xs"
                                variant={variant}
                                disabled={busy}
                                onClick={() => void (key === "resume" ? controls.resume(step.laneId) : controls.stepAction(step._id, key))}
                              >
                                <Icon className="size-3" /> {label}
                              </Button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>

      {expanded && controls ? (
        <div className="flex shrink-0 justify-end px-2 pb-2">
          <WorkflowRunCancelDialog onConfirm={() => void controls.cancel()}>
            <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" disabled={controls.isCanceling}>
              <X /> Cancel run
            </Button>
          </WorkflowRunCancelDialog>
        </div>
      ) : null}
    </aside>
  );
}
